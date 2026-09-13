#!/usr/bin/env python3
"""
Convert a scraped tree into one the game can play on.

`scraper.py` writes `data/_cache/wikidata-tree-raw.json` rooted at Life, in a
*different shape* from the dataset the game loads. Two things have to change, and both are
silent failures if skipped:

1. **The subtree.** The game expects a single kingdom, not all of life.

2. **The schema is inverted.** The scrape stores the English name in `name` and
   the taxon name in `scientific_name`; the game wants `name` to be the taxon
   name with the English one in `common_name`. Without this the game raises
   `KeyError: 'common_name'` on the first pick.

   This applies to *every* node, not only the species. Wikidata's English label
   for a well-known clade is the vernacular — Q7377 is "mammal", Q5113 "bird",
   Q1390 "insect" — so inverting the leaves alone left a game tree whose most
   recognisable internal nodes were the only ones not named in Latin, and whose
   common names were the one thing a player might search for.

It also fixes a third problem that would otherwise corrupt play silently:

3. **Common names are not unique.** A default scrape of Animalia has 400
   collisions — "Cichlid" alone covers 38 species. The game keys its index on
   the common name, so colliding species overwrite each other and the pruned
   display tree matches every one of them. Duplicates are disambiguated by
   appending the binomial; unique names are left alone.

Run from the repo root:
    python3 datagen/extract_game_tree.py
    python3 datagen/extract_game_tree.py --taxon Plantae --out data/plants.json

Then play on it:
    TAXOQUIZ_DATASET=<name> ./start.sh
"""

import argparse
import collections
import datetime
import sys

from taxoquiz.jsonio import read_json, write_json_atomic
from taxoquiz.paths import CACHE_RAW_TREE, cache_dir, data_dir
from validate_dataset import check_shape, check_warmth, validate


def find_taxon(node: dict, name: str) -> dict | None:
    # Either name matches, because the raw tree names a node by its English
    # label and for a famous clade that is the vernacular. `--taxon Mammalia`
    # has to find the node the scrape calls "mammal".
    if name in (node.get("name"), node.get("scientific_name")):
        return node
    for child in node.get("children", []):
        found = find_taxon(child, name)
        if found is not None:
            return found
    return None


def iter_leaves(node: dict):
    if not node.get("children"):
        yield node
        return
    for child in node["children"]:
        yield from iter_leaves(child)


def drop_childless_taxa(node: dict) -> tuple[dict | None, int]:
    """Remove leaves that are not species, and every taxon they leave empty.

    Every leaf in a game tree is something a player can guess and a seed can
    pick. The raw tree also holds taxa with nothing under them — a clade whose
    only child the scraper hung from a more specific parent, or a genus none of
    whose species reached the sitelink threshold — and `convert` used to stamp
    each one "Species". The Sep 2026 rebuild carried 189 of them, Apo-Chiroptera
    among them: a bat photograph labelled "Species", a dead end beside the real
    bats, and a possible secret animal.

    Returns the pruned node, or None when nothing beneath it is a species, and
    how many nodes were removed.
    """
    children = node.get("children") or []
    if not children:
        return (node, 0) if (node.get("rank") or "").lower() == "species" else (None, 1)
    kept, dropped = [], 0
    for child in children:
        pruned, n = drop_childless_taxa(child)
        dropped += n
        if pruned is not None:
            kept.append(pruned)
    if not kept:
        return None, dropped + 1
    return {**node, "children": kept}, dropped


def collapse_nested_duplicates(node: dict) -> dict:
    """Merge a child into its parent when they share a name.

    The scrape contains genus/subgenus pairs with identical names (Thunnus
    inside Thunnus) and a few genus nodes mislabelled with a full binomial that
    then contain the species of that name. Both are the same node twice, so the
    inner one is spliced away and its children adopted by the outer.
    """
    children = [collapse_nested_duplicates(c) for c in node.get("children", [])]
    merged = []
    for child in children:
        if child["name"] == node["name"] and child.get("children"):
            merged.extend(child["children"])
        elif child["name"] == node["name"]:
            continue  # a leaf repeating its parent adds nothing
        else:
            merged.append(child)
    out = dict(node)
    if merged:
        out["children"] = merged
    else:
        out.pop("children", None)
    return out


def make_names_unique(tree: dict) -> int:
    """Force every node name to be unique, in place. Returns how many changed.

    The game keys its depth index on the node name, so a collision silently
    gives one node another's depth. Three things cause them, and only the first
    is a genuine taxonomic fact:

    - Real homonyms: Gnathostomata is both a vertebrate clade and a sea-urchin
      superfamily.
    - Genus nodes mislabelled with a full binomial, which collide with the
      species of that name once leaves are rewritten to their binomial.
    - Names that are still ambiguous after qualifying by parent, because both
      copies sit under same-named parents.

    Qualifying by parent reads best, so it is tried first; a numeric suffix is
    the fallback that guarantees termination.
    """
    counts: dict[str, int] = {}

    def count(node):
        counts[node["name"]] = counts.get(node["name"], 0) + 1
        for child in node.get("children", []):
            count(child)

    count(tree)

    seen: set[str] = set()
    renamed = 0

    def fix(node, parent):
        nonlocal renamed
        name = node["name"]
        if name in seen or counts[name] > 1:
            candidate = f"{name} ({parent})" if parent else name
            if candidate in seen or candidate == name:
                n = 2
                while f"{name} #{n}" in seen:
                    n += 1
                candidate = f"{name} #{n}"
            if candidate != name:
                node["name"] = candidate
                renamed += 1
        seen.add(node["name"])
        for child in node.get("children", []):
            fix(child, node["name"])

    fix(tree, None)
    return renamed


def title_rank(rank: str) -> str:
    """Capitalise a rank without touching the rest of it.

    The example dataset is uniformly title case — Species, Genus, Family — and
    the scrape's ranks arrive lowercase from Wikidata's own labels, so a scraped
    dataset showed "Species" on a leaf (hardcoded here) and "genus" on its
    parent. The popup displays rank, so both are on screen at once. `.title()`
    is wrong for the multi-word tail of ranks: "species group", not
    "Species Group".
    """
    return rank[:1].upper() + rank[1:]


def convert(node: dict, disambiguated: dict[int, str]) -> dict:
    """Rewrite a scraped node into the game's schema, depth-first.

    Both branches do the same inversion: the scrape's `name` is the English one
    and `scientific_name` the taxon name, and the game wants those the other way
    round. Only the leaves need their common name disambiguated first — theirs
    is what the player types.
    """
    if node.get("children"):
        scientific = node.get("scientific_name") or node["name"]
        out = {
            "name": scientific,
            "rank": title_rank(node.get("rank", "")),
            "children": [convert(c, disambiguated) for c in node["children"]],
        }
        # Only when Wikidata says something the taxon name does not. Most taxa
        # label themselves in Latin and have no vernacular to record.
        if node["name"] != scientific:
            out["common_name"] = node["name"]
        if node.get("qid"):
            out["qid"] = node["qid"]
        return out

    # Leaf: the scrape's `name` is the common name, `scientific_name` the binomial.
    scientific = node.get("scientific_name") or node["name"]
    out = {
        "name": scientific,
        # The leaf's own rank, not a stamped "Species": a leaf that is not a
        # species should never get this far (see drop_childless_taxa), and if
        # one does, its real rank is what lets the shape check refuse it.
        "rank": title_rank(node.get("rank") or "species"),
        "common_name": disambiguated[id(node)],
        "scientific_name": scientific,
    }
    if node.get("qid"):
        out["qid"] = node["qid"]
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--taxon", default="Animalia",
                        help="subtree to extract (default: Animalia)")
    parser.add_argument("--in", dest="src", default=None,
                        help=f"raw scraped tree (default: <data dir>/_cache/{CACHE_RAW_TREE})")
    parser.add_argument("--dataset", default=None,
                        help="name of the dataset to create under data/ "
                             "(default: derived from the taxon and today's date)")
    parser.add_argument("--force", action="store_true",
                        help="overwrite an existing dataset's tree.json")
    args = parser.parse_args()

    src = args.src or cache_dir() / CACHE_RAW_TREE
    name = args.dataset or f"{args.taxon.lower()}-{datetime.date.today():%Y-%m}"
    out = data_dir() / name / "tree.json"

    # Writing into a dataset that already has taxon info would leave the two
    # describing different trees, which is the silent mismatch this layout is
    # meant to make impossible.
    if out.exists() and not args.force:
        sys.exit(f"{out} already exists. Pass --dataset <new-name> to create a "
                 f"separate one, or --force to replace it.")

    full = read_json(src)

    subtree = find_taxon(full, args.taxon)
    if subtree is None:
        sys.exit(f"No taxon named {args.taxon!r} in {src}")

    subtree = collapse_nested_duplicates(subtree)
    subtree, dropped = drop_childless_taxa(subtree)
    if subtree is None:
        sys.exit(f"{args.taxon!r} has no species under it in {src}")

    leaves = list(iter_leaves(subtree))
    if not leaves:
        sys.exit(f"{args.taxon!r} has no species under it in {src}")

    # Disambiguate colliding common names by appending the binomial.
    counts = collections.Counter(leaf["name"] for leaf in leaves)
    disambiguated: dict[int, str] = {}
    collisions = 0
    for leaf in leaves:
        common = leaf["name"]
        scientific = leaf.get("scientific_name") or common
        if counts[common] > 1 and common != scientific:
            disambiguated[id(leaf)] = f"{common} ({scientific})"
            collisions += 1
        else:
            disambiguated[id(leaf)] = common

    tree = convert(subtree, disambiguated)
    renamed = make_names_unique(tree)

    # Belt and braces: the uniquifier is supposed to make this impossible.
    names = collections.Counter()

    def check(node):
        names[node["name"]] += 1
        for child in node.get("children", []):
            check(child)

    check(tree)
    dupes = {n: c for n, c in names.items() if c > 1}
    if dupes:
        sys.exit(f"Refusing to write: {len(dupes)} duplicate node names, e.g. "
                 f"{list(dupes)[:3]}")

    # The same gate the tests put in front of the packaged example. Shape and
    # warmth only: the biology chains need species that a `--taxon Insecta`
    # scrape legitimately will not have, so they are for
    # `validate_dataset.py --dataset <name>` to report after the build rather
    # than a reason to refuse one.
    report = validate(tree, name, checks=(check_shape, check_warmth))
    for note in report.notes:
        print(f"  note: {note}")
    if not report.ok:
        sys.exit("Refusing to write:\n  " + "\n  ".join(report.failures))

    write_json_atomic(out, tree, indent=None)

    print(f"Wrote {out}")
    print(f"  dataset:   {name}")
    print(f"  root:      {tree['name']}")
    print(f"  species:   {len(leaves)}")
    print(f"  taxa dropped, no species under them: {dropped}")
    print(f"  common-name collisions disambiguated: {collisions}")
    print(f"  node names made unique:            {renamed}")
    print(f"\nNext:")
    print(f"  python3 datagen/validate_dataset.py --dataset {name}")
    print(f"  TAXOQUIZ_DATASET={name} python3 datagen/scrape_taxon_info.py")
    print(f"  TAXOQUIZ_DATASET={name} ./start.sh")


if __name__ == "__main__":
    main()

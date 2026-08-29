#!/usr/bin/env python3
"""
Convert a scraped tree into one the game can play on.

`scraper.py` writes `data/tree_of_life.json` rooted at Life, in a *different
shape* from the dataset the game loads. Two things have to change, and both are
silent failures if skipped:

1. **The subtree.** The game expects a single kingdom, not all of life.

2. **The schema is inverted.** The scrape stores the common name in `name` and
   the binomial in `scientific_name`; the game wants `name` to be the binomial
   with the common name in `common_name`. Without this the game raises
   `KeyError: 'common_name'` on the first pick.

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
    TAXOQUIZ_TREE=data/game_tree.json ./start.sh
"""

import argparse
import collections
import json
import sys

from taxoquiz.paths import data_dir


def find_taxon(node: dict, name: str) -> dict | None:
    if node.get("name") == name:
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


def convert(node: dict, disambiguated: dict[int, str]) -> dict:
    """Rewrite a scraped node into the game's schema, depth-first."""
    if node.get("children"):
        return {
            "name": node["name"],
            "rank": node.get("rank", ""),
            "children": [convert(c, disambiguated) for c in node["children"]],
        }

    # Leaf: the scrape's `name` is the common name, `scientific_name` the binomial.
    scientific = node.get("scientific_name") or node["name"]
    return {
        "name": scientific,
        "rank": "Species",
        "common_name": disambiguated[id(node)],
        "scientific_name": scientific,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--taxon", default="Animalia",
                        help="subtree to extract (default: Animalia)")
    parser.add_argument("--in", dest="src", default=None,
                        help="scraped tree (default: <data dir>/tree_of_life.json)")
    parser.add_argument("--out", default=None,
                        help="where to write (default: <data dir>/game_tree.json)")
    args = parser.parse_args()

    src = args.src or data_dir() / "tree_of_life.json"
    out = args.out or data_dir() / "game_tree.json"

    with open(src) as f:
        full = json.load(f)

    subtree = find_taxon(full, args.taxon)
    if subtree is None:
        sys.exit(f"No taxon named {args.taxon!r} in {src}")

    subtree = collapse_nested_duplicates(subtree)

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

    out.parent.mkdir(parents=True, exist_ok=True) if hasattr(out, "parent") else None
    with open(out, "w") as f:
        json.dump(tree, f, ensure_ascii=False)

    print(f"Wrote {out}")
    print(f"  root:      {tree['name']}")
    print(f"  species:   {len(leaves)}")
    print(f"  common-name collisions disambiguated: {collisions}")
    print(f"  node names made unique:            {renamed}")
    print(f"\nPlay on it with:  TAXOQUIZ_TREE={out} ./start.sh")


if __name__ == "__main__":
    main()

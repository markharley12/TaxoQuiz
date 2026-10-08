#!/usr/bin/env python3
"""
Find the nodes in a dataset that look wrong to a person reading them.

`validate_dataset.py` asks "is this tree fit to play on?" and fails a build.
This asks a softer question, "what would look odd in explore?", and fails
nothing: every check here is a heuristic, and a hit is a lead to look at rather
than a defect. The point is to turn "I saw something weird once and forgot
where" into a list.

Each finding names where the fault most likely lies, because that decides who
can fix it:

* **wikidata** — the claim came from Wikidata as-is (a group name filed as a
  species' common name, an outdated binomial, a rank that contradicts the
  tree). Fixable on wikidata.org by anyone, and a rebuild picks it up.
* **wikipedia** — the article or its lead image is the odd part (a species
  whose page is its genus, a range map instead of a photo). Fixable on
  en.wikipedia.org.
* **pipeline** — our own choice made it worse (picking a one-word name when a
  specific one existed). Fixable here.

Usage:
    python3 datagen/audit_dataset.py --dataset wikidata-parents-fixed
    python3 datagen/audit_dataset.py --dataset wikidata-parents-fixed --html audit.html
    python3 datagen/audit_dataset.py --check generic-name --limit 50

Reads `data/_cache/wikidata-species.json` when present, for the common names
a species *could* have been shown by; without it the name checks see only the
one that was chosen.
"""
from __future__ import annotations

import argparse
import collections
import html
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from taxoquiz.game.tree import load_tree                         # noqa: E402
from taxoquiz.paths import cache_dir, taxon_info_read_path, tree_path  # noqa: E402
from taxoquiz.ranks import believed_levels, level_of            # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrape_taxon_info import is_map_image                       # noqa: E402


@dataclass(frozen=True)
class Check:
    id: str
    title: str
    blame: str           # wikidata | wikipedia | pipeline
    why: str             # what a hit means
    fix: str             # what to do about one


CHECKS = {c.id: c for c in [
    Check("generic-name", "Species named after its group", "wikidata",
          "The species is shown by a word that fits its whole family, so it reads as "
          "the group rather than one animal (Etheridgeum pulchrum shown as \"Snake\").",
          "On Wikidata, remove the generic value from the item's common names (P1843), "
          "or give the item a specific English label. Where a specific name already "
          "exists, our picker is also at fault: it takes the first alphabetically."),
    Check("odd-taxon-name", "Taxon name is not a Latin name", "wikidata",
          "A genus or higher taxon whose scientific name (P225) is a binomial, an English "
          "phrase or lower case. Usually a wrong P225, or a species item used as a parent.",
          "Correct the item's taxon name (P225) on Wikidata, or the child's parent taxon "
          "(P171) if it points at a species."),
    Check("odd-species-name", "Species name is not a binomial", "wikidata",
          "A species whose scientific name (P225) is not a Latin binomial at all. "
          "Found first: Oreochromis lidole's taxon name is \"something about fish\".",
          "Restore the binomial on Wikidata, checking the item's history and its "
          "label and enwiki title, which usually still carry it."),
    Check("misfiled-binomial", "Species outside its own genus", "wikidata",
          "The binomial's first word is not the genus it hangs from. Usually Wikidata "
          "holds the old name of a moved species, or a duplicate item for a synonym.",
          "Check the species item: if the genus moved, the current name belongs in P225 "
          "and the old one is a synonym; if two items exist, they may need merging."),
    Check("article-other-species", "Article is about another species", "wikipedia",
          "The species' English Wikipedia link lands on a page titled with a different "
          "binomial, so the popup describes a different name. Often a synonym redirect, "
          "sometimes a wrong sitelink.",
          "If they really are one species, Wikidata's items may want merging. If not, "
          "the redirect or the sitelink is wrong."),
    Check("map-image", "Picture is a map", "wikipedia",
          "The article's lead image is a range or distribution map, which shows on the "
          "node in place of the animal.",
          "Add a photo or drawing of the animal to the article's infobox, if Commons has one."),
    Check("article-wrong-rank", "Article is about a different rank", "wikipedia",
          "A higher taxon whose article opens \"is a species\", or a species whose "
          "article opens \"is a family/order\": the popup describes the wrong level.",
          "Usually a wrong enwiki sitelink on the Wikidata item, or a redirect."),
    Check("latin-common-name", "Common name is a Latin name", "wikidata",
          "The English common name is a binomial, so the game shows two scientific names.",
          "Remove the binomial from the item's common names (P1843) on Wikidata."),
    Check("duplicate-name", "Two species share a name", "wikidata",
          "The name had to be disambiguated with a binomial or a number. Usually two "
          "Wikidata items for the same animal.",
          "Check whether the items are one species; if so, merge them on Wikidata."),
    Check("rank-rejected", "Rank contradicts the tree", "wikidata",
          "A rank that cannot be right where it sits (a suborder above a class). The "
          "game already ignores it, but the popup still shows it.",
          "Correct the taxon rank (P105) on the Wikidata item."),
    Check("info-qid-mismatch", "Popup text is for another item", "pipeline",
          "The taxon text was fetched for a different Wikidata item than the node now has.",
          "Re-run scrape_taxon_info.py for this node."),
    Check("article-is-genus", "Species page is the genus page", "wikipedia",
          "The species has no article of its own and its link is the genus page. "
          "Normal for a monotypic genus; otherwise a stub article would fix it.",
          "Low priority. A missing species article on Wikipedia."),
]}

BLAME_ORDER = ("wikidata", "wikipedia", "pipeline")


@dataclass
class Finding:
    check: str
    name: str
    display: str
    rank: str
    lineage: str
    detail: str
    qid: str | None = None
    wikipedia: str | None = None
    extra: dict = field(default_factory=dict)


# Genus, optional (Subgenus), epithet, optional subspecies; hyphens and the odd
# "×" for hybrids occur in real names.
SPECIES_NAME = re.compile(r"[A-Z][a-z]+( \([A-Z][a-z]+\))?( ×)? [a-z][a-z\-]+( [a-z][a-z\-]+)?")
# Lowercase-latin words like "of" or "the" never start a Latin uninomial, and a
# hyphenated "Pan-X" is how total groups are written, so both are allowed.
LATIN_UNINOMIAL = re.compile(r"[A-Z][a-z]+(-[A-Z]?[a-z]+)?( \(.*\))?( #\d+)?")
BINOMIAL = re.compile(r"[A-Z][a-z]+ [a-z\-]+( [a-z\-]+)?")
MONOTYPIC = re.compile(r"only (extant |living |known )?(member|species)|sole (extant |living )?"
                       r"(member|species)|monotypic", re.I)
OPENS_SPECIES = re.compile(r"\bis an? (\w+ )?species\b", re.I)
# One optional adjective at most: "is a species of fish in the family X" must
# not read as an article about a family.
OPENS_GROUP = re.compile(r"\bis an? (?:(?!species)\w+ )?(family|order|genus|class|phylum|"
                         r"superfamily|subfamily)\b")


def shown(name: str) -> str:
    """A name with invisible characters made visible: "Tylototriton⟨U+00A0⟩shanjing"."""
    return "".join(c if c.isprintable() and (c == " " or not c.isspace()) and ord(c) < 0x2000
                   or c.isalpha() else f"⟨U+{ord(c):04X}⟩" for c in name)


def head_word(name: str) -> str:
    """The noun an English name ends in, ignoring our disambiguation suffixes."""
    name = re.sub(r" \(.*\)$| #\d+$", "", name or "")
    words = re.findall(r"[a-z0-9]+", name.lower())
    return words[-1] if words else ""


def audit(tree: dict, info: dict, species_cache: dict | None) -> list[Finding]:
    by_qid = {}
    if species_cache:
        by_qid = species_cache

    rows: list[tuple[dict, list[dict]]] = []

    def walk(node, anc):
        rows.append((node, anc))
        for c in node.get("children") or []:
            walk(c, anc + [node])

    walk(tree, [])

    genus_names = {n["name"].split()[0] for n, _ in rows if n.get("rank") == "Genus"}
    species_names = {n["name"] for n, _ in rows if not n.get("children")}

    # Disambiguated names that are one animal under two binomials share an
    # epithet (Lampetra tridentata, Entosphenus tridentatus); genuine homonyms
    # (two different "Blind Electric Ray"s) do not, and are not an error.
    def epithet(binomial):
        parts = binomial.split()
        return parts[1][:5] if len(parts) > 1 else ""

    same_name: dict[str, list[str]] = collections.defaultdict(list)
    for n, _ in rows:
        if not n.get("children") and n.get("common_name"):
            base = re.sub(r" \(.*\)$| #\d+$", "", n["common_name"]).lower()
            same_name[base].append(n["name"])
    believed = believed_levels(tree)

    # Head nouns per family, to tell "snake in a family of snakes" from "lion".
    family_heads: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    clade_names: dict[str, tuple[str, int]] = {}

    def family_of(anc):
        for a in reversed(anc):
            if a.get("rank") in ("Family", "Subfamily"):
                return a["name"]
        return anc[-1]["name"] if anc else ""

    def species_below(node):
        kids = node.get("children") or []
        return 1 if not kids else sum(species_below(k) for k in kids)

    for node, anc in rows:
        if not node.get("children"):
            family_heads[family_of(anc)][head_word(node.get("common_name") or "")] += 1
        elif node.get("common_name"):
            clade_names.setdefault(node["common_name"].lower(), (node["name"], species_below(node)))

    out: list[Finding] = []

    for node, anc in rows:
        name = node["name"]
        cn = node.get("common_name") or ""
        rank = node.get("rank") or ""
        leaf = not node.get("children")
        qid = node.get("qid")
        entry = info.get(name) or {}
        title = entry.get("wikipedia_title") or ""
        desc = (entry.get("description") or "")[:300]

        def add(check, detail, **extra):
            out.append(Finding(check, name, cn or name, rank,
                               " › ".join(a["name"] for a in anc[-3:]), detail,
                               qid, entry.get("wikipedia_url"), extra))

        if leaf:
            bare = re.sub(r" \(.*\)$| #\d+$", "", cn)
            cached = by_qid.get(qid) or {}
            # Wikidata's own label is a deliberate choice ("leopard", "cat"), so a
            # short name that *is* the label is the animal's name, not a group's.
            is_label = bare.lower() == (cached.get("label") or "").lower()
            if bare and " " not in bare.strip() and not is_label:
                head = head_word(bare)
                specific = [n for n in cached.get("common_names") or []
                            if " " in n.strip() and head_word(n) == head]
                family = family_of(anc)
                kin = family_heads[family][head] - 1
                clade = clade_names.get(bare.lower())
                if specific and (kin >= 2 or clade):
                    add("generic-name", f"shown as “{bare}”, though Wikidata also lists "
                        + ", ".join(f"“{s}”" for s in specific[:3]),
                        alternatives=specific, kin=kin, family=family)
                elif kin >= 3:
                    add("generic-name", f"shown as “{bare}”, and {kin} other species in "
                        f"{family} are also called something “{head}”", kin=kin, family=family)
                elif clade and clade[0] != name and clade[1] >= 2:
                    add("generic-name", f"shown as “{bare}”, which is also the name of "
                        f"{clade[0]} ({clade[1]} species)", kin=kin, family=family)

            if not SPECIES_NAME.fullmatch(re.sub(r" \(.*\)$| #\d+$", "", name)) \
                    and not SPECIES_NAME.fullmatch(name):
                add("odd-species-name", f"species named “{shown(name)}”")

            g = next((a for a in reversed(anc) if a.get("rank") == "Genus"), None)
            if g and name.split()[0] != g["name"].split()[0]:
                add("misfiled-binomial", f"{name} is filed under the genus {g['name']}")

            if bare and (bare.lower() == name.lower() or bare in species_names):
                add("latin-common-name", f"common name “{cn}” is a binomial")

            twins = [o for o in same_name.get(bare.lower(), [])
                     if o != name and epithet(o) == epithet(name)]
            if twins:
                add("duplicate-name", f"“{bare}” is also {', '.join(twins[:3])}, "
                    "with the same epithet", twins=twins)

            if title and title != name:
                if BINOMIAL.fullmatch(title) and title.split()[0] in genus_names \
                        and title.lower() != bare.lower():
                    add("article-other-species", f"article is “{title}”")
                elif " " not in title and title == name.split()[0]:
                    add("article-is-genus", f"article is the genus page “{title}”")
            if desc and OPENS_GROUP.search(desc.split(".")[0]) and not title == name:
                if not (title and " " not in title and title == name.split()[0]):
                    add("article-wrong-rank", f"article opens: “{desc.split('.')[0][:120]}”")
        else:
            if not LATIN_UNINOMIAL.fullmatch(name):
                add("odd-taxon-name", f"{rank} named “{shown(name)}”",
                    children=[c["name"] for c in node["children"]])
            if rank == "Species":
                add("odd-taxon-name", f"a species with {len(node['children'])} taxa below it")
            first = desc.split(". ")[0]
            # A monotypic genus's article is often its one species; that is fine.
            if first and OPENS_SPECIES.search(first) and level_of(rank) is not None \
                    and f"{name} " not in first and not MONOTYPIC.search(first):
                add("article-wrong-rank", f"{rank}, but its article opens: “{first[:120]}”")
            if level_of(rank) is not None and believed.get(id(node)) is None:
                parent = anc[-1] if anc else None
                add("rank-rejected", f"ranked {rank}"
                    + (f", under {parent['name']} ({parent.get('rank')})" if parent else ""))

        img = entry.get("image_url") or ""
        if img and is_map_image(img):
            add("map-image", "image is " + img.rsplit("/", 1)[-1].split("?")[0])

        if entry.get("qid") and qid and entry["qid"] != qid:
            add("info-qid-mismatch", f"tree has {qid}, popup text is for {entry['qid']}")

    return out


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def print_summary(findings: list[Finding], limit: int) -> None:
    by = collections.defaultdict(list)
    for f in findings:
        by[f.check].append(f)
    for cid, check in CHECKS.items():
        hits = by.get(cid, [])
        print(f"\n{check.title}  [{cid}, fix on {check.blame}]  — {len(hits)}")
        for f in hits[:limit]:
            print(f"    {f.display:<34.34} {f.detail}  {f.qid or ''}")
        if len(hits) > limit:
            print(f"    … {len(hits) - limit} more")


def write_html(findings: list[Finding], dataset: str, species: int, path: Path) -> None:
    template = (Path(__file__).parent / "audit_template.html").read_text()
    payload = {
        "dataset": dataset,
        "species": species,
        "checks": [asdict(c) for c in CHECKS.values()],
        "findings": [asdict(f) for f in findings],
    }
    # `</` inside a script block would end it early; JSON escaping it keeps the
    # data inert whatever an article title contains.
    data = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    page = template.replace("/*__DATA__*/null", data).replace("__DATASET__", html.escape(dataset))
    if "__DATASET__" in page or "/*__DATA__*/" in page:
        raise SystemExit("template placeholders were not replaced")
    path.write_text(page)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", help="dataset name (default: $TAXOQUIZ_DATASET)")
    ap.add_argument("--check", action="append", choices=list(CHECKS),
                    help="only this check (repeatable)")
    ap.add_argument("--limit", type=int, default=8, help="examples printed per check")
    ap.add_argument("--html", type=Path, help="write a browsable report here")
    ap.add_argument("--json", type=Path, help="write the findings as JSON here")
    args = ap.parse_args()

    tree = load_tree(tree_path(args.dataset) if args.dataset else tree_path())
    info_path = taxon_info_read_path(args.dataset)
    info = json.loads(info_path.read_text()) if info_path and info_path.exists() else {}
    cache = cache_dir() / "wikidata-species.json"
    species_cache = json.loads(cache.read_text()) if cache.exists() else None
    if species_cache is None:
        print("note: no species cache, so only the chosen common names are checked",
              file=sys.stderr)

    findings = audit(tree, info, species_cache)
    if args.check:
        findings = [f for f in findings if f.check in args.check]

    species = sum(1 for _ in _leaves(tree))
    print(f"{args.dataset or 'example'}: {species} species, {len(findings)} findings")
    print_summary(findings, args.limit)
    if args.json:
        args.json.write_text(json.dumps([asdict(f) for f in findings], indent=1, ensure_ascii=False))
    if args.html:
        write_html(findings, args.dataset or "example", species, args.html)
        print(f"\nreport: {args.html}")


def _leaves(node):
    kids = node.get("children") or []
    if not kids:
        yield node
    for k in kids:
        yield from _leaves(k)


if __name__ == "__main__":
    main()

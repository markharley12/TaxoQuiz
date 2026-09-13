#!/usr/bin/env python3
"""
Check a dataset's tree for the mistakes that have actually been made.

Why this exists
---------------
Two bugs of the same shape reached the game a month apart, and neither was
visible from the code:

1. `RANK_LABELS` in the scraper mislabelled 15 of the 23 rank Q-IDs it covered,
   so 355 beetle superfamilies were stored as `Subkingdom`.
2. `example_tree.json` went Animalia -> Phylum with nothing between, so a human
   and a starfish scored exactly what a human and a sea sponge did — the two
   are deuterostomes, and the tree had nowhere to say so.

Both are *data* errors that every test passed straight through, because the
tests checked the code against fixtures rather than the shipped tree against
what is true. That is what this file is for: run it over any dataset and it
answers "is this tree fit to play on?".

The checks fall in three groups, weakest first:

* **Shape** — the invariants the game's own code assumes: unique names, a leaf
  is a species, a taxon has children.
* **Warmth** — the invariant the colour scale needs, which is the one both bugs
  above broke: going deeper into the tree may never get colder. Reported
  alongside how many rank claims `taxoquiz.ranks` had to reject, which is the
  early-warning number: a healthy dataset rejects almost none.
* **Biology** — a short table of relationships nobody disputes, asserted as an
  *ordering* rather than a number, so it holds on a 530-species example and a
  41,167-species scrape alike. This is the group that catches a tree which is
  internally consistent and still wrong, which is exactly what the flat example
  was. Pairs whose species are not in the dataset are skipped, not failed.

Usage:
    python3 datagen/validate_dataset.py                 # the selected dataset
    python3 datagen/validate_dataset.py --dataset wikidata-2026-09
    python3 datagen/validate_dataset.py --all           # every dataset on disk

Exits non-zero if anything fails, so it can gate a build — `extract_game_tree.py`
runs the shape and warmth checks before it writes.
"""
from __future__ import annotations

import argparse
import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from taxoquiz.game.tree import get_species, load_tree          # noqa: E402
from taxoquiz.paths import available_datasets, tree_path       # noqa: E402
from taxoquiz.ranks import believed_levels, level_of, rank_levels  # noqa: E402


# --------------------------------------------------------------------------
# Ground truth
# --------------------------------------------------------------------------

# Chains of species that must come out in this order of relatedness, warmest
# first, when scored against the first one. Written as scientific names because
# those are stable across datasets; vernacular names are not ("common starfish"
# in the example is "Common sea star" in the scrape).
#
# Every one of these is a textbook relationship rather than a judgement call —
# the point is that no plausible taxonomy disagrees, so a dataset that fails is
# wrong rather than merely different. The first chain is the one the flat
# example failed: it scored the last four items identically.
GROUND_TRUTH: list[tuple[str, list[str]]] = [
    ("Homo sapiens", [
        "Pan troglodytes",        # same subfamily
        "Panthera leo",           # both placental mammals
        "Gallus gallus",          # both amniotes
        "Salmo salar",            # both vertebrates
        "Asterias rubens",        # both deuterostomes
        "Vespula vulgaris",       # both bilaterians
        "Acropora cervicornis",   # both eumetazoans
        "Spongia officinalis",    # both animals, and no more
    ]),
    ("Apis mellifera", [
        "Bombus terrestris",      # same family
        "Vespula vulgaris",       # both hymenopterans
        "Danaus plexippus",       # both insects
        "Homarus gammarus",       # both arthropods
        "Octopus vulgaris",       # both protostomes
        "Asterias rubens",        # both bilaterians
        "Aurelia aurita",         # both eumetazoans
    ]),
    ("Desmodus rotundus", [
        # A bat is a laurasiathere, a placental, a therian, a mammal, an
        # amniote — in that order. This chain is here because the Sep 2026
        # scrape fails it: Wikidata's `parent taxon` for Chiroptera is Mammalia
        # itself, so the whole order hangs off the class and a bat's ancestry
        # with any other placental collapses to "both mammals".
        "Canis lupus",            # both laurasiatheres
        "Homo sapiens",           # both placentals
        "Macropus rufus",         # both therians
        "Ornithorhynchus anatinus",  # both mammals
        "Crocodylus niloticus",   # both amniotes
        "Rana temporaria",        # both tetrapods
    ]),
    ("Panthera leo", [
        "Panthera tigris",        # same genus
        "Canis lupus",            # both carnivorans
        "Homo sapiens",           # both placental mammals
        "Carcharodon carcharias",  # both vertebrates
        "Lumbricus terrestris",   # both bilaterians
    ]),
]


class Report:
    """Collected findings. Failures fail the run; notes are printed only."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.failures: list[str] = []
        self.notes: list[str] = []

    def fail(self, msg: str) -> None:
        self.failures.append(msg)

    def note(self, msg: str) -> None:
        self.notes.append(msg)

    @property
    def ok(self) -> bool:
        return not self.failures


def walk(node: dict, parent: dict | None = None):
    yield node, parent
    for child in node.get("children") or []:
        yield from walk(child, node)


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------

def check_shape(tree: dict, r: Report) -> None:
    """The invariants the game's own code assumes about a tree."""
    names = collections.Counter()
    for node, parent in walk(tree):
        if not node.get("name"):
            r.fail(f"a node under {parent and parent.get('name')!r} has no name")
            continue
        names[node["name"]] += 1
        if node.get("children") is not None and not node["children"]:
            r.fail(f"{node['name']!r} has an empty children list; a leaf must omit it")

    dupes = {n: c for n, c in names.items() if c > 1}
    if dupes:
        # The depth index is keyed on the name, so a duplicate silently corrupts
        # play rather than raising anywhere.
        r.fail(f"{len(dupes)} duplicate node names, e.g. {sorted(dupes)[:3]}")

    leaf_ranks = collections.Counter(
        (node.get("rank") or "").strip().lower()
        for node, _ in walk(tree) if not node.get("children")
    )
    off = {k: v for k, v in leaf_ranks.items() if k not in ("species", "subspecies")}
    if off:
        # A failure, not a note. Every leaf is something a player can guess and a
        # seed can pick, so a leaf that is not a species is a fake animal. This
        # was a note, and extract_game_tree.py stamped "Species" on every leaf
        # anyway, so the Sep 2026 rebuild shipped 189 childless clades as
        # species — Apo-Chiroptera among them, beside the real bats.
        r.fail(f"{sum(off.values())} leaves are not species: {dict(list(off.items())[:5])}")


def check_warmth(tree: dict, r: Report) -> None:
    """Deeper may never be colder — the invariant the colour scale needs."""
    warmth = rank_levels(tree)
    believed = believed_levels(tree)

    inversions = [
        (parent["name"], node["name"], warmth[parent["name"]], warmth[node["name"]])
        for node, parent in walk(tree)
        if parent is not None and warmth[node["name"]] < warmth[parent["name"]] - 1e-9
    ]
    if inversions:
        first = inversions[0]
        r.fail(f"{len(inversions)} warmth inversions, e.g. {first[0]} {first[2]:.3f} "
               f"-> {first[1]} {first[3]:.3f}")

    ranked = [n for n, _ in walk(tree) if level_of(n.get("rank")) is not None]
    rejected = [n for n in ranked if believed[id(n)] is None]
    if ranked:
        share = 100 * len(rejected) / len(ranked)
        line = (f"rank claims rejected as inconsistent with the tree: "
                f"{len(rejected)} of {len(ranked)} ({share:.2f}%)")
        # Not a failure: the belief check exists precisely so a bad label is
        # survivable. A high share means the *source* of the ranks is rotten
        # and worth repairing upstream, which is a judgement for a person.
        (r.fail if share > 5 else r.note)(line)
        if rejected:
            by_rank = collections.Counter(n.get("rank") for n in rejected)
            r.note(f"  most rejected: {by_rank.most_common(4)}")


def check_biology(tree: dict, r: Report) -> None:
    """A handful of undisputed relationships, asserted as an ordering."""
    warmth = rank_levels(tree)
    index: dict[str, list[str]] = {}

    def lineages(node: dict, path: list[str]) -> None:
        path = path + [node["name"]]
        if not node.get("children"):
            index[node["name"]] = path
            return
        for child in node["children"]:
            lineages(child, path)

    lineages(tree, [])

    def lca_warmth(a: str, b: str) -> float:
        shared = ""
        for x, y in zip(index[a], index[b]):
            if x != y:
                break
            shared = x
        return warmth[shared]

    checked = skipped = 0
    for anchor, chain in GROUND_TRUTH:
        if anchor not in index:
            skipped += len(chain)
            continue
        present = [s for s in chain if s in index]
        skipped += len(chain) - len(present)
        scores = [(s, lca_warmth(anchor, s)) for s in present]
        for (near, hot), (far, cold) in zip(scores, scores[1:]):
            checked += 1
            if not hot > cold:
                r.fail(f"{anchor} vs {near} ({hot:.3f}) should beat {anchor} vs "
                       f"{far} ({cold:.3f}) — they are not equally related")
    r.note(f"biology: {checked} orderings checked, {skipped} pairs skipped (not in dataset)")


CHECKS = (check_shape, check_warmth, check_biology)


def validate(tree: dict, name: str = "tree", checks=CHECKS) -> Report:
    """Run `checks` over an already-loaded tree."""
    report = Report(name)
    for check in checks:
        check(tree, report)
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", help="dataset name (default: $TAXOQUIZ_DATASET)")
    ap.add_argument("--all", action="store_true", help="every dataset on disk")
    args = ap.parse_args()

    if args.all:
        names = available_datasets()
    elif args.dataset:
        names = [args.dataset]
    else:
        names = [None]

    worst = 0
    for name in names:
        path = tree_path(name) if name else tree_path()
        tree = load_tree(path)
        species = len(get_species(tree))
        report = validate(tree, name or "example")
        head = f"{report.name}  ({species} species, {path})"
        print(head)
        print("-" * len(head))
        for note in report.notes:
            print(f"  note: {note}")
        for failure in report.failures:
            print(f"  FAIL: {failure}")
        print(f"  => {'OK' if report.ok else str(len(report.failures)) + ' FAILURES'}\n")
        worst = max(worst, 0 if report.ok else 1)
    sys.exit(worst)


if __name__ == "__main__":
    main()

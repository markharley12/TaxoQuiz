#!/usr/bin/env python3
"""
Build data/taxon_list.json — the input to scrape_taxon_info.py.

The list is every *ancestor* node in the game tree (i.e. every node that has
children), which is what the info popup can be opened on. Species leaves are
excluded: the popup is for taxa, not for the animals you guess.

Existing Q-IDs are preserved. `qid` is only a fallback for scrape_taxon_info.py,
used when a taxon name doesn't resolve to a Wikipedia page directly, so entries
without one are fine — they just rely on the name lookup.

Writes into the selected dataset, so it always matches the tree you'll play on:

    python3 datagen/build_taxon_list.py                       # the example dataset
    TAXOQUIZ_DATASET=wikidata-2026-08 python3 datagen/build_taxon_list.py
"""

import argparse
import pathlib

from taxoquiz.jsonio import read_json, write_json_atomic
from taxoquiz.paths import current_dataset, taxon_list_path, tree_path


def collect_ancestors(node: dict, out: list) -> list:
    """Every node with children, depth-first, parents before their children."""
    if not node.get("children"):
        return out
    out.append({"name": node["name"], "rank": node.get("rank")})
    for child in node["children"]:
        collect_ancestors(child, out)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tree", default=None,
                        help="tree JSON to read (default: the selected dataset's tree)")
    parser.add_argument("--out", default=None,
                        help="where to write (default: the selected dataset's taxon_list.json)")
    args = parser.parse_args()

    src = args.tree or tree_path()
    out = pathlib.Path(args.out) if args.out else taxon_list_path()
    print(f"dataset: {current_dataset()}  tree: {src}")

    tree = read_json(src)

    taxa = collect_ancestors(tree, [])

    # Carry over any Q-IDs already resolved, so a rebuild never loses them.
    known: dict[str, str] = {}
    if out.exists():
        known = {t["name"]: t["qid"] for t in read_json(out) if t.get("qid")}

    for taxon in taxa:
        taxon["qid"] = known.get(taxon["name"])

    write_json_atomic(out, taxa)

    with_qid = sum(1 for t in taxa if t["qid"])
    print(f"Wrote {len(taxa)} taxa to {out} ({with_qid} with a Q-ID).")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Build data/taxon_list.json — the input to scrape_taxon_info.py.

The list is every *ancestor* node in the game tree (i.e. every node that has
children), which is what the info popup can be opened on. Species leaves are
excluded: the popup is for taxa, not for the animals you guess.

Existing Q-IDs are preserved. `qid` is only a fallback for scrape_taxon_info.py,
used when a taxon name doesn't resolve to a Wikipedia page directly, so entries
without one are fine — they just rely on the name lookup.

Usage:
    python3 build_taxon_list.py                  # from animals_tree.json
    python3 build_taxon_list.py --tree data/tree_of_life.json
"""

import argparse
import json
import os

DEFAULT_TREE = "animals_tree.json"
OUT_PATH = "data/taxon_list.json"


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
    parser.add_argument("--tree", default=DEFAULT_TREE,
                        help=f"tree JSON to read (default: {DEFAULT_TREE})")
    parser.add_argument("--out", default=OUT_PATH,
                        help=f"where to write (default: {OUT_PATH})")
    args = parser.parse_args()

    with open(args.tree) as f:
        tree = json.load(f)

    taxa = collect_ancestors(tree, [])

    # Carry over any Q-IDs already resolved, so a rebuild never loses them.
    known: dict[str, str] = {}
    if os.path.exists(args.out):
        with open(args.out) as f:
            known = {t["name"]: t["qid"] for t in json.load(f) if t.get("qid")}

    for taxon in taxa:
        taxon["qid"] = known.get(taxon["name"])

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(taxa, f, indent=2, ensure_ascii=False)

    with_qid = sum(1 for t in taxa if t["qid"])
    print(f"Wrote {len(taxa)} taxa to {args.out} ({with_qid} with a Q-ID).")


if __name__ == "__main__":
    main()

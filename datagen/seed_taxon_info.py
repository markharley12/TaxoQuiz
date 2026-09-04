#!/usr/bin/env python3
"""Seed a new dataset's `taxon_info.json` from an existing one.

`scrape_taxon_info.py` fetches only nodes it does not already have, and its file
is keyed by node name. A bigger dataset built from the same Wikidata scrape shares
almost every name with the smaller one it grew out of — so copying the old file
across turns a full scrape of every node into a scrape of just the new ones.

**The Q-ID is what makes this safe.** Names are near-stable between trees, but
`extract_game_tree.make_names_unique` can attach a uniquifier suffix
(`Lepus (Lepus)`) differently as the tree grows, and a name that means a different
taxon in the new tree would otherwise carry the old one's article across. Both the
tree and `taxon_info.json` record a Q-ID, so the check is exact: an entry whose
Q-ID disagrees with the new tree's node of that name is dropped and re-fetched.

Entries for names the new tree does not have are dropped too — they are dead
weight, and keeping them would make the file describe a tree it is not for, which
is the mismatch the dataset layout exists to prevent.

    python3 datagen/seed_taxon_info.py --from wikidata-2026-08 --to wikidata-2026-09
    python3 datagen/seed_taxon_info.py --from A --to B --dry-run
"""
import argparse
import sys

from taxoquiz.game.tree import load_tree, qid_of
from taxoquiz.jsonio import read_json, write_json_atomic
from taxoquiz.paths import taxon_info_path, taxon_info_read_path, tree_path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="src", required=True, help="dataset to copy from")
    ap.add_argument("--to", dest="dst", required=True, help="dataset to seed")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args()

    src_path = taxon_info_read_path(args.src)
    if not src_path:
        print(f"No taxon_info.json for {args.src!r} — nothing to seed from.", file=sys.stderr)
        return 1

    dst_info = taxon_info_path(args.dst)
    if dst_info.exists():
        print(f"{dst_info} already exists — refusing to overwrite. "
              f"Delete it first if seeding is really what you want.", file=sys.stderr)
        return 1

    old = read_json(src_path)
    new_tree = load_tree(tree_path(args.dst))
    new_qids = qid_of(new_tree)

    kept, absent, mismatched = {}, 0, 0
    for name, entry in old.items():
        if name not in new_qids:
            absent += 1
            continue
        # Only judge where both sides actually carry a Q-ID; a hand-curated tree
        # has none, and "unknown" is not "wrong".
        want, have = new_qids.get(name), entry.get("qid")
        if want and have and want != have:
            mismatched += 1
            continue
        kept[name] = entry

    total_new = len(new_qids)
    print(f"source          : {src_path}  ({len(old):,} entries)")
    print(f"target dataset  : {args.dst}  ({total_new:,} nodes)")
    print(f"  kept          : {len(kept):,}")
    print(f"  not in tree   : {absent:,}")
    print(f"  Q-ID mismatch : {mismatched:,}  (dropped — will be re-fetched)")
    print(f"  still to fetch: {total_new - len(kept):,}")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return 0

    dst_info.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(dst_info, kept)
    print(f"\nWritten {dst_info}")
    print(f"Now run:  TAXOQUIZ_DATASET={args.dst} python3 datagen/scrape_taxon_info.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

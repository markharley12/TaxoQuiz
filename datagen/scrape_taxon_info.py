"""
Fetch Wikipedia summaries and thumbnails for every taxon in the selected dataset.

Reads  <dataset>/tree.json        for the taxa to fetch — the tree already says
                                  exactly which nodes exist, so there is no
                                  separate list file to keep in step with it.
Writes <dataset>/taxon_info.json  in place, atomically. An interrupted run cannot
                                  destroy what is already there; rerunning
                                  resumes and fetches only what is missing.

`rank` is deliberately not stored here — it lives in tree.json, and a second copy
could disagree with the tree it describes. The API reads it from the tree.

Usage:
    python3 datagen/scrape_taxon_info.py                  # fetch whatever is missing
    python3 datagen/scrape_taxon_info.py --retry-missing  # also retry previous failures

The Wikipedia REST summary API returns:
    extract       — first paragraph, plain text
    thumbnail.source — image URL (resized)
    content_urls.desktop.page — full Wikipedia URL
"""

import json
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
import sys
import os

SUMMARY_API = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
WIKIDATA_API = "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
HEADERS = {"User-Agent": "TaxoQuiz/1.0 (https://github.com/markharley12/TaxoQuiz)"}
DELAY = 0.5  # seconds between requests — be polite

from taxoquiz.game.tree import get_ancestors, load_tree, qid_of
from taxoquiz.jsonio import read_json, write_json_atomic
from taxoquiz.paths import current_dataset, taxon_info_path

OUT_PATH = taxon_info_path()


def fetch_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        print(f"  HTTP {e.code}: {url}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  Error fetching {url}: {e}", file=sys.stderr)
        return None


def fetch_by_title(title: str) -> dict | None:
    url = SUMMARY_API.format(title=urllib.parse.quote(title, safe=""))
    return fetch_json(url)


def fetch_by_qid(qid: str) -> dict | None:
    """Get the English Wikipedia title from Wikidata, then fetch the summary."""
    data = fetch_json(WIKIDATA_API.format(qid=qid))
    if not data:
        return None
    entity = data.get("entities", {}).get(qid, {})
    sitelinks = entity.get("sitelinks", {})
    enwiki = sitelinks.get("enwiki", {})
    title = enwiki.get("title")
    if not title:
        return None
    time.sleep(DELAY)
    return fetch_by_title(title)


def extract_info(summary: dict) -> dict:
    return {
        "description": summary.get("extract", ""),
        "image_url": (summary.get("thumbnail") or {}).get("source", ""),
        "wikipedia_url": summary.get("content_urls", {}).get("desktop", {}).get("page", ""),
        "wikipedia_title": summary.get("title", ""),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--retry-missing", action="store_true",
                        help="Re-fetch entries that previously returned no extract")
    args = parser.parse_args()

    print(f"dataset: {current_dataset()}")

    # The tree is the list. Every node with children is a taxon the popup can be
    # opened on, so there is nothing to generate or keep in sync beforehand.
    tree = load_tree()
    taxa = [t["name"] for t in get_ancestors(tree)]
    # Scraped trees carry a Q-ID per node; hand-curated ones don't, in which case
    # any Q-ID recorded by an earlier run is used instead.
    tree_qids = qid_of(tree)

    # Load existing results. Writes below are atomic, so an interrupted run can
    # never destroy what is already here — it resumes from the last checkpoint.
    if OUT_PATH.exists():
        results: dict[str, dict] = read_json(OUT_PATH)
        # `rank` used to be stored here; it comes from the tree now. A null
        # `qid` used to be written for every taxon that never had one. Drop both
        # on load so they are gone the next time the file is written.
        for entry in results.values():
            entry.pop("rank", None)
            if entry.get("qid") is None:
                entry.pop("qid", None)
        print(f"Loaded {len(results)} existing entries from {OUT_PATH}")
    else:
        results = {}

    # An entry with no description is a previous failure, not a fetched blank —
    # only --retry-missing goes back for those.
    to_process = [
        name for name in taxa
        if name not in results or (args.retry_missing and not results[name].get("description"))
    ]

    print(f"Processing {len(to_process)} taxa (of {len(taxa)} in the tree)...")

    for i, name in enumerate(to_process):
        # A Q-ID may have been recorded on a previous run; it is only a fallback
        # for names Wikipedia does not resolve directly.
        qid = tree_qids.get(name) or results.get(name, {}).get("qid")
        pct = f"{i+1}/{len(to_process)}"

        summary = fetch_by_title(name)
        time.sleep(DELAY)

        if not summary or not summary.get("extract"):
            if qid:
                print(f"[{pct}] {name} — not found by name, trying Q-ID {qid}")
                summary = fetch_by_qid(qid)
                time.sleep(DELAY)
            else:
                print(f"[{pct}] {name} — not found, no Q-ID fallback")

        entry = {"qid": qid} if qid else {}
        if summary and summary.get("extract"):
            info = extract_info(summary)
            results[name] = {**entry, **info}
            print(f"[{pct}] {name} — OK ({len(info['description'])} chars)")
        else:
            results[name] = {**entry, "description": "", "image_url": "",
                             "wikipedia_url": "", "wikipedia_title": ""}
            print(f"[{pct}] {name} — no data found")

        # Save incrementally every 50 entries
        if (i + 1) % 50 == 0:
            write_json_atomic(OUT_PATH, results)
            print(f"  → saved checkpoint ({len(results)} entries)")

    write_json_atomic(OUT_PATH, results)

    found = sum(1 for v in results.values() if v.get("description"))
    print(f"\nDone. {found}/{len(results)} taxa have descriptions.")
    print(f"Output: {OUT_PATH}")


if __name__ == "__main__":
    main()

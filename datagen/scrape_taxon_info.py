"""
Fetch Wikipedia summaries and thumbnails for every node in the selected dataset —
both the internal taxa and the species at the leaves.

Reads  <dataset>/tree.json        for the nodes to fetch — the tree already says
                                  exactly which ones exist, so there is no
                                  separate list file to keep in step with it.
Writes <dataset>/taxon_info.json  in place, atomically. An interrupted run cannot
                                  destroy what is already there; rerunning
                                  resumes and fetches only what is missing.

`rank` and `common_name` are deliberately not stored here — they live in
tree.json, and a second copy could disagree with the tree it describes. The API
reads both from the tree.

**Titles come from the Q-ID where there is one.** A Q-ID is a taxon's stable,
language-independent identity, so asking Wikidata "what is this thing's English
Wikipedia article?" is exact, where fetching a guessed title relies on a
redirect happening to exist and point somewhere sensible. Wikidata answers **50
at a time** (`wbgetentities`), which works out at about one extra request per
fifty nodes — cheaper than guessing, not dearer, because it also removes the
404-then-retry that every wrong guess used to cost.

Not every tree has Q-IDs: scraped ones carry them on every node, hand-curated
ones carry none, so **the by-name path below is still the fallback and still
has to work.**

**Where a name is used, species use the scientific one.** The common names in
the tree are often a rank too general — "gazelle", "hamster", "right whale" —
and fetching those returns the article about the group. The scientific name
redirects to the exact species: `Gazella gazella` resolves to "Mountain gazelle"
and `Mesocricetus auratus` to "Golden hamster".

Usage:
    python3 datagen/scrape_taxon_info.py                  # fetch whatever is missing
    python3 datagen/scrape_taxon_info.py --retry-missing  # also retry previous failures
    python3 datagen/scrape_taxon_info.py --only species   # scope a long run

Everything is batched, which is what makes a full species run practical:

    Wikidata  wbgetentities   50 Q-IDs  -> exact article titles
    Wikipedia action=query    20 titles -> extract + thumbnail

`exlimit=max` is 20 for anonymous callers and is the binding constraint. A full
18,421-species run is ~920 summary requests plus ~370 title ones, rather than one
request per species; measured at 20 titles in 0.55s, that is minutes instead of
hours. The per-page REST summary endpoint this used to call is gone — it could
only ever do one article at a time.
"""

import json
import re
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
import sys
import os

# Wikipedia's Action API returns extracts and thumbnails for many titles at once,
# where the REST summary endpoint above does one page per request. `exlimit=max`
# is 20 for anonymous callers, which is the binding constraint — this is the
# difference between ~18,400 requests for a full species run and ~920.
SUMMARY_BATCH = (
    "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
    "&prop=extracts|pageimages&exintro=1&explaintext=1&exlimit=max"
    "&piprop=thumbnail&pithumbsize=320&titles={titles}"
)
TITLE_BATCH = 20
WIKI_PAGE = "https://en.wikipedia.org/wiki/{title}"
# Batch endpoint: up to 50 entities per call, and `props`/`sitefilter` keep the
# response to just the English title rather than the whole entity, which for a
# taxon can be tens of kilobytes of statements nothing here reads.
WIKIDATA_BATCH = (
    "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json"
    "&props=sitelinks&sitefilter=enwiki&ids={ids}"
)
QID_BATCH = 50
HEADERS = {"User-Agent": "TaxoQuiz/1.0 (https://github.com/markharley12/TaxoQuiz)"}
DELAY = 0.5  # seconds between requests — be polite

from taxoquiz.game.tree import common_name_of, get_ancestors, get_species, load_tree, qid_of
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


def resolve_titles(qids: list[str]) -> dict[str, str]:
    """Map Q-ID to English Wikipedia title, `QID_BATCH` at a time.

    Missing entries mean "no English article", which is a real answer worth
    having: it stops the caller wasting a request on a title that cannot exist.
    A failed batch returns nothing rather than raising, so the by-name path
    still gets its turn.
    """
    out: dict[str, str] = {}
    for i in range(0, len(qids), QID_BATCH):
        chunk = qids[i:i + QID_BATCH]
        data = fetch_json(WIKIDATA_BATCH.format(ids="|".join(chunk)))
        time.sleep(DELAY)
        if not data:
            continue
        for qid, entity in (data.get("entities") or {}).items():
            title = ((entity.get("sitelinks") or {}).get("enwiki") or {}).get("title")
            if title:
                out[qid] = title
    return out


# Suffixes `extract_game_tree.make_names_unique` adds when two nodes would
# otherwise share a name: a parent qualifier, or a counter.
UNIQUIFIER = re.compile(r" \(.+\)$| #\d+$")


def candidate_titles(name: str, qid_title: str | None, common: str | None) -> list[str]:
    """Titles to try for one node, best first, deduplicated.

    1. The Q-ID's article, which is exact where it exists.
    2. The node's own name.
    3. The name with any uniquifier suffix stripped. `Lepus (Lepus)` is this
       tree's way of saying "the Lepus under Lepus"; Wikipedia just calls it
       `Lepus`. Only 19 of 27,169 names are uniquified and the Q-ID usually
       covers them, but where it does not this recovers every one.
       Last-resort on purpose: the suffix exists precisely because two nodes
       share the bare name, so the stripped title is the *right* article only
       when the other one is not also missing.
    4. The common name, which only species have and which is often a rank too
       general — see the module docstring.
    """
    stripped = UNIQUIFIER.sub("", name)
    ordered = [qid_title, name, stripped if stripped != name else None, common]
    return list(dict.fromkeys(t for t in ordered if t))


def fetch_summaries(titles: list[str]) -> dict[str, dict]:
    """Fetch extracts and thumbnails for many titles, `TITLE_BATCH` per request.

    Returns a map keyed by the title **as asked for**, so the caller does not
    have to know what it redirected to. Titles with no article are absent.

    Wikipedia rewrites titles twice on the way in — `normalized` fixes case and
    underscores, `redirects` follows the redirect — and reports both as
    from/to pairs. Chasing that chain is what maps an answer back to the
    question: `Gazella gazella` comes back as `Mountain gazelle`, and without
    following it every redirected species would look like a miss.
    """
    out: dict[str, dict] = {}
    for i in range(0, len(titles), TITLE_BATCH):
        chunk = titles[i:i + TITLE_BATCH]
        url = SUMMARY_BATCH.format(titles=urllib.parse.quote("|".join(chunk), safe="|"))
        data = fetch_json(url)
        time.sleep(DELAY)
        if not data or "query" not in data:
            continue
        query = data["query"]

        alias: dict[str, str] = {}
        for key in ("normalized", "redirects"):
            for pair in query.get(key, []):
                alias[pair["from"]] = pair["to"]

        by_title = {p["title"]: p for p in query.get("pages", {}).values()}

        for asked in chunk:
            resolved = asked
            # Bounded rather than `while`: a redirect loop in the data would
            # otherwise hang the scrape.
            for _ in range(5):
                if resolved not in alias:
                    break
                resolved = alias[resolved]
            page = by_title.get(resolved)
            if not page or "missing" in page or not page.get("extract"):
                continue
            title = page["title"]
            out[asked] = {
                # The Action API's plaintext extracts carry trailing newlines
                # where the old per-page endpoint did not; strip so the two
                # formats are byte-comparable and the UI needs no trimming.
                "description": page["extract"].strip(),
                "image_url": (page.get("thumbnail") or {}).get("source", ""),
                "wikipedia_url": WIKI_PAGE.format(
                    title=urllib.parse.quote(title.replace(" ", "_"), safe="")
                ),
                "wikipedia_title": title,
            }
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--retry-missing", action="store_true",
                        help="Re-fetch entries that previously returned no extract")
    # Existing entries are kept by default because re-fetching is usually
    # wasted work. It is not wasted after a change to *how* a title is chosen:
    # entries written by the old by-name path may point at a plausible wrong
    # article, and only re-fetching through the Q-ID can correct that.
    parser.add_argument("--refresh", action="store_true",
                        help="Re-fetch every selected node, even ones already present")
    # A full species run is hours on a big scrape, so it is worth being able to
    # do the taxa and the species as separate sittings. Resuming makes this
    # safe either way — it only ever fetches what is missing.
    parser.add_argument("--only", choices=("taxa", "species", "all"), default="all",
                        help="Restrict to internal taxa or to species (default: both)")
    args = parser.parse_args()

    print(f"dataset: {current_dataset()}")

    # The tree is the list. Every node is something the popup can be opened on,
    # so there is nothing to generate or keep in sync beforehand.
    tree = load_tree()
    taxa: list[str] = []
    if args.only in ("taxa", "all"):
        taxa += [t["name"] for t in get_ancestors(tree)]
    if args.only in ("species", "all"):
        taxa += [s["name"] for s in get_species(tree)]
    # Scraped trees carry a Q-ID per node; hand-curated ones don't, in which case
    # any Q-ID recorded by an earlier run is used instead.
    tree_qids = qid_of(tree)
    tree_common = common_name_of(tree)

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

    # Entries predating Q-ID recording carry none. Backfill from the tree so the
    # file is uniform whether or not a given entry gets re-fetched this run.
    backfilled = 0
    for name, entry in results.items():
        if not entry.get("qid") and tree_qids.get(name):
            entry["qid"] = tree_qids[name]
            backfilled += 1
    if backfilled:
        print(f"Backfilled {backfilled} Q-IDs from the tree")

    # An entry with no description is a previous failure, not a fetched blank —
    # only --retry-missing goes back for those.
    to_process = [
        name for name in taxa
        if args.refresh
        or name not in results
        or (args.retry_missing and not results[name].get("description"))
    ]

    print(f"Processing {len(to_process)} nodes (of {len(taxa)} selected)...")

    # Two batched stages per chunk, instead of a request per node.
    #
    #   1. Q-ID -> exact article title      (Wikidata, 50 at a time)
    #   2. title -> extract + thumbnail     (Wikipedia, 20 at a time)
    #
    # A chunk is sized to the Wikidata batch, so one pass fires one title
    # request and a handful of summary ones. Fallbacks are per-node but only
    # run for what stage 2 missed, which is a few percent.
    CHUNK = QID_BATCH
    for start in range(0, len(to_process), CHUNK):
        batch = to_process[start:start + CHUNK]
        qid_of_name = {
            n: (tree_qids.get(n) or results.get(n, {}).get("qid")) for n in batch
        }

        known_qids = [q for q in qid_of_name.values() if q]
        titles_by_qid = resolve_titles(known_qids) if known_qids else {}

        # Try each node's candidates in rounds. Round 0 is one batched request
        # for the whole chunk; later rounds only carry what is still missing,
        # which is a few percent, so the fallbacks cost very little.
        candidates = {
            n: candidate_titles(
                n, titles_by_qid.get(qid_of_name[n]), tree_common.get(n)
            )
            for n in batch
        }
        resolved: dict[str, dict] = {}
        for round_no in range(max(len(c) for c in candidates.values())):
            pending = {
                n: c[round_no] for n, c in candidates.items()
                if n not in resolved and len(c) > round_no
            }
            if not pending:
                break
            hits = fetch_summaries(list(dict.fromkeys(pending.values())))
            for n, title in pending.items():
                if title in hits:
                    resolved[n] = hits[title]

        for j, name in enumerate(batch):
            info = resolved.get(name)
            qid = qid_of_name[name]
            entry = {"qid": qid} if qid else {}
            pct = f"{start + j + 1}/{len(to_process)}"
            if info:
                results[name] = {**entry, **info}
                print(f"[{pct}] {name} — OK ({len(info['description'])} chars)")
            else:
                results[name] = {**entry, "description": "", "image_url": "",
                                 "wikipedia_url": "", "wikipedia_title": ""}
                print(f"[{pct}] {name} — no data found")

        write_json_atomic(OUT_PATH, results)
        print(f"  → saved checkpoint ({len(results)} entries)")

    write_json_atomic(OUT_PATH, results)

    found = sum(1 for v in results.values() if v.get("description"))
    print(f"\nDone. {found}/{len(results)} nodes have descriptions.")
    print(f"Output: {OUT_PATH}")


if __name__ == "__main__":
    main()

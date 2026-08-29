#!/usr/bin/env python3
"""
Scraper for building a full tree of life from Wikidata.

Fetches all species with English common names and >= MIN_SITELINKS sitelinks,
walks up the P171 (parent taxon) chain iteratively to build complete lineages,
and outputs a nested tree JSON.

Covers all of life — not just animals. Game modes can filter to any subtree
(e.g. start at Animalia, Plantae, Fungi) at runtime.

--- WHY WE DON'T USE P171+ (recursive property paths) ---

Wikidata's SPARQL endpoint times out on any query using `wdt:P171+` over
the full species set. Recursive path traversal over millions of nodes is
too expensive for the public endpoint.

Instead we build the tree ourselves in three stages:

  Stage 1 — Fetch species in paginated batches.
             Simple indexed lookups: rank=species + common name + sitelinks.
             No recursion. ~9 pages at threshold=10.

  Stage 2 — Fetch ancestor nodes iteratively.
             Collect all parent Q-IDs we don't know yet, fetch them in bulk
             using VALUES clauses (fast, indexed). Repeat until every ancestor
             is known. Typically 5-10 rounds.

  Stage 3 — Build tree.
             Convert the flat node + parent map into a nested JSON tree.

Intermediate results are cached to data/_cache/wikidata-species.json and data/_cache/wikidata-ancestors.json
so a failed run can resume without re-fetching.
"""

import json
import time
import requests
from collections import defaultdict

from taxoquiz.jsonio import write_json_atomic
from taxoquiz.paths import CACHE_ANCESTORS, CACHE_RAW_TREE, CACHE_SPECIES, cache_dir

ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {
    "User-Agent": "TaxoQuizBuilder/1.0 (personal project)",
    "Accept": "application/sparql-results+json",
}

MIN_SITELINKS = 10
PAGE_SIZE = 5000
PARENT_BATCH_SIZE = 400  # conservative batch size for VALUES clause

# Resolved through taxoquiz.paths so this honours $TAXOQUIZ_DATA_DIR and lands in
# data/_cache/ with everything else that is rebuildable. It used to be a bare
# Path("data"), which wrote three files flat into the data root and ignored the
# dataset layout entirely.
DATA_DIR = cache_dir()

# Wikidata rank Q-IDs → human-readable names
RANK_LABELS = {
    "Q7432":    "species",
    "Q68947":   "domain",
    "Q36732":   "kingdom",
    "Q2136103": "subkingdom",
    "Q38348":   "phylum",
    "Q19088":   "superphylum",
    "Q3504061": "subphylum",
    "Q1999844": "infraphylum",
    "Q37517":   "class",
    "Q7506714": "superclass",
    "Q1153785": "subclass",
    "Q1054074": "superorder",
    "Q36602":   "order",
    "Q2111790": "suborder",
    "Q164280":  "infraorder",
    "Q2361108": "cohort",
    "Q5868144": "superfamily",
    "Q35409":   "family",
    "Q5867051": "subfamily",
    "Q2455704": "tribe",
    "Q34740":   "genus",
    "Q3025161": "subgenus",
    "Q713623":  "clade",
}


def sparql(query: str, retries: int = 3) -> list[dict]:
    """Run a SPARQL query, return bindings. Retries on transient errors."""
    for attempt in range(retries):
        try:
            resp = requests.get(
                ENDPOINT,
                params={"query": query},
                headers=HEADERS,
                timeout=90,
            )
            resp.raise_for_status()
            return resp.json()["results"]["bindings"]
        except Exception as e:
            wait = 5 * (attempt + 1)
            if attempt < retries - 1:
                print(f"    error ({e}), retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"    failed after {retries} attempts: {e}")
                return []


def extract_qid(binding: dict, key: str) -> str | None:
    val = binding.get(key, {}).get("value", "")
    if "/entity/Q" in val:
        return val.split("/")[-1]
    return None


# ---------------------------------------------------------------------------
# Stage 1: fetch species
# ---------------------------------------------------------------------------

def fetch_species() -> dict[str, dict]:
    """
    Page through all species with English common name + sitelinks >= MIN_SITELINKS.
    Returns {qid: {common_name, scientific_name, parent, sitelinks}}.
    Multiple English common names per species are possible — first wins.
    """
    species: dict[str, dict] = {}
    offset = 0

    print(f"\n=== Stage 1: fetching species (>= {MIN_SITELINKS} sitelinks) ===")

    while True:
        print(f"  offset {offset:,}...", end=" ", flush=True)

        rows = sparql(f"""
            SELECT DISTINCT ?species ?commonName ?scientificName ?parent ?sl WHERE {{
                ?species wdt:P31  wd:Q16521 ;
                         wdt:P105 wd:Q7432  ;
                         wdt:P1843 ?commonName ;
                         wdt:P225  ?scientificName ;
                         wikibase:sitelinks ?sl .
                OPTIONAL {{ ?species wdt:P171 ?parent }}
                FILTER(LANG(?commonName) = "en")
                FILTER(?sl >= {MIN_SITELINKS})
            }}
            ORDER BY ?species
            LIMIT {PAGE_SIZE}
            OFFSET {offset}
        """)

        if not rows:
            print("no results")
            break

        added = 0
        for row in rows:
            sid = extract_qid(row, "species")
            if not sid or sid in species:
                continue
            species[sid] = {
                "common_name":    row["commonName"]["value"],
                "scientific_name": row.get("scientificName", {}).get("value", ""),
                "parent":         extract_qid(row, "parent"),
                "sitelinks":      int(row.get("sl", {}).get("value", 0)),
            }
            added += 1

        print(f"{added} new  (total: {len(species):,})")

        if len(rows) < PAGE_SIZE:
            break

        offset += PAGE_SIZE
        time.sleep(2)

    print(f"  Species fetched: {len(species):,}")
    return species


# ---------------------------------------------------------------------------
# Stage 2: fetch ancestors
# ---------------------------------------------------------------------------

def fetch_nodes_batch(qids: list[str]) -> dict[str, dict]:
    """Fetch label, rank, and parent for a batch of Q-IDs."""
    values = " ".join(f"wd:{q}" for q in qids)
    rows = sparql(f"""
        SELECT ?item ?label ?rank ?parent WHERE {{
            VALUES ?item {{ {values} }}
            ?item rdfs:label ?label .
            FILTER(LANG(?label) = "en")
            OPTIONAL {{ ?item wdt:P171 ?parent }}
            OPTIONAL {{ ?item wdt:P105 ?rank  }}
        }}
    """)

    nodes: dict[str, dict] = {}
    for row in rows:
        nid = extract_qid(row, "item")
        if not nid or nid in nodes:
            continue
        nodes[nid] = {
            "label":    row["label"]["value"],
            # Via extract_qid, not a raw split: P105 occasionally points at a
            # Wikidata *value node* (.../value/<md5>) rather than an entity, and
            # splitting on "/" stored that hash as though it were a Q-ID. It then
            # surfaced as a rank nothing could resolve.
            "rank_qid": extract_qid(row, "rank"),
            "parent":   extract_qid(row, "parent"),
        }
    return nodes


def fetch_rank_labels(rank_qids: set[str]) -> dict[str, str]:
    """Look up the English label for taxon ranks not in RANK_LABELS.

    Wikidata has far more ranks than the common dozen — subtribe, supersection,
    a long tail of botanical and zoological ranks, and several that exist only as
    Q-IDs with no settled English name. The hardcoded map covers the common ones
    so the usual case needs no query; anything it misses used to fall through as
    the raw Q-ID and end up in the tree as `rank: "Q227936"`, which happened to
    1,609 nodes across 37 distinct ranks in the current scrape.

    There are only ever a few dozen distinct unknowns, so this is one small query
    regardless of tree size, and it runs even when the species and ancestor
    caches are warm — so an existing scrape is repaired by rebuilding, without
    re-fetching anything expensive.
    """
    if not rank_qids:
        return {}
    values = " ".join(f"wd:{q}" for q in sorted(rank_qids))
    rows = sparql(f"""
        SELECT ?item ?label WHERE {{
            VALUES ?item {{ {values} }}
            ?item rdfs:label ?label .
            FILTER(LANG(?label) = "en")
        }}
    """)
    labels = {}
    for row in rows:
        qid = extract_qid(row, "item")
        if qid:
            labels[qid] = row["label"]["value"]
    return labels


def fetch_all_ancestors(species: dict[str, dict]) -> dict[str, dict]:
    """
    Iteratively fetch all ancestor nodes until the full lineage is known.
    Each round fetches parents we haven't seen yet, then looks for their
    parents, until nothing new is needed.
    """
    nodes: dict[str, dict] = {}
    known = set(species.keys())
    needed = {s["parent"] for s in species.values() if s["parent"]} - known

    print(f"\n=== Stage 2: fetching ancestors ===")

    for round_num in range(1, 30):  # safety cap at 30 rounds
        if not needed:
            break

        batch_list = list(needed)
        print(f"  Round {round_num}: {len(batch_list):,} unknown ancestors...", end=" ", flush=True)

        fetched: dict[str, dict] = {}
        for i in range(0, len(batch_list), PARENT_BATCH_SIZE):
            batch = batch_list[i : i + PARENT_BATCH_SIZE]
            fetched.update(fetch_nodes_batch(batch))
            time.sleep(1)

        nodes.update(fetched)
        known.update(fetched.keys())

        new_needed = {n["parent"] for n in fetched.values() if n["parent"]} - known
        print(f"fetched {len(fetched):,}  →  {len(new_needed):,} new parents needed")
        needed = new_needed

    print(f"  Ancestor nodes fetched: {len(nodes):,}")
    return nodes


# ---------------------------------------------------------------------------
# Stage 3: build tree
# ---------------------------------------------------------------------------

def build_tree(species: dict[str, dict], ancestors: dict[str, dict]) -> dict:
    """
    Convert flat species + ancestor dicts into a nested tree.

    Leaf nodes:     {name, scientific_name, rank: "species"}
    Internal nodes: {name, rank, children: [...]}

    If multiple disconnected roots exist (shouldn't normally happen),
    they're wrapped in a synthetic "Life" root.
    """
    children: dict[str | None, list[str]] = defaultdict(list)
    all_nodes: dict[str, dict] = {}

    for sid, s in species.items():
        all_nodes[sid] = {
            "common_name":    s["common_name"],
            "scientific_name": s["scientific_name"],
            "rank":           "species",
            "parent":         s["parent"],
            "is_leaf":        True,
        }
        children[s["parent"]].append(sid)

    # Resolve any rank Q-IDs the hardcoded map doesn't cover, in one query.
    unknown_ranks = {
        q for q in (n.get("rank_qid") for n in ancestors.values())
        if q and q not in RANK_LABELS
    }
    if unknown_ranks:
        print(f"  Resolving {len(unknown_ranks)} rank labels not in RANK_LABELS...")
        fetched = fetch_rank_labels(unknown_ranks)
        missing = unknown_ranks - set(fetched)
        print(f"    resolved {len(fetched)}"
              + (f", {len(missing)} have no English label: {sorted(missing)}" if missing else ""))
    else:
        fetched = {}

    def rank_of(node: dict) -> str:
        qid = node.get("rank_qid")
        if not qid:
            return "clade"          # genuinely unranked, which is common in modern taxonomy
        return RANK_LABELS.get(qid) or fetched.get(qid) or "clade"

    for nid, n in ancestors.items():
        rank = rank_of(n)
        all_nodes[nid] = {
            "label":   n["label"],
            "rank":    rank,
            "parent":  n["parent"],
            "is_leaf": False,
        }
        children[n["parent"]].append(nid)

    roots = [
        nid for nid, n in all_nodes.items()
        if n["parent"] is None or n["parent"] not in all_nodes
    ]

    def to_node(nid: str) -> dict:
        # The Wikidata Q-ID is carried into the tree. It is the stable, unique,
        # language-independent identity of a taxon, and scrape_taxon_info.py uses
        # it as the fallback when a name does not resolve to a Wikipedia page.
        # It used to be dropped here, which left every scraped dataset with no
        # fallback at all — the one place it was most needed, since a scraped
        # tree has thousands of obscure taxa whose names Wikipedia will not match.
        n = all_nodes[nid]
        if n["is_leaf"]:
            return {
                "name":            n["common_name"],
                "scientific_name": n["scientific_name"],
                "rank":            "species",
                "qid":             nid,
            }
        kids = sorted(children.get(nid, []))
        result: dict = {"name": n["label"], "rank": n["rank"], "qid": nid}
        if kids:
            result["children"] = [to_node(c) for c in kids]
        return result

    if len(roots) == 1:
        return to_node(roots[0])

    print(f"  Note: {len(roots)} disconnected roots — wrapping in synthetic 'Life' node")
    return {
        "name":     "Life",
        "rank":     "root",
        "children": [to_node(r) for r in sorted(roots)],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Stage 1
    species_cache = DATA_DIR / CACHE_SPECIES
    if species_cache.exists():
        print(f"Loading cached species from {species_cache}")
        species = json.loads(species_cache.read_text())
    else:
        species = fetch_species()
        write_json_atomic(species_cache, species, indent=None)
        print(f"  Cached to {species_cache}")

    # Stage 2
    ancestors_cache = DATA_DIR / CACHE_ANCESTORS
    if ancestors_cache.exists():
        print(f"Loading cached ancestors from {ancestors_cache}")
        ancestors = json.loads(ancestors_cache.read_text())
    else:
        ancestors = fetch_all_ancestors(species)
        write_json_atomic(ancestors_cache, ancestors, indent=None)
        print(f"  Cached to {ancestors_cache}")

    # Stage 3
    print(f"\n=== Stage 3: building tree ===")
    tree = build_tree(species, ancestors)

    out = DATA_DIR / CACHE_RAW_TREE
    write_json_atomic(out, tree)
    print(f"  Written to {out}")

    def count_nodes(node: dict) -> tuple[int, int]:
        if "children" not in node:
            return 1, 1
        total, leaves = 1, 0
        for c in node["children"]:
            t, l = count_nodes(c)
            total += t
            leaves += l
        return total, leaves

    total, leaves = count_nodes(tree)
    print(f"\n  Total nodes : {total:,}")
    print(f"  Leaf species: {leaves:,}")


if __name__ == "__main__":
    main()

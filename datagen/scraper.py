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

import argparse
import json
import sys
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


def sparql(query: str, retries: int = 3, strict: bool = False) -> list[dict]:
    """Run a SPARQL query, return bindings. Retries on transient errors.

    Once the retries are spent it returns no rows, which callers building a tree
    tolerate: a missing node is found missing and fetched on the next run.
    `strict` raises instead, for a caller that would otherwise record "nothing
    found" as a fact — see `repair_species_parents`.
    """
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
                if strict:
                    raise RuntimeError(f"SPARQL query failed after {retries} attempts") from e
                return []


def extract_qid(binding: dict, key: str) -> str | None:
    val = binding.get(key, {}).get("value", "")
    if "/entity/Q" in val:
        return val.split("/")[-1]
    return None


# ---------------------------------------------------------------------------
# Stage 1: fetch species
# ---------------------------------------------------------------------------

def parents_of(node: dict) -> list[str]:
    """Every candidate parent recorded for a node.

    Entries cached before every candidate was kept carry only `parent` — the
    first row Wikidata happened to return — and read as that one candidate until
    `needs_parents` has them repaired.
    """
    if "parents" in node:
        return node["parents"]
    return [node["parent"]] if node.get("parent") else []


def needs_parents(node: dict) -> bool:
    """Cached before every candidate parent was kept, so holding at most one."""
    return "parents" not in node


def _add_parent(node: dict, parent: str | None) -> None:
    if parent and parent not in node["parents"]:
        node["parents"] = sorted([*node["parents"], parent])


def fetch_species(min_sitelinks: int = None, below: int | None = None,
                  page_size: int | None = None, checkpoint=None) -> dict[str, dict]:
    """
    Page through species with an English common name and sitelinks in a range.
    Returns {qid: {common_name, scientific_name, parent, parents, sitelinks}}.
    Multiple English common names per species are possible — first wins. Multiple
    parents are possible too, and there every one is kept; `choose_parents`
    decides between them once the whole graph is known.

    `below` makes this fetch a *band*, `min_sitelinks <= sl < below`, which is
    what lets a lower threshold cost only the species it adds. Sitelink count is
    a property of the species, not of the query, so the set at a threshold is a
    strict subset of the set at any lower one — the band is exactly the
    difference, and never re-requests what a warm cache already holds.

    `checkpoint(species)` is called after every page. The cache was previously
    written only once the whole fetch returned, so a run that died part-way
    saved nothing and started over — despite the docs promising a resume. A
    page is the natural unit: the query is `ORDER BY ?species`, so what is
    already saved is a stable prefix.
    """
    min_sitelinks = MIN_SITELINKS if min_sitelinks is None else min_sitelinks
    page_size = PAGE_SIZE if page_size is None else page_size
    species: dict[str, dict] = {}
    offset = 0

    band = f" and < {below}" if below else ""
    print(f"\n=== Stage 1: fetching species (>= {min_sitelinks}{band} sitelinks) ===")

    while True:
        print(f"  offset {offset:,}...", end=" ", flush=True)

        upper = f"\n                FILTER(?sl < {below})" if below else ""
        rows = sparql(f"""
            SELECT DISTINCT ?species ?commonName ?scientificName ?parent ?sl WHERE {{
                ?species wdt:P31  wd:Q16521 ;
                         wdt:P105 wd:Q7432  ;
                         wdt:P1843 ?commonName ;
                         wdt:P225  ?scientificName ;
                         wikibase:sitelinks ?sl .
                OPTIONAL {{ ?species wdt:P171 ?parent }}
                FILTER(LANG(?commonName) = "en")
                FILTER(?sl >= {min_sitelinks}){upper}
            }}
            ORDER BY ?species
            LIMIT {page_size}
            OFFSET {offset}
        """)

        if not rows:
            print("no results")
            break

        added = 0
        for row in rows:
            sid = extract_qid(row, "species")
            if not sid:
                continue
            parent = extract_qid(row, "parent")
            if sid in species:
                # A further row for a species already seen: another common name,
                # or another P171. The name keeps the first; the parent is added,
                # since which parent is right cannot be judged from one row. The
                # rows of one species can straddle a page, which is why this
                # merges into what earlier pages stored.
                _add_parent(species[sid], parent)
                continue
            species[sid] = {
                "common_name":    row["commonName"]["value"],
                "scientific_name": row.get("scientificName", {}).get("value", ""),
                "parent":         parent,
                "parents":        [parent] if parent else [],
                "sitelinks":      int(row.get("sl", {}).get("value", 0)),
            }
            added += 1

        print(f"{added} new  (total: {len(species):,})")
        if checkpoint:
            checkpoint(species)

        if len(rows) < page_size:
            break

        offset += page_size
        time.sleep(2)

    print(f"  Species fetched: {len(species):,}")
    return species


# ---------------------------------------------------------------------------
# Deciding what to fetch
# ---------------------------------------------------------------------------

def cache_threshold(species: dict[str, dict]) -> int | None:
    """The sitelink threshold an existing species cache was built at, or None
    if it is empty.

    Read back off the data rather than stored alongside it. The distribution is
    dense at every value in the range we use — the current cache holds 4,184
    species at exactly 10 sitelinks — so the minimum present is the threshold,
    and inferring it cannot drift out of step with the file the way a recorded
    value could.
    """
    if not species:
        return None
    return min(v["sitelinks"] for v in species.values())


def fetch_plan(have: int | None, want: int) -> tuple[int, int | None] | None:
    """What to fetch, as `(min_sitelinks, below)`, or None for nothing.

    - no cache          -> fetch everything at the wanted threshold
    - want < have       -> fetch only the band the cache is missing
    - want >= have      -> nothing; the cache is already a superset and
                           `at_threshold` narrows it for free
    """
    if have is None:
        return (want, None)
    if want < have:
        return (want, have)
    return None


def at_threshold(species: dict[str, dict], min_sitelinks: int) -> dict[str, dict]:
    """The subset of a cache at or above a threshold.

    This is what makes the threshold mean anything once a cache exists. It used
    to be missing entirely: `main()` handed the whole cache to `build_tree`, so
    MIN_SITELINKS was silently ignored on every run but the first — a rebuild at
    any threshold returned the cached set unchanged, in both directions.
    """
    return {q: v for q, v in species.items() if v["sitelinks"] >= min_sitelinks}


# ---------------------------------------------------------------------------
# Stage 2: fetch ancestors
# ---------------------------------------------------------------------------

def fetch_nodes_batch(qids: list[str]) -> dict[str, dict]:
    """Fetch both names, rank, and parent for a batch of Q-IDs."""
    values = " ".join(f"wd:{q}" for q in qids)
    # Every clause is OPTIONAL, including the label. It used to be required,
    # which silently dropped any taxon with no English label — and Wikidata has
    # plenty: Dinosauriformes (Q2740164) has a scientific name and nothing else.
    # A dropped node is not one missing node, it detaches everything below it,
    # permanently and without an error. That one cost 10,625 species — the birds
    # — which sat outside Animalia in a tree that otherwise looked complete.
    # The scientific name (P225) covers for it, and taxon nodes always have one.
    rows = sparql(f"""
        SELECT ?item ?label ?sci ?rank ?parent WHERE {{
            VALUES ?item {{ {values} }}
            OPTIONAL {{ ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }}
            OPTIONAL {{ ?item wdt:P225 ?sci }}
            OPTIONAL {{ ?item wdt:P171 ?parent }}
            OPTIONAL {{ ?item wdt:P105 ?rank  }}
        }}
    """)

    nodes: dict[str, dict] = {}
    for row in rows:
        nid = extract_qid(row, "item")
        if not nid:
            continue
        if nid in nodes:
            # One row per combination of the OPTIONAL values, so a taxon with
            # several P171 statements arrives as several rows. This used to keep
            # the first row and skip the rest, and the first was arbitrary:
            # Chiroptera has eight parents, from Mammalia down to Scrotifera, and
            # the scrape kept Mammalia — so every bat hung straight off the
            # class, exactly as related to a platypus as to a wolf. Every
            # candidate is kept now, and `choose_parents` picks among them.
            _add_parent(nodes[nid], extract_qid(row, "parent"))
            continue
        nodes[nid] = {
            # Both names are kept, and which one a node displays is not decided
            # here. These used to be collapsed into one field with the label
            # winning, which spent the scientific name and never stored it — and
            # Wikidata's English label for a well-known clade is the vernacular.
            # Q7377 is "mammal", Q5113 "bird", Q1390 "insect". So the tree ended
            # up calling its most recognisable nodes by their common names while
            # holding no record of the Latin, which is the one thing a taxonomy
            # is for. 487 internal nodes in the current scrape.
            "label":    row.get("label", {}).get("value"),
            "sci":      row.get("sci", {}).get("value"),
            # Via extract_qid, not a raw split: P105 occasionally points at a
            # Wikidata *value node* (.../value/<md5>) rather than an entity, and
            # splitting on "/" stored that hash as though it were a Q-ID. It then
            # surfaced as a rank nothing could resolve.
            "rank_qid": extract_qid(row, "rank"),
            "parent":   extract_qid(row, "parent"),
            "parents":  [p for p in [extract_qid(row, "parent")] if p],
        }
    return nodes


def fetch_parents_batch(qids: list[str]) -> dict[str, list[str]]:
    """Every P171 parent of each Q-ID, for repairing a cache that kept only one.

    Every requested Q-ID is in the result, `[]` where Wikidata lists no parent,
    so a repaired entry is marked done even when there was nothing to find.
    """
    values = " ".join(f"wd:{q}" for q in qids)
    # Strict, because an empty answer here is not harmless the way it is for a
    # node fetch: it would mark 400 species repaired with no new parents, and
    # nothing would ever look at them again.
    rows = sparql(strict=True, query=f"""
        SELECT ?item ?parent WHERE {{
            VALUES ?item {{ {values} }}
            ?item wdt:P171 ?parent
        }}
    """)
    found: dict[str, set[str]] = {q: set() for q in qids}
    for row in rows:
        nid, parent = extract_qid(row, "item"), extract_qid(row, "parent")
        if nid in found and parent:
            found[nid].add(parent)
    return {q: sorted(ps) for q, ps in found.items()}


def repair_species_parents(species: dict[str, dict], checkpoint=None) -> int:
    """Record every parent for cached species that stored only the first.

    A parent-only query in batches, rather than re-running stage 1, which pages
    through every species to recover what is here one property. Returns how many
    species were repaired. `checkpoint(species)` runs after each batch, so an
    interrupted repair resumes rather than restarting.

    Where Wikidata now lists no parent at all, the cached one is kept: a species
    silently detached from the tree is worse than one on a parent that has since
    been removed.
    """
    stale = sorted(q for q, s in species.items() if needs_parents(s))
    if not stale:
        return 0
    print(f"\n=== Repair: {len(stale):,} cached species predate keeping every parent ===")
    for i in range(0, len(stale), PARENT_BATCH_SIZE):
        batch = stale[i : i + PARENT_BATCH_SIZE]
        for qid, parents in fetch_parents_batch(batch).items():
            legacy = species[qid].get("parent")
            species[qid]["parents"] = parents or ([legacy] if legacy else [])
        print(f"  {min(i + PARENT_BATCH_SIZE, len(stale)):,} / {len(stale):,}", flush=True)
        if checkpoint:
            checkpoint(species)
        time.sleep(1)
    return len(stale)


def fetch_rank_labels(rank_qids: set[str]) -> dict[str, str]:
    """Look up the English label for every taxon rank Q-ID in the tree.

    This is the only source of rank names, on purpose. There used to be a
    hardcoded RANK_LABELS map in front of it, holding "the common dozen" so the
    usual case needed no query — and 15 of its 23 entries were wrong. Only the
    eight ranks anyone can recite from memory (species, kingdom, phylum, class,
    order, family, genus, clade) were right; the rest pointed at unrelated
    Q-IDs, several not taxonomic at all. Q1054074, mapped to "superorder", is a
    Fiat 600 Multipla. Q2361108, mapped to "cohort", is a place in Sweden.
    Q7506714, mapped to "superclass", is the Siam area.

    Because the map was consulted *first*, it shadowed this function wherever it
    had an entry, so the wrong answer always won. In the Sep 2026 scrape that
    put 355 beetle superfamilies in the tree as "Subkingdom" and 1,225
    subfamilies as "Infraorder" — visible in the popup, which displays rank, and
    poison to anything that reads rank as a position in the hierarchy.

    Asking Wikidata is correct by construction and cannot drift. It is also
    nearly free: there are only a few dozen distinct ranks in any tree, so this
    is one small query regardless of tree size, and it runs even when the
    species and ancestor caches are warm — so re-running the build repairs an
    existing scrape without re-fetching anything expensive.
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


def fetch_all_ancestors(species: dict[str, dict],
                        known: dict[str, dict] | None = None) -> dict[str, dict]:
    """
    Iteratively fetch all ancestor nodes until the full lineage is known.
    Each round fetches parents we haven't seen yet, then looks for their
    parents, until nothing new is needed.

    `known` seeds the walk with ancestors already cached, so adding species to
    an existing scrape only fetches the lineage those species introduce. Most
    of them hang off genera the cache already has, which is what makes growing
    a dataset far cheaper than building one.
    """
    nodes: dict[str, dict] = dict(known or {})
    known_ids = set(species.keys()) | set(nodes)
    # Seed from every node whose parent we lack — species *and* already-known
    # ancestors. Seeding from species alone leaves the walk unable to repair
    # itself: one failed batch drops a mid-lineage node, and on the next run
    # every species' parent is present, so nothing looks missing and the walk
    # stops with the chain still severed. That is not hypothetical — a batch
    # failed on 4 Sep 2026 and detached Dracohors (10,546 species, birds among
    # them) from Animalia, leaving a tree that looked complete and was not.
    #
    # Every candidate parent, not only the one a node will end up hanging from:
    # the most specific is often a clade no other lineage reaches — Scrotifera,
    # for the bats — and it cannot be chosen if it was never fetched.
    needed = ({p for s in species.values() for p in parents_of(s)}
              | {p for n in nodes.values() for p in parents_of(n)}) - known_ids

    # Entries cached before the scientific name was stored alongside the label
    # hold only the label, and a label on its own cannot say whether it is
    # "Mammalia" or "mammal" — so they have to be asked again. Re-fetching them
    # is one pass over the ancestors, cheap beside stage 1, and it repairs an
    # existing scrape in place rather than making a corrected tree wait for a
    # fresh one. Once refetched an entry has the key, even when the value is
    # None, so this costs nothing on the run after.
    stale = {q for q, n in nodes.items() if "sci" not in n or needs_parents(n)}
    if stale:
        print(f"  {len(stale):,} cached ancestors predate the scientific name or "
              f"every parent being kept; refetching")
    needed |= stale

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
        known_ids.update(fetched.keys())

        new_needed = {p for n in fetched.values() for p in parents_of(n)} - known_ids
        print(f"fetched {len(fetched):,}  →  {len(new_needed):,} new parents needed")
        needed = new_needed

    print(f"  Ancestor nodes known: {len(nodes):,} "
          f"({len(nodes) - len(known or {}):,} newly fetched)")
    return nodes


# ---------------------------------------------------------------------------
# Stage 3: build tree
# ---------------------------------------------------------------------------

def choose_parents(nodes: dict[str, dict]) -> dict[str, str | None]:
    """The parent each node hangs from: its most specific candidate.

    Wikidata gives many taxa several P171 statements, one per classification that
    has placed them. Keeping whichever row arrived first was arbitrary, and it
    tended to keep the broadest, which flattens everything beneath: in the Sep
    2026 scrapes Chiroptera hung off Mammalia, and 106 edges skipped a full rank
    tier the same way, covering 3,170 nodes.

    "Most specific" is the longest path up to a root through any candidates.
    Where one candidate descends from another, the descendant's path is always
    the longer, so an ancestor can never win against its own descendant; where
    candidates are unrelated placements, the deeper one wins, and a tie goes to
    the larger Q-ID so that a rebuild is reproducible.

    A candidate outside `nodes` was never fetched and is ignored, so a node with
    none left becomes a root, as before. Wikidata has the odd P171 cycle; an edge
    back into the path being measured is skipped rather than followed forever.
    """
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 10_000))
    depth: dict[str, int] = {}

    def longest(nid: str, path: set[str]) -> int:
        if nid in depth:
            return depth[nid]
        path.add(nid)
        best = 0
        for p in nodes[nid]["parents"]:
            if p in nodes and p not in path:
                best = max(best, longest(p, path) + 1)
        path.discard(nid)
        depth[nid] = best
        return best

    chosen: dict[str, str | None] = {}
    for nid, node in nodes.items():
        known = [p for p in node["parents"] if p in nodes and p != nid]
        chosen[nid] = max(known, key=lambda p: (longest(p, {nid}), p)) if known else None
    return chosen


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
            "parents":        parents_of(s),
            "is_leaf":        True,
        }

    # Resolve every distinct rank Q-ID in the tree, in one query. Every one,
    # rather than only unfamiliar ones: see fetch_rank_labels for what a
    # hand-written shortcut table cost the last time there was one.
    rank_qids = {q for q in (n.get("rank_qid") for n in ancestors.values()) if q}
    if rank_qids:
        print(f"  Resolving {len(rank_qids)} rank labels...")
        fetched = fetch_rank_labels(rank_qids)
        missing = rank_qids - set(fetched)
        print(f"    resolved {len(fetched)}"
              + (f", {len(missing)} have no English label: {sorted(missing)}" if missing else ""))
    else:
        fetched = {}

    def rank_of(node: dict) -> str:
        qid = node.get("rank_qid")
        if not qid:
            return "clade"          # genuinely unranked, which is common in modern taxonomy
        return fetched.get(qid) or "clade"

    for nid, n in ancestors.items():
        rank = rank_of(n)
        # Same shape as a species: the English name in `label`, the taxon name
        # in `scientific_name`. For a famous clade those differ — Q7377 labels
        # itself "mammal" and is named Mammalia — and this file keeps both
        # without choosing. Which one a node is *displayed* by is
        # extract_game_tree.py's decision; the raw tree records what Wikidata
        # says, and the game tree is where the schema gets inverted.
        all_nodes[nid] = {
            "scientific_name": n.get("sci"),
            "label":           n.get("label") or n.get("sci") or nid,
            "rank":            rank,
            "parents":         parents_of(n),
            "is_leaf":         False,
        }

    # Chosen once every node is known, since the most specific candidate can
    # only be told apart from the others by where each sits in the whole graph.
    parent_of = choose_parents(all_nodes)
    for nid, parent in parent_of.items():
        children[parent].append(nid)

    roots = [nid for nid, parent in parent_of.items() if parent is None]

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
        if n.get("scientific_name"):
            result["scientific_name"] = n["scientific_name"]
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
    ap = argparse.ArgumentParser(description=__doc__.split("---")[0].strip())
    ap.add_argument("--min-sitelinks", type=int, default=MIN_SITELINKS,
                    help=f"how famous a species must be to be included "
                         f"(default {MIN_SITELINKS}; lower = bigger dataset)")
    ap.add_argument("--page-size", type=int, default=PAGE_SIZE,
                    help=f"SPARQL rows per request (default {PAGE_SIZE})")
    ap.add_argument("--plan", action="store_true",
                    help="say what would be fetched, then stop")
    args = ap.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    want = args.min_sitelinks

    # Stage 1 -------------------------------------------------------------
    species_cache = DATA_DIR / CACHE_SPECIES
    species: dict[str, dict] = {}
    if species_cache.exists():
        species = json.loads(species_cache.read_text())
        print(f"Loaded {len(species):,} cached species from {species_cache}")

    have = cache_threshold(species)
    plan = fetch_plan(have, want)
    print(f"  cache threshold: {have}   wanted: {want}")
    if plan is None:
        print(f"  -> nothing to fetch; the cache already covers >= {want}")
    else:
        lo, below = plan
        print(f"  -> fetch sitelinks >= {lo}" + (f" and < {below}" if below else "")
              + (" (band only — the rest is cached)" if below else " (full)"))
    if args.plan:
        return

    if plan is not None:
        lo, below = plan
        before = len(species)

        def checkpoint(partial: dict) -> None:
            """Save the merge-so-far, so a failed run resumes instead of restarting."""
            write_json_atomic(species_cache, {**species, **partial}, indent=None)

        added = fetch_species(lo, below=below, page_size=args.page_size,
                              checkpoint=checkpoint)
        species.update(added)
        print(f"  Species: {before:,} + {len(added):,} fetched = {len(species):,}")
        write_json_atomic(species_cache, species, indent=None)
        print(f"  Cached to {species_cache}")

    # Species cached before every parent was kept hold only the first. Repaired
    # in place and once: an entry gains `parents` even when Wikidata has none to
    # give, so the next run finds nothing to do.
    if repair_species_parents(
        species, checkpoint=lambda s: write_json_atomic(species_cache, s, indent=None),
    ):
        write_json_atomic(species_cache, species, indent=None)
        print(f"  Cached to {species_cache}")

    # Everything downstream sees only the species the threshold asks for.
    # Without this the threshold does nothing whenever a cache exists.
    build_species = at_threshold(species, want)
    print(f"  Building from {len(build_species):,} species at >= {want} sitelinks")

    # Stage 2 -------------------------------------------------------------
    ancestors_cache = DATA_DIR / CACHE_ANCESTORS
    ancestors: dict[str, dict] = {}
    if ancestors_cache.exists():
        ancestors = json.loads(ancestors_cache.read_text())
        print(f"Loaded {len(ancestors):,} cached ancestors from {ancestors_cache}")

    # Re-run even with a warm cache: new species bring new lineages, and the
    # walk fetches only what is genuinely unknown. A warm, complete cache
    # costs one round that finds nothing.
    before = len(ancestors)
    # A repair rewrites entries in place rather than adding any, so the count is
    # not enough to notice one — guarding on length alone would refetch the same
    # nodes on every run and save the result on none of them.
    repaired = any("sci" not in n or needs_parents(n) for n in ancestors.values())
    ancestors = fetch_all_ancestors(build_species, known=ancestors)
    if len(ancestors) != before or repaired:
        write_json_atomic(ancestors_cache, ancestors, indent=None)
        print(f"  Cached to {ancestors_cache}")

    # Stage 3 -------------------------------------------------------------
    print(f"\n=== Stage 3: building tree ===")
    tree = build_tree(build_species, ancestors)

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

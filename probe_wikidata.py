#!/usr/bin/env python3
"""
Probe Wikidata to find how many species match different notability
filters. Run locally - needs internet access.

Target: ~5000 species for the game.

--- WHY THE PREVIOUS APPROACH FAILED ---

The original version used `wdt:P171+ wd:Q729` to verify that each
species is a descendant of Animalia. The `+` operator is a recursive
property path — for every candidate species, Wikidata walks up the
entire parent taxon chain until it finds Animalia or exhausts the tree.
With millions of taxa in Wikidata's graph, this is brutally expensive
and consistently causes 504 Gateway Timeout errors on the public SPARQL
endpoint. Every single query in the original run timed out.

--- THE NEW APPROACH ---

We drop the recursive ancestry check entirely for this probe. Instead
we rely on three fast, indexed property lookups:

  wdt:P31  wd:Q16521   instance of: taxon
  wdt:P105 wd:Q7432    taxon rank: species
  wdt:P1843            has a common name
  wikibase:sitelinks   sitelink count (notability proxy)

All of these resolve via index scans — no graph traversal. This is much
kinder to the public endpoint and should complete in seconds rather than
timing out.

The trade-off: results will include a small number of plants, fungi, and
other non-animals. In practice the "notable species with English common
names" space is heavily dominated by animals, but we eyeball this with
the sample queries below. Any needed filtering gets handled in the full
scraper, not here.
"""

import requests
import time

ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {
    "User-Agent": "TaxoQuizBuilder/1.0 (personal project)",
    "Accept": "application/sparql-results+json",
}


def run_query(sparql: str, label: str) -> int | None:
    """Run a SPARQL query and return the count (or sample size)."""
    print(f"\n{'='*60}")
    print(f"TEST: {label}")
    print(f"{'='*60}")

    try:
        resp = requests.get(
            ENDPOINT,
            params={"query": sparql},
            headers=HEADERS,
            timeout=60,
        )
        resp.raise_for_status()
        results = resp.json()["results"]["bindings"]

        if results and "count" in results[0]:
            count = int(results[0]["count"]["value"])
            print(f"  Result: {count:,} species")
            return count
        else:
            print(f"  Got {len(results)} results. First 10:")
            for r in results[:10]:
                parts = [f"{k}={v['value']}" for k, v in r.items()]
                print(f"    {', '.join(parts)}")
            return len(results)

    except Exception as e:
        print(f"  Error: {e}")
        return None


def main():
    # ============================================================
    # THRESHOLD SWEEP
    # Count species at each sitelinks cutoff. No recursive ancestry
    # check — purely indexed property lookups.
    # ============================================================
    for min_sitelinks in [10, 15, 20, 25, 30, 40, 50]:
        run_query(f"""
            SELECT (COUNT(DISTINCT ?species) AS ?count) WHERE {{
                ?species wdt:P31 wd:Q16521 .
                ?species wdt:P105 wd:Q7432 .
                ?species wdt:P1843 ?name .
                FILTER(LANG(?name) = "en")
                ?species wikibase:sitelinks ?sl .
                FILTER(?sl >= {min_sitelinks})
            }}
        """, f">= {min_sitelinks} sitelinks")
        time.sleep(3)

    # ============================================================
    # QUALITY CHECK: Top 30 most notable
    # Eyeball that these are real, recognisable animals and not
    # plants or fungi sneaking in.
    # ============================================================
    run_query("""
        SELECT DISTINCT ?name ?scientificName ?sl WHERE {
            ?species wdt:P31 wd:Q16521 .
            ?species wdt:P105 wd:Q7432 .
            ?species wdt:P1843 ?name .
            ?species wdt:P225 ?scientificName .
            FILTER(LANG(?name) = "en")
            ?species wikibase:sitelinks ?sl .
            FILTER(?sl >= 20)
        }
        ORDER BY DESC(?sl)
        LIMIT 30
    """, "Top 30 most notable — eyeball quality")
    time.sleep(3)

    # ============================================================
    # QUALITY CHECK: Bottom of the threshold
    # Check where quality drops off — are species at the low end
    # still recognisable, or are we getting obscure taxa?
    # ============================================================
    run_query("""
        SELECT DISTINCT ?name ?scientificName ?sl WHERE {
            ?species wdt:P31 wd:Q16521 .
            ?species wdt:P105 wd:Q7432 .
            ?species wdt:P1843 ?name .
            ?species wdt:P225 ?scientificName .
            FILTER(LANG(?name) = "en")
            ?species wikibase:sitelinks ?sl .
            FILTER(?sl >= 20 && ?sl <= 22)
        }
        ORDER BY ?sl
        LIMIT 30
    """, "Bottom of threshold (20-22 sitelinks) — quality check")

    print("\n\nDone. Pick the threshold closest to 5000 species.")
    print("Check the top/bottom samples — if non-animals appear,")
    print("we add a class-level filter in the full scraper.")


if __name__ == "__main__":
    main()

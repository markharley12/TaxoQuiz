# datagen — building your own dataset

The game does **not** need any of this. It ships with a complete example dataset
inside the package — `example_tree.json` (530 species) and
`example_taxon_info.json` (Wikipedia text for its taxa and species) — so a fresh
clone or `pip install` is playable *and* has working taxon popups with no scrape
and no network.

These scripts exist only to build a **bigger** dataset from Wikidata: tens of
thousands of species instead of hundreds. Doing so means running the taxon-info
scrape as well, since the example's text describes the example's tree and is
never reused for another one.

Everything here writes into `data/` at the repo root, which is gitignored. Output
is organised into **datasets** — one directory per tree, holding that tree and the
taxon info that matches it.

```bash
pip install -e ".[datagen]"    # these scripts need `requests`; the game does not

python3 datagen/scraper.py             # → data/_cache/wikidata-tree-raw.json
python3 datagen/extract_game_tree.py   # → data/<name>/tree.json, and prints <name>

export TAXOQUIZ_DATASET=<name>
python3 datagen/scrape_taxon_info.py   # → data/<name>/taxon_info.json  (optional)
#   --only taxa | --only species        # scope it: species are the long half
./start.sh
```

Run them in that order — each reads the previous one's output.

## Making it bigger

Lowering the threshold does **not** mean scraping again. A species' sitelink count
is a property of the species, so the set you already hold is a strict subset of any
larger one, and only the band in between is fetched:

```bash
python3 datagen/scraper.py --min-sitelinks 6 --plan   # say what it would do
#   cache threshold: 10   wanted: 6
#   -> fetch sitelinks >= 6 and < 10 (band only — the rest is cached)

python3 datagen/scraper.py --min-sitelinks 6          # do it
```

The same applies downstream: `taxon_info.json` is keyed by node name and the
scraper only fetches names it does not already have, so seeding a new dataset's
file from an existing one leaves just the new nodes to fetch.

[`SCALING.md`](SCALING.md) has the measurements behind all of this, including the
bug where the threshold was silently ignored whenever a cache existed.

**Nothing here can destroy a dataset you already have.** Every write is atomic, so
an interrupted scrape leaves the previous file whole and resumes from its last
checkpoint; and `extract_game_tree.py` refuses to overwrite an existing
`tree.json` without `--force`. Build a better dataset alongside the one you are
using, and switch over with `$TAXOQUIZ_DATASET` once you're happy with it.

| Script | Does |
| --- | --- |
| `scraper.py` | Wikidata → the full tree of life. The slow one. Size is set by `--min-sitelinks` (default 10); see the main README's sizing table and [`SCALING.md`](SCALING.md). |
| `extract_game_tree.py` | That tree → one the game can actually load. **Not optional** — see below. |
| `scrape_taxon_info.py` | Wikipedia → summaries and thumbnails for the click-a-node popup, for **every node: internal taxa and species**. Reads them straight out of `tree.json` and writes into `taxon_info.json` as it goes. Optional; the game plays without it. |

## Why `extract_game_tree.py` exists

Raw `scraper.py` output is not playable. Three things are wrong with it, and
none of them fail in a way that points at the cause:

1. **Wrong root.** It covers all of Life; the game wants a single kingdom.
2. **Inverted schema.** The scrape puts the common name in `name` and the
   binomial in `scientific_name`. The game wants the opposite, with the common
   name under `common_name` — so it raises `KeyError: 'common_name'` on the
   first pick.
3. **Names are not unique.** A default Animalia scrape has ~1,100 duplicate
   common names — "Cichlid" alone covers 38 species — and 63 duplicate node
   names. Some are real homonyms (Gnathostomata is both a vertebrate clade and a
   sea-urchin superfamily); others are genus nodes mislabelled with a full
   binomial, or genus/subgenus pairs sharing a name. The game keys its depth
   index on the node name, so each collision silently gives one node another's
   depth and makes the pruned tree match branches it shouldn't.

The script fixes all three, and **refuses to write** if any duplicate survives
rather than emitting a tree that plays subtly wrong.

For reference, the current scrape yields 18,421 species and is **64 levels deep,
against the bundled example's 18**.

## Ranks

Wikidata expresses a taxon's rank as a Q-ID, and **every one is resolved from
Wikidata in one batched query** at tree-build time.

There used to be a `RANK_LABELS` map in front of that lookup, holding "the common
dozen" so the usual case needed no query. 15 of its 23 entries were wrong, and
because the map was consulted first its wrong answers always won — which is how
355 beetle superfamilies came to sit in the tree as "Subkingdom". Asking is
correct by construction, cannot drift, and costs one request for the ~53 distinct
ranks in a tree of any size.

That query runs even when the species and ancestor caches are warm, so a scrape
you already have is repaired by re-running `scraper.py` — it costs one request,
not another full scrape.

Before this existed, an unrecognised rank fell through as the raw Q-ID and ended
up in the tree as `rank: "Q227936"` — 1,609 nodes across 37 distinct ranks in the
current scrape, among them `tribe` (772 nodes), `subtribe` and `subgenus`. Ranks
are shown in the taxon popup, so it was visible, not just untidy.

A rank with no English label at all falls back to `clade`, which is also what an
explicitly unranked node gets — common in modern taxonomy.

**Wikidata's ranks are still wrong in places, and the game no longer trusts them
blindly.** `taxoquiz.ranks.believed_levels` uses a node's rank only where the
tree agrees with it — strictly broader than every ranked ancestor, strictly
narrower than every ranked descendant — and interpolates the rest. Wikidata
files `Deuterostomia` as a suborder and `Tetrapodomorpha` as a subclass
containing the class Mammalia; taken literally, the first made a human-and-
starfish guess warmer than a shared family and the second flattened every
mammal ancestor onto one colour. So a bad rank now costs a label rather than the
ordering. The share rejected is the number to watch: 0.28% on the Sep 2026
scrape, 6.5% on the one from before the `RANK_LABELS` repair.

## Checking a dataset

```bash
python3 datagen/validate_dataset.py                     # the selected dataset
python3 datagen/validate_dataset.py --dataset <name>
python3 datagen/validate_dataset.py --all
```

Three groups of check — shape (unique names, species at the leaves), warmth
(deeper is never colder, and how many rank claims had to be rejected), and
biology (a table of undisputed relationships asserted as an ordering: human
closer to chimp than to lion than to chicken than to salmon than to starfish
than to wasp than to coral than to sponge).

**Known open defect in scraped data.** Both scrapes on disk fail the bat chain:
`Chiroptera` hangs straight off `Mammalia`, so a bat scores identically against
a wolf, a human, a kangaroo and a platypus. 106 edges skip a full rank tier this
way, covering 3,170 nodes. The cause is in `fetch_nodes_batch`: a taxon can have
several `P171` statements — Chiroptera has eight, from Mammalia down to
Scrotifera — and the first row returned wins. The fix is to keep every candidate
and pick the narrowest, which changes the cache schema and needs a rebuild.

It exists because both data bugs this repo has had — the `RANK_LABELS` one above
and an example tree that went straight from kingdom to phylum — were invisible
to a test suite that checks code against fixtures it wrote itself. `extract_game_tree.py`
runs shape and warmth before it writes and refuses on failure; the biology group
is left to this CLI, because a `--taxon Insecta` scrape has no humans in it.

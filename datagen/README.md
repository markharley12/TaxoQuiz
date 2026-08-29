# datagen — building your own dataset

The game does **not** need any of this. It ships with an example dataset
(`src/taxoquiz/data/example_tree.json`, 530 species) that is loaded by default,
so a fresh clone is playable with no scrape and no network. These scripts exist
only to build a **bigger** dataset from Wikidata — tens of thousands of species
instead of hundreds.

Everything here writes into `data/` at the repo root, which is gitignored. Output
is organised into **datasets** — one directory per tree, holding that tree and the
taxon info that matches it.

```bash
pip install -e ".[datagen]"    # these scripts need `requests`; the game does not

python3 datagen/scraper.py             # → data/_cache/wikidata-tree-raw.json
python3 datagen/extract_game_tree.py   # → data/<name>/tree.json, and prints <name>

export TAXOQUIZ_DATASET=<name>
python3 datagen/scrape_taxon_info.py   # → data/<name>/taxon_info.json  (optional)
./start.sh
```

Run them in that order — each reads the previous one's output.

**Nothing here can destroy a dataset you already have.** Every write is atomic, so
an interrupted scrape leaves the previous file whole and resumes from its last
checkpoint; and `extract_game_tree.py` refuses to overwrite an existing
`tree.json` without `--force`. Build a better dataset alongside the one you are
using, and switch over with `$TAXOQUIZ_DATASET` once you're happy with it.

| Script | Does |
| --- | --- |
| `scraper.py` | Wikidata → the full tree of life. The slow one. Size is set by `MIN_SITELINKS` at the top of the file; see the main README's sizing table. |
| `extract_game_tree.py` | That tree → one the game can actually load. **Not optional** — see below. |
| `scrape_taxon_info.py` | Wikipedia → summaries and thumbnails for the click-a-node popup. Reads the taxa straight out of `tree.json`, and writes results into `taxon_info.json` as it goes. Optional; the game plays without it. |

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

Wikidata expresses a taxon's rank as a Q-ID. `RANK_LABELS` in `scraper.py` maps
the common dozen so the usual case needs no lookup, and **anything it misses is
resolved from Wikidata in one batched query** at tree-build time.

That query runs even when the species and ancestor caches are warm, so a scrape
you already have is repaired by re-running `scraper.py` — it costs one request,
not another full scrape.

Before this existed, an unrecognised rank fell through as the raw Q-ID and ended
up in the tree as `rank: "Q227936"` — 1,609 nodes across 37 distinct ranks in the
current scrape, among them `tribe` (772 nodes), `subtribe` and `subgenus`. Ranks
are shown in the taxon popup, so it was visible, not just untidy.

A rank with no English label at all falls back to `clade`, which is also what an
explicitly unranked node gets — common in modern taxonomy.

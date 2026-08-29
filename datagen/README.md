# datagen — building your own dataset

The game does **not** need any of this. It ships with an example dataset
(`src/taxoquiz/data/example_tree.json`, 530 species) that is loaded by default,
so a fresh clone is playable with no scrape and no network. These scripts exist
only to build a **bigger** dataset from Wikidata — tens of thousands of species
instead of hundreds.

Everything here writes to `data/` at the repo root, which is gitignored.

```bash
pip install -e ".[datagen]"    # these scripts need `requests`; the game does not

python3 datagen/scraper.py            # → data/species.json, ancestors.json, tree_of_life.json
python3 datagen/build_taxon_list.py   # → data/taxon_list.json
python3 datagen/scrape_taxon_info.py  # → data/taxon_info.json
```

Run them in that order — each reads the previous one's output.

| Script | Does |
| --- | --- |
| `scraper.py` | Wikidata → the full tree of life. The slow one. Size is set by `MIN_SITELINKS` at the top of the file; see the README's sizing table. |
| `build_taxon_list.py` | Tree → the list of ancestor taxa to fetch info for. Use `--tree` to point it at whichever tree you intend to play on. |
| `scrape_taxon_info.py` | Wikipedia → summaries and thumbnails, for the click-a-node popup. |

## Wiring a scraped tree into the game

There is **no committed script for this yet**. `scraper.py` produces a tree
rooted at `Life`, while the game expects one rooted at `Animalia`, so the
Animalia subtree has to be extracted. The original extraction was done by hand.

Once extracted, point the game at it — `load_tree()` takes a path, and
`$TAXOQUIZ_DATA_DIR` controls where generated data is read from.

# TaxoQuiz

A phylogenetic animal guessing game built on real taxonomy scraped from Wikidata.

Dataset size is a tuning knob, not a fixed property: the bundled example is 530
species, and a full scrape reaches tens of thousands. See **Dataset** below —
getting this wrong is the single easiest way to be confused by this repo.

## What the Game Is

The player tries to guess a secret animal. After each guess, the game reveals how closely related the guessed animal is to the secret one by showing their lowest common ancestor in the tree of life. The closer the shared ancestor (lower in the tree), the warmer the guess. The player wins when they guess the exact animal.

## Status

All three layers are built and working:

1. **CLI** — every module in `src/taxoquiz/game/` has a `__main__` block; see the README
2. **API** — `src/taxoquiz/api/main.py`, FastAPI over the game logic
3. **GUI** — `frontend/`, React 19 + TypeScript + MUI + react-d3-tree

`./start.sh` runs the API and frontend together.

## Layout

Standard src layout, `pip install -e .` (packaging via `pyproject.toml`; there is
no `requirements.txt`). Three separate concerns, deliberately kept apart:

- `src/taxoquiz/` — the app. Ships with its own example dataset in
  `src/taxoquiz/data/`, so an install is playable with no scrape and no network.
- `datagen/` — tools for building a bigger dataset. **The game never imports
  these**, and they are the only thing that needs `requests`
  (`pip install -e ".[datagen]"`). Has its own README.
- `data/` — output of those tools. Gitignored, regenerable, never committed.

## Dataset

Two separate things, and the distinction matters: a committed **example** the
game loads out of the box, and a **scrape** you run yourself to get a bigger one.
Scraped data lives in `data/` (gitignored, regenerable). The example lives inside
the package and is committed.

**A dataset is a directory** — `data/<name>/{tree,taxon_info}.json` —
selected with `$TAXOQUIZ_DATASET`, unset meaning the example bundled in the
package. Tree and taxon info are deliberately one unit: they were separately
selectable until Aug 2026, which silently paired an 18k-species scrape with the
530-species example's info and filled the tree with "No information available".
Naming a dataset without a `tree.json` raises rather than falling back.
`$TAXOQUIZ_TREE` was the old mechanism and now **raises if set**, rather than
being ignored, so nobody lands on the wrong data by accident.

**Nothing is stored that the tree already determines** (Aug 2026). There used to
be a `taxon_list.json` per dataset holding the taxa to fetch, and `taxon_info.json`
stored each taxon's `rank`. Both were copies: the list is exactly "every node with
children" in `tree.json`, and rank is a field on those nodes. `get_ancestors()` and
`rank_of()` in `game/tree.py` derive them, `scrape_taxon_info.py` reads the tree
directly and writes into `taxon_info.json` in place, and the API merges rank in on
read. This deleted one file per dataset and one whole script. If you find yourself
adding a file listing things that are in the tree, it is the same mistake.

**Data safety — two rules, both because a scrape is long and interruptible.**

1. **All writes go through `taxoquiz.jsonio.write_json_atomic`.** Never
   `open(path, "w")` for a data file: it truncates before writing a byte, so an
   interrupt leaves nothing. `scrape_taxon_info.py` checkpoints every 50 entries
   across an hour-plus run — that was 160+ chances to destroy an existing file.
   Atomic write means a crash always leaves the previous version whole.
2. **Building a dataset never writes into another.** `extract_game_tree.py`
   refuses an existing `tree.json` without `--force`. The intended way to try a
   better scrape is to build it alongside and switch when happy, so there is no
   moment where the working data is gone and the new data isn't ready.

`data/` is gitignored and nothing else protects it, which is why both of the
above are enforced in code rather than by convention.

Paths are resolved in `src/taxoquiz/paths.py`, not by `__file__` arithmetic: the
example is read via `importlib.resources` so it survives being installed, and the
generated dir is CWD-relative.

`load_tree()` caches by resolved path. Before that, all three game modules called
it independently and the file was parsed three times into three separate copies —
invisible at 530 species, wasteful at 44MB. Nothing mutates the tree (`_prune`
builds fresh dicts), so one shared copy is safe.

| File | Description |
|---|---|
| `data/_cache/wikidata-species.json` | Flat map of Wikidata Q-ID → `{common_name, scientific_name, parent, sitelinks}`. ~41k species. |
| `data/_cache/wikidata-ancestors.json` | Flat map of Q-ID → ancestor node metadata fetched during tree construction. |
| `data/_cache/wikidata-tree-raw.json` | Nested tree rooted at Life, built from the above two files. ~57k nodes total. |
| `data/<name>/taxon_info.json` | Wikipedia text + image per taxon, keyed by name. Optional; only the popup reads it. |
| `src/taxoquiz/data/example_tree.json` | **The file the game actually loads** (`game/tree.py`). The bundled example: committed, 530 species, 1,609 nodes, 19 deep. |

### `example_tree.json` is a fixture, not build output

It was generated once from a hand-curated NCBI-style taxonomy and checked in, so
that a clone is playable with no scrape and no network. **Nothing rebuilds it, and
it is not a subtree of the Wikidata scrape** — don't go looking for the script.
(The generator, `build_animals-1.py`, was deleted in Aug 2026 as legacy; the file
was verified byte-for-byte reproducible from it first, so nothing was lost that
the committed JSON doesn't already hold. It's in git history if ever needed. The
file was also called `animals_tree.json` at the repo root until Aug 2026.)

**Gotcha, learned the hard way:** `.gitignore` patterns here must be anchored
(`/data/`, not `data/`). An unanchored rule also matches `src/taxoquiz/data/`,
and since hatchling honours `.gitignore` when selecting files, that silently
dropped the example dataset out of every built wheel. Check `python -m build
--wheel` still contains `taxoquiz/data/example_tree.json` after touching it.

**`scraper.py`'s output has never been wired into the game.** It is the more
capable pipeline and the intended route to a bigger dataset, but nothing loads
`data/_cache/wikidata-tree-raw.json` today. Its Animalia subtree holds 18,444 species against
the sample's 530.

**`datagen/extract_game_tree.py` bridges the two** (added Aug 2026 — before it,
there was no committed way to play on scraped data at all). Raw scraper output is
not loadable, for three separate reasons, all of which fail quietly or confusingly:

1. It is rooted at `Life`; the game wants a kingdom.
2. **The schema is inverted.** The scrape puts the common name in `name` and the
   binomial in `scientific_name`; the game wants `name` to be the binomial with
   the common name in `common_name`. Raw output raises `KeyError: 'common_name'`.
3. **Names are not unique.** A default Animalia scrape has ~1,100 duplicate common
   names ("Cichlid" covers 38 species) plus 63 duplicate *node* names from real
   homonyms (Gnathostomata is both a vertebrate clade and a sea-urchin
   superfamily), genus nodes mislabelled with a binomial, and genus/subgenus pairs
   sharing a name. The game keys its depth index on the name, so every one of
   these silently corrupts play. The script collapses, qualifies and finally
   number-suffixes until unique, and refuses to write if any remain.

Measured on the current scrape: 18,421 species, **64 levels deep against the
example's 18** — which is why the frontend reads its depth scale from `/dataset`
rather than a constant.

**The colour anchor is the 75th percentile of species depth, not the maximum**
(`COLOR_ANCHOR_PERCENTILE` in `api/main.py`). Anchoring on the deepest lineage
sounds right and plays badly: in the scrape that is Human at 59 of 64, while the
median species sits at 26 — so scaled against 64 a median secret tops out
yellow-orange even when you guess its own genus, and over half of all games could
never look warm however well they were played. The percentile keeps the scale
absolute (same depth, same colour; nothing about the secret leaks) while letting
a typical game reach green. Example anchors at 15, the scrape at 43.

Known gap: `scraper.py` leaves ~640 nodes with an unresolved Wikidata Q-ID as
their `rank` (`Q227936` etc.) instead of a label. Cosmetic today — rank is not
displayed — but it is a scraper bug, not a converter one.

### Sizing a scrape

`scraper.py` filters species by `MIN_SITELINKS` (top of the file) — the number of
Wikipedia language editions with an article, used as a fame/significance score.
Measured counts across all life:

| `MIN_SITELINKS` | Species |
| ---: | ---: |
| 10 *(default)* | 41,143 |
| 20 | 17,809 |
| 30 | 6,186 |
| 50 | 1,486 |
| 75 | 508 |

Higher threshold = smaller, more famous, more guessable set.

## Key Data Shapes

**wikidata-species.json entry:**
```json
"Q140": {
  "common_name": "Lion",
  "scientific_name": "Panthera leo",
  "parent": "Q127960",
  "sitelinks": 270
}
```

**wikidata-tree-raw.json node:**
```json
{ "name": "Life", "rank": "...", "children": [ ... ] }
```

## Game Logic (implemented — `game/game_state.py`)

Note this diverges from the original sketch: the API returns an annotated **tree**
rather than a per-guess distance report.

- Tree loaded once and indexed at import; the API caches it at startup
- Secret animal is random, or seeded from the date for daily mode
  (sitelinks weighting was never implemented — the sample carries no sitelinks)
- Each guess's LCA with the secret is found via lineage comparison; the LCA's
  **depth** is the score, returned as `lca_depth` and used for the frontend's
  red→green gradient
- Display tree is the union of guessed lineages, pruned to those paths, with
  single-child ancestor chains collapsed
- A `???` node marks the child of the deepest reached LCA on the secret's
  lineage — reveals the branch, not the depth
- Win condition: guess matches the secret

## Dev Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .              # add ".[datagen]" if you're running the scrapers
```

The game's only runtime dependencies are `fastapi` and `uvicorn`. `requests` is
an optional extra, needed by `datagen/` alone.

## Running the Dev Servers

**Quickstart** — starts both servers, kills any existing ones first:

```bash
./start.sh
```

| URL | Service |
| --- | --- |
| <http://localhost:5173> | Frontend (Vite) |
| <http://localhost:8000> | API (uvicorn) |

Ctrl+C stops both. The Vite dev server proxies `/api/*` to `localhost:8000`, so both must be running for the frontend to work.

**Manual start** (if you need separate terminals):

```bash
# terminal 1 — from project root
source .venv/bin/activate
uvicorn taxoquiz.api.main:app --port 8000 --reload

# terminal 2 — from frontend/
npm run dev
```

## Conventions

- Python 3, standard library preferred
- Game logic should be pure functions over the tree data structures — easy to test and reuse across CLI/API/GUI layers
- Keep the tree loading separate from game logic so it can be cached at API startup
- `data/` is gitignored; committed code must work from the bundled
  `src/taxoquiz/data/example_tree.json`, which is checked in. Never make the game
  depend on anything in `data/` — the taxon-info popup is the one optional
  feature that does, and it degrades to 404s rather than failing to start.

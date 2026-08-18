# TaxoQuiz

A phylogenetic animal guessing game built on real taxonomy scraped from Wikidata.

Dataset size is a tuning knob, not a fixed property: the committed sample is 530
species, and a full scrape reaches tens of thousands. See **Dataset** below —
getting this wrong is the single easiest way to be confused by this repo.

## What the Game Is

The player tries to guess a secret animal. After each guess, the game reveals how closely related the guessed animal is to the secret one by showing their lowest common ancestor in the tree of life. The closer the shared ancestor (lower in the tree), the warmer the guess. The player wins when they guess the exact animal.

## Status

All three layers are built and working:

1. **CLI** — every module in `game/` has a `__main__` block; see the README
2. **API** — `api/main.py`, FastAPI over the game logic
3. **GUI** — `frontend/`, React 19 + TypeScript + MUI + react-d3-tree

`./start.sh` runs the API and frontend together.

## Dataset

Scraped data lives in `data/` (gitignored, regenerable — `scraper.py`). The file
the game loads sits at the repo root and is committed. They have **different
provenance** — see below.

| File | Description |
|---|---|
| `data/species.json` | Flat map of Wikidata Q-ID → `{common_name, scientific_name, parent, sitelinks}`. ~41k species. |
| `data/ancestors.json` | Flat map of Q-ID → ancestor node metadata fetched during tree construction. |
| `data/tree_of_life.json` | Nested tree rooted at Life, built from the above two files. ~57k nodes total. |
| `animals_tree.json` | **The file the game actually loads** (`game/tree.py`). Committed. 530 species, 1,609 nodes, 19 deep. |

### Which script produced which file — read this before touching the data

This is the one genuinely confusing thing in the repo, so it is spelled out:

- **`animals_tree.json` is the output of `build_animals-1.py`**, the hand-curated
  NCBI-style taxonomy — *not* a subtree of the Wikidata scrape. Verified: running
  `build_animals-1.py` yields exactly the same 530 common names. It is dated an
  hour *before* `tree_of_life.json` exists.
- **`build_animals-1.py` is therefore not superseded.** It is the source of the
  committed sample. (Note it writes to a hardcoded `/home/claude/animals.json`,
  a sandbox path — change `OUTPUT_FILE` before running it here.)
- **`scraper.py`'s output has never been wired into the game.** It is the more
  capable pipeline and the intended future source, but nothing loads
  `data/tree_of_life.json` today. Its Animalia subtree holds 18,444 species
  against the sample's 530.

Switching the game to the scraped data means extracting the Animalia subtree to
`animals_tree.json` — **there is no committed script that does this**; the
original extraction was run by hand. That, plus a rescrape of
`scrape_taxon_info.py` for the new ancestor nodes, is the work involved.

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

**species.json entry:**
```json
"Q140": {
  "common_name": "Lion",
  "scientific_name": "Panthera leo",
  "parent": "Q127960",
  "sitelinks": 270
}
```

**tree_of_life.json node:**
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
pip install -r requirements.txt
```

Runtime dependency: `requests` (scraper only). The game itself needs no external packages.

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
uvicorn api.main:app --port 8000 --reload

# terminal 2 — from frontend/
npm run dev
```

## Conventions

- Python 3, standard library preferred
- Game logic should be pure functions over the tree data structures — easy to test and reuse across CLI/API/GUI layers
- Keep the tree loading separate from game logic so it can be cached at API startup
- `data/` is gitignored; committed code must work from `animals_tree.json` (the Animalia subtree) which is checked in

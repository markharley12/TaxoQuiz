# TaxoQuiz

A phylogenetic animal guessing game with a dramatically larger species set than similar games — targeting tens of thousands of animals scraped from Wikidata.

## What the Game Is

The player tries to guess a secret animal. After each guess, the game reveals how closely related the guessed animal is to the secret one by showing their lowest common ancestor in the tree of life. The closer the shared ancestor (lower in the tree), the warmer the guess. The player wins when they guess the exact animal.

## Roadmap

1. **CLI** — terminal game, current focus
2. **API** — HTTP layer over the game logic
3. **GUI** — web or TUI frontend

## Dataset

The dataset was scraped from Wikidata and lives in `data/` (gitignored — regenerate with `scraper.py`).

| File | Description |
|---|---|
| `data/species.json` | Flat map of Wikidata Q-ID → `{common_name, scientific_name, parent, sitelinks}`. ~41k species. |
| `data/ancestors.json` | Flat map of Q-ID → ancestor node metadata fetched during tree construction. |
| `data/tree_of_life.json` | Nested tree rooted at Life, built from the above two files. ~57k nodes total. |
| `animals_tree.json` | Subtree rooted at Animalia — the game's working dataset. |

`build_animals-1.py` was an early script for building a hand-coded animal taxonomy (now superseded by the Wikidata scraper). `scraper.py` is the canonical data pipeline.

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

## Game Logic (to be built)

- Load the tree at startup
- Pick a random species as the secret animal (optionally weighted by sitelinks for notoriety)
- On each guess, find the lowest common ancestor (LCA) of the guess and the secret in the tree
- Report: the LCA taxon name + rank, and the taxonomic distance (number of edges from guess to LCA)
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

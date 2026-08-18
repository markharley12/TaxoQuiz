# TaxoQuiz

A phylogenetic guessing game. You're given a secret animal and have to find it by
guessing others — after each guess the game shows you where your guess and the
secret one part ways on the tree of life.

Guess *tiger* when the answer is *lion* and you'll see they diverge at
**Panthera**, 15 levels deep — very warm. Guess *grey wolf* and you diverge at
**Carnivora**, depth 11. Guess *earthworm* and you're back at **Animalia**,
depth 0 — as cold as it gets. The tree grows with every guess, and the branch
containing the answer is marked `???` until you find it.

The taxonomy is real, pulled from Wikidata, rather than a hand-authored set of
categories.

## How the scoring works

Every animal has a lineage — the chain of taxa from `Animalia` down to the
species. Scoring is the **lowest common ancestor** (LCA) of two lineages: the
deepest node they still share.

```
lion       Animalia → … → Carnivora → Feliformia → Felidae → Pantherinae → Panthera → Panthera leo
tiger      Animalia → … → Carnivora → Feliformia → Felidae → Pantherinae → Panthera → Panthera tigris
                                                                          ^^^^^^^^ LCA depth 15

grey wolf  Animalia → … → Carnivora → Caniformia → Canidae → Canis → Canis lupus
                          ^^^^^^^^^^ LCA depth 11

earthworm  Animalia → Annelida → Clitellata → Opisthopora → Lumbricidae → Lumbricus → Lumbricus terrestris
           ^^^^^^^^ LCA depth 0
```

The LCA's **depth** is the score, and it drives the red→green colour gradient on
the displayed tree. Deeper LCA = more shared evolutionary history = warmer guess.

The displayed tree is the union of your guesses' lineages, pruned to just those
paths, so it starts tiny and fills in as you play. Single-child ancestor chains
are collapsed to keep it readable.

**The `???` node** is the one hint the game volunteers. It sits immediately
*below* the deepest LCA you've reached, on the secret's lineage — so it tells you
which branch to go down without revealing how far down the answer sits. See
`game/game_state.py`.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cd frontend && npm install && cd ..

./start.sh
```

**No scraping needed** — a sample dataset is committed, so the game is playable
immediately after install. See [Datasets](#datasets) to build a bigger one.

`start.sh` runs both servers and clears anything already on those ports:

| URL | Service |
| --- | --- |
| <http://localhost:5173> | Frontend (Vite) |
| <http://localhost:8000> | API (uvicorn) |
| <http://localhost:8000/docs> | Auto-generated API docs |

Vite proxies `/api/*` to port 8000, so both need to be running. Ctrl+C stops both.
To run them separately:

```bash
uvicorn api.main:app --port 8000 --reload   # project root, venv active
npm run dev                                  # frontend/
```

## Game modes

- **Daily** — the animal is seeded from the date, so everyone gets the same one.
- **Practice** — a fresh random animal whenever you want, unlimited.

Game state persists to `localStorage` and expires at midnight, so you can close
the tab mid-game and come back.

## Playing without the frontend

Every piece of game logic is a module with a CLI:

```bash
python -m game.pick_animal --daily            # today's animal
python -m game.list_animals shark 10          # autocomplete: up to 10 matches
python -m game.game_state lion tiger "grey wolf"   # annotated tree as JSON
```

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/animal/random?daily=false` | Pick the secret animal |
| `GET` | `/animals?q=&limit=30&exclude=` | Autocomplete over common names |
| `POST` | `/game/state` | Annotated display tree for `{secret, guesses}` |
| `GET` | `/taxon/{name}` | Wikipedia summary + thumbnail for a taxon |

`/game/state` returns nodes carrying `label`, `node_type`
(`ancestor` / `guess` / `secret`), `depth`, `on_secret_path`, `children`, and
`lca_depth` on guess nodes. It 400s on any name not in the dataset.

## Datasets

`animals_tree.json` is committed and is **a small sample** — 530 species, 1,609
nodes, 19 levels deep — enough to play and to test against without running a
scrape. A full scrape produces **tens of thousands** of animals.

### Sizing a scrape

`scraper.py` scores species by **sitelinks** — the number of Wikipedia language
editions with an article on that species. It's a good proxy for how well known an
animal is: a lion has hundreds, an obscure beetle has two. Raising the threshold
gives a smaller, more famous, more guessable set; lowering it gives a bigger,
harder one.

Set `MIN_SITELINKS` at the top of `scraper.py`. Measured species counts across
all life:

| `MIN_SITELINKS` | Species | Feel |
| ---: | ---: | --- |
| 10 *(default)* | 41,143 | Everything, including the deeply obscure |
| 20 | 17,809 | Large |
| 30 | 6,186 | Substantial |
| 40 | 2,692 | Comfortable |
| 50 | 1,486 | Well-known animals |
| 75 | 508 | Household names only |
| 100 | 159 | Very small |

Filtering to a subtree (`Animalia`, `Plantae`, `Fungi`) narrows it further — the
Animalia subtree of a default scrape holds 18,444 species.

### Running a scrape

```bash
python3 scraper.py              # → data/species.json, ancestors.json, tree_of_life.json
python3 scrape_taxon_info.py    # → data/taxon_info.json
```

`data/` is gitignored — it's regenerable and large (a default scrape is ~50MB).
Intermediate results are cached to `species.json` and `ancestors.json`, so a
failed run resumes without re-fetching.

`scraper.py` builds the tree in three stages rather than using a SPARQL recursive
property path (`wdt:P171+`), which times out on Wikidata's public endpoint over
the full species set: fetch species in indexed pages, resolve parent taxa in bulk
`VALUES` batches until every ancestor is known, then assemble the nested tree.
The reasoning is in the module docstring.

**Note:** `/taxon/{name}` needs `data/taxon_info.json` and returns 404 for
everything until you generate it. The API starts fine without it and the game is
fully playable — only the click-a-node info popup is affected.

## Layout

```
game/          Pure game logic — no framework, no I/O beyond loading the tree
  tree.py         Load the tree, flatten to leaf species
  pick_animal.py  Random or date-seeded selection
  list_animals.py Substring autocomplete
  game_state.py   Lineage index, LCA, pruning, the ??? reveal
api/main.py    FastAPI layer over the above
frontend/      React 19 + TypeScript + MUI + react-d3-tree
scraper.py            Wikidata → tree of life
scrape_taxon_info.py  Wikipedia → summaries and images
animals_tree.json     Committed sample dataset
```

Game logic is deliberately pure functions over the tree, kept separate from tree
loading so the API can cache the tree at startup and the same code backs both the
CLI and the web app.

## Attribution

Taxonomy and species data from [Wikidata](https://www.wikidata.org) (CC0).
Taxon summaries and images from [Wikipedia](https://en.wikipedia.org) via the
REST summary API (text CC BY-SA). Both are fetched with an identifying
User-Agent and a deliberate delay between requests.

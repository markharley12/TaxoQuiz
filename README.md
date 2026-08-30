# TaxoQuiz

A phylogenetic guessing game. You're given a secret animal and have to find it by
guessing others — after each guess the game shows you where your guess and the
secret one part ways on the tree of life.

Guess *tiger* when the answer is *lion* and you'll see they diverge at
**Panthera**, 15 levels deep — very warm. Guess *grey wolf* and you diverge at
**Carnivora**, depth 11. Guess *earthworm* and you're back at **Animalia**,
depth 0 — as cold as it gets. The tree grows with every guess, and the branch
containing the answer is marked `???` until you find it.

![The three guesses above, played out: tiger and grey wolf branching deep inside
the carnivores in green, earthworm peeling off at Animalia in red, and the ???
node marking the branch the answer is hiding
down.](docs/images/game.png)

*That is the example above, actually played.* Warmer guesses sit deeper and
greener; the earthworm branches off at the root and stays red. How far **down**
a branch point sits is meaningful too — it is proportional to how much lineage
the guess shares with the answer, not just to how many guesses you have made.
The seed at the top is real: enter `RZVM-X6N69Q` and you will get this same
round.

Click any node to read what it actually is — the clades *and* the species you
guessed. Collapsed chains expand into the whole run of taxa they stand for, so
the tree doubles as a way to learn the lineage rather than just a scoreboard.

![The popup opened on Boreoeutheria, showing a photo, its rank as a superorder,
and a Wikipedia summary explaining that it groups zebras, cats and primates
together.](docs/images/taxon.png)

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

The LCA's **depth** is the score, and it drives the colour gradient on the
displayed tree. Deeper LCA = more shared evolutionary history = warmer guess.
The gradient runs red→green by default; the settings menu (the gear in the
header) offers a red→violet rainbow instead, and the same menu switches the
tree between growing **down** (the default) and growing **across**. Both are
browser-local preferences shared by all three modes — they change the drawing,
never the game.

The displayed tree is the union of your guesses' lineages, pruned to just those
paths, so it starts tiny and fills in as you play. Single-child ancestor chains
are collapsed to keep it readable — but the gap left behind stays
**proportional to the ranks collapsed**, so a guess that branches off near the
root sits visibly further back than one that branches off deep. Without that, a chimp
and a comb jelly appear to diverge from you at the same moment.

The colour scale is **absolute**: a given LCA depth is always the same colour, so
a node never changes shade because of a guess you made later. It is anchored on a
high percentile of the dataset's species depth rather than its deepest lineage,
which is an outlier — see `GET /dataset`.

**The `???` node** is the one hint the game volunteers. It sits immediately
*below* the deepest LCA you've reached, on the secret's lineage — so it tells you
which branch to go down without revealing how far down the answer sits. See
`src/taxoquiz/game/game_state.py`.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

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
uvicorn taxoquiz.api.main:app --port 8000 --reload   # project root, venv active
npm run dev                                          # frontend/
```

## Game modes

- **Daily** — seeded from the date, so everyone gets the same one.
- **Practice** — a fresh animal whenever you want, unlimited.
- **Explore** — no secret and nothing to guess; see below.

Game state persists to `localStorage` and expires at midnight, so you can close
the tab mid-game and come back.

### Explore — the tree with the game taken out

Explore drops the secret, the guessing and the `???` node, and leaves you with
the taxonomy itself. Start at the root, open whatever looks interesting, and
read the popup on anything. Search jumps to any taxon *or* species — a clade is
a destination here, not just a thing you can be scored against — and lands with
its whole lineage from the root left open above it. Every name in the trail is
clickable, which re-roots the view on it.

The depth colouring is the same absolute scale the game uses, so it means the
same thing in both places. Here it reads as age: the ancient clades near the
root are red, and by the time you are down among the genera it is green (or
violet, on the rainbow scale).

Nodes show how many species sit beneath them, which is what makes browsing a
taxonomy possible at all — `Aves` and `Onychophora` look identical as labels,
and one of them holds a thousand species. Species read the same as clades: click
one and you get its article, headed by its common name with the scientific name
beneath.

**On expanding everything.** There is an *Expand all* button, and on a full
Wikidata scrape it is a bad idea; it is there because "what happens if I just
render the whole thing?" deserves a real answer rather than a guess. Measured
on one laptop:

| Nodes | First render | One drag-pan |
| --- | --- | --- |
| 1,996 | 4.7 s | 120 ms |
| 27,169 | ~180 s | 15.4 s |

At the full size Chrome could not screenshot the page afterwards. Above 2,000
nodes the button asks first and quotes those numbers. The browse-by-clicking
path has no such limit, because it only ever draws what you have opened.

### Seeds — playing the same round as someone else

Every game shows a seed like `RZVM-90QXHY`. Send it to someone, they paste it
into **Play seed**, and they get the same secret animal.

Daily shows its seed too, so you can hand today's round to a friend who has
already played theirs. Daily is not a separate mechanism: it is a seed derived
from the date, which is what makes it the same for everybody.

![The start screen: Daily and Practice buttons, and below them a box for pasting
in a seed someone has shared with you.](docs/images/start.png)

```bash
python -m taxoquiz.game.pick_animal              # a new practice seed
python -m taxoquiz.game.pick_animal --daily      # today's
python -m taxoquiz.game.pick_animal RZVM-90QXHY  # replay one
```

The `RZVM` half fingerprints the **dataset**. The example ships 530 species and a
full scrape has 18,421, so without it the same seed would mean different animals
to different people — silently, which is the worst outcome. A seed from another
dataset is rejected with a message saying so, rather than resolving to something
else. Seeds are case-insensitive and the dash is optional.

Seeds are **not secret**: the mapping is a plain hash over a public species list,
so anyone willing to read the source can work out their own seed's answer. That
is the trade for seeds being short, shareable and needing no server state.

## Playing without the frontend

Every piece of game logic is a module with a CLI:

```bash
python -m taxoquiz.game.pick_animal --daily          # today's animal, with its seed
python -m taxoquiz.game.list_animals shark 10        # autocomplete: up to 10 matches
python -m taxoquiz.game.game_state lion tiger "grey wolf"   # annotated tree as JSON
```

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/animal?daily=&seed=` | Start a game → `{animal, seed, daily}`. 400 on a bad or foreign seed |
| `GET` | `/animals?q=&limit=30&exclude=` | Autocomplete over common names |
| `POST` | `/game/state` | Annotated display tree for `{secret, guesses}` |
| `GET` | `/taxon/{name}` | Wikipedia summary + thumbnail for any node, species included |
| `GET` | `/dataset` | Which dataset is loaded, what's available, species count, depth scale |
| `GET` | `/explore?root=&depth=&budget=200` | A slice of the tree for browsing. `-1` on either limit means no limit |
| `GET` | `/explore/lineage/{name}` | `{path, tree}` — the root-down spine to `name`, for jumping to it |
| `GET` | `/explore/search?q=&limit=25` | Search every node, scientific and common names |
| `GET` | `/explore/stats` | Node count, species count, max depth |

`/game/state` returns nodes carrying `label`, `node_type`
(`ancestor` / `guess` / `secret`), `depth`, `on_secret_path`, `children`, and
`lca_depth` on guess nodes. It 400s on any name not in the dataset.

`/explore` returns a different shape — `name`, `rank`, `depth`, `child_count`,
`species_count`, `node_count`, `truncated`, `children` — because it answers a
different question. `truncated` means "there are children I did not send", which
is what lets a client tell an unopened node from a genuine leaf.

Its `budget` is a **node** count, not a depth, and is spent breadth-first. Depth
is the wrong knob on a real taxonomy: the Wikidata tree opens with a single-child
chain (`Animalia › Eumetazoa › ParaHoxozoa › Bilateria › …`), so three levels
from the root is nine nodes, while three levels from a bushy genus is hundreds.
A node budget runs deep through the chain and stops early in the bush.

## Datasets

The game ships with a dataset so it is playable straight after install, and can
be pointed at a much bigger one you generate yourself.

### What a dataset is

A dataset is a directory under `data/` holding a tree and, optionally, the
Wikipedia info for that tree's taxa:

```
data/<name>/tree.json         the taxonomy you play on
data/<name>/taxon_info.json   summaries and images for the popup (optional)
```

They travel together deliberately. The tree and the taxon info used to be picked
independently, which made it easy — and silent — to play an 18k-species scrape
while displaying the 530-species example's info, giving a tree full of
"No information available".

```bash
./start.sh                                       # the bundled example
TAXOQUIZ_DATASET=wikidata-2026-08 ./start.sh     # one you built
```

Unset plays the example that ships inside the package. Naming a dataset with no
`tree.json` raises rather than falling back, so you cannot quietly end up on 530
species when you asked for your own scrape. `GET /dataset` reports which is
loaded, what's available, the species count and the depth scale.

Two environment variables, and only two:

| Variable | Effect |
| --- | --- |
| `TAXOQUIZ_DATASET` | Which dataset to play. Unset = the bundled example. |
| `TAXOQUIZ_DATA_DIR` | Where the `data/` root is. Defaults to `data/` relative to the working directory; set it to run from outside the repo. |

(`TAXOQUIZ_TREE` was an earlier mechanism that selected a tree file independently
of its taxon info. It now **raises** if set, rather than being ignored, so nobody
silently ends up on the wrong data.)

Every JSON file in the project, and which of them the game actually reads:

| File | Read by the game? | What it is |
| --- | --- | --- |
| `src/taxoquiz/data/example_tree.json` | **yes**, by default | The bundled example taxonomy. Committed; ships in the package. |
| `src/taxoquiz/data/example_taxon_info.json` | yes, for the popup | Wikipedia text for the example tree's 1,079 taxa. Committed; ships in the package. |
| `data/<name>/tree.json` | **yes**, when selected | A taxonomy you built. |
| `data/<name>/taxon_info.json` | optional | Wikipedia text + images for the popup. |
| `data/_cache/wikidata-tree-raw.json` | no | Raw scrape, rooted at Life. Not playable — see `datagen/`. |
| `data/_cache/wikidata-species.json` | no | Scraper cache, so a failed run resumes. |
| `data/_cache/wikidata-ancestors.json` | no | Scraper cache, as above. |

[`data/README.md`](data/README.md) covers these in full and is committed, so the
explanation sits next to the files it describes.

### Not losing data

Two properties, both of which exist because a scrape is long and interruptible:

- **Every write is atomic.** Files are written to a temporary file in the same
  directory and then `os.replace`-ed into place, so a crash, a `Ctrl-C` or a full
  disk leaves the previous version intact. This matters most for
  `taxon_info.json`: the scrape checkpoints every 50 entries across an hour-long
  run, and a plain `open(path, "w")` truncates before writing a byte, so it had
  well over a hundred windows in which it could have destroyed an existing file.
- **Building a dataset never touches another one.** `extract_game_tree.py`
  refuses to overwrite an existing `tree.json` unless you pass `--force`, so the
  way to try a better scrape is to build it alongside the one you have and switch
  over only when you're happy.

`src/taxoquiz/data/example_tree.json` is the **built-in example**: 530 species,
1,609 nodes, max depth 18 (the figure `/dataset` reports). It lives inside the
package, so `pip install` alone gives a playable game with no scrape and no
network — `src/taxoquiz/game/tree.py` loads it by default.

Its taxon text ships alongside it in `example_taxon_info.json` — 1,079 entries,
every ancestor in the example tree, 1,012 of them with an image — so the
click-a-node popups work out of the box instead of reading "No information
available" until you run a scrape. The 67 without an image still have text; the
popup just omits the picture. Only
the example gets that fallback; a dataset you build reads its own file or shows
nothing, because displaying one tree's text against another's nodes is exactly
the mismatch datasets exist to prevent. It is a fixture, not scraper output: generated once from a hand-curated
NCBI-style taxonomy and checked in as-is, which is why no script rebuilds it.

Running a scrape produces **tens of thousands** of animals instead.

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
Animalia subtree of a default scrape holds 18,444 species, of which **18,421**
survive into a playable dataset. Both numbers are correct and appear in these
docs: `extract_game_tree.py` collapses genus/subgenus pairs that share a name,
which removes 23.

### Running a scrape

Everything for this lives in [`datagen/`](datagen/), which has its own README.
The game itself never touches these scripts.

```bash
pip install -e ".[datagen]"      # the scrapers need `requests`; the game does not

python3 datagen/scraper.py                    # → data/_cache/wikidata-tree-raw.json
python3 datagen/extract_game_tree.py          # → data/<name>/tree.json, playable

export TAXOQUIZ_DATASET=<name>                # the name it just printed
python3 datagen/scrape_taxon_info.py          # → data/<name>/taxon_info.json (optional)
./start.sh
```

Run them in that order — each reads the previous one's output.

`extract_game_tree.py` is not optional. `scraper.py` writes a tree rooted at
`Life` whose schema is *inverted* relative to the game's — the scrape puts the
common name in `name`, the game expects the binomial there — so playing on raw
scraper output fails with `KeyError: 'common_name'`. It also resolves the ~1,100
duplicate common names a default Animalia scrape contains ("Cichlid" alone covers
38 species), which would otherwise silently collapse into one entry.

`data/` is gitignored — it's regenerable and large (a default scrape is ~60MB across the cache).
Intermediate results are cached to `wikidata-species.json` and `wikidata-ancestors.json`, so a
failed run resumes without re-fetching.

`scraper.py` builds the tree in three stages rather than using a SPARQL recursive
property path (`wdt:P171+`), which times out on Wikidata's public endpoint over
the full species set: fetch species in indexed pages, resolve parent taxa in bulk
`VALUES` batches until every ancestor is known, then assemble the nested tree.
The reasoning is in the module docstring.

**Note:** on a dataset you build, `/taxon/{name}` returns 404 for everything
until you run `scrape_taxon_info.py`. The API starts fine without it and the game
is fully playable — only the click-a-node popup is affected. The bundled example
is unaffected: its text ships with the package.

## Layout

```
src/taxoquiz/
  game/           Pure game logic — no framework, no I/O beyond loading the tree
    tree.py         Load the tree, flatten to leaf species
    seed.py         Shareable game seeds, and the dataset fingerprint in them
    pick_animal.py  Secret selection: random, daily, or from a shared seed
    list_animals.py Substring autocomplete
    game_state.py   Lineage index, LCA, pruning, the ??? reveal
  api/main.py     FastAPI layer over the above
  paths.py        Where data lives: bundled example vs generated
  data/                    Bundled example, committed and shipped in the package
    example_tree.json        The taxonomy played by default
    example_taxon_info.json  Its Wikipedia text, so popups work with no scrape

datagen/        Tools for building your own, bigger dataset. Not used by the game.
  scraper.py            Wikidata → tree of life
  extract_game_tree.py  That tree → one the game can actually load
  scrape_taxon_info.py  Wikipedia → summaries and images
data/           Datasets and scraper output. Gitignored, regenerable.
  README.md       What every generated file is — committed, unlike the rest
  <name>/         One dataset: tree.json (+ optional taxon_info.json)
  _cache/         Rebuildable scrape output. Safe to delete; never read at runtime.
frontend/       React 19 + TypeScript + MUI + react-d3-tree
```

Game logic is deliberately pure functions over the tree, kept separate from tree
loading so the API can cache the tree at startup and the same code backs both the
CLI and the web app.

## Attribution

Taxonomy and species data from [Wikidata](https://www.wikidata.org) (CC0).
Taxon summaries and images from [Wikipedia](https://en.wikipedia.org) via the
REST summary API. Both are fetched with an identifying User-Agent and a
deliberate delay between requests.

**`src/taxoquiz/data/example_taxon_info.json` contains article extracts from the
English Wikipedia**, bundled so the game is fully featured on install. That text
is licensed **[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**,
and every entry keeps its `wikipedia_url` and `wikipedia_title`, so each extract
points back at the article it came from. Redistributing it — which committing it
to this repo does — carries the same terms: attribution, and share-alike on the
text. Images are linked by URL from Wikimedia rather than copied in, and carry
their own individual licences.

The example taxonomy (`example_tree.json`) is not from Wikipedia — it is a
hand-curated NCBI-style tree — so none of the above applies to it.

The screenshots in `docs/images/` show the app displaying Wikipedia text and
Wikimedia images, which retain their own licences; the popup links to the source
article for each. Regenerate them with `docs/make-screenshots.sh`.

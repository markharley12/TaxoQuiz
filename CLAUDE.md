# TaxoQuiz

A phylogenetic animal guessing game built on real taxonomy scraped from Wikidata.

Dataset size is a tuning knob, not a fixed property: the bundled example is 530
species, and a full scrape reaches tens of thousands. See **Dataset** below —
getting this wrong is the single easiest way to be confused by this repo.

## What the Game Is

The player tries to guess a secret animal. After each guess, the game reveals how closely related the guessed animal is to the secret one by showing their lowest common ancestor in the tree of life. The closer the shared ancestor (lower in the tree), the warmer the guess. The player wins when they guess the exact animal.

There is also an **Explore** mode with the game taken out: no secret, no guesses,
just the taxonomy to open and read. It shares the tree and the colour scale with
the game but none of its logic — `src/taxoquiz/explore.py`, served under
`/explore`, rendered by `frontend/src/components/ExploreTree.tsx`.

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
  `game/` is the guessing game; `explore.py` is free browsing of the same tree
  and is a sibling of it, not part of it — it shares only the tree loader.
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

**The example ships fully featured** (Aug 2026). Both the example tree and its
taxon text live in the package, so a clone or a `pip install` plays *and* has
working taxon popups with no scrape and no network — verified by installing the
wheel into a clean venv and running from `/tmp`. `taxon_info_read_path()` falls
back to the packaged copy **only for the example dataset**: a custom dataset
reads its own file or shows nothing, because pairing one tree's text with
another's nodes is the exact mismatch datasets exist to prevent. Writes always
go to the dataset directory, never into the package, which would be site-packages
on an installed copy.

Note this means the repo now *redistributes* Wikipedia extracts (CC BY-SA) rather
than only fetching them at runtime — see the README's Attribution section, which
was expanded accordingly.

**Nothing is stored that the tree already determines** (Aug 2026). There used to
be a `taxon_list.json` per dataset holding the taxa to fetch, and `taxon_info.json`
stored each taxon's `rank`. Both were copies: the list is exactly "every node with
children" in `tree.json`, and rank is a field on those nodes. `get_ancestors()` and
`rank_of()` in `src/taxoquiz/game/tree.py` derive them, `scrape_taxon_info.py` reads the tree
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
invisible at a 500KB example, wasteful at a 51MB scrape. Nothing mutates the tree (`_prune`
builds fresh dicts), so one shared copy is safe.

| File | Description |
|---|---|
| `data/_cache/wikidata-species.json` | Flat map of Wikidata Q-ID → `{common_name, scientific_name, parent, sitelinks}`. ~41k species. |
| `data/_cache/wikidata-ancestors.json` | Flat map of Q-ID → ancestor node metadata fetched during tree construction. |
| `data/_cache/wikidata-tree-raw.json` | Nested tree rooted at Life, built from the above two files. ~57k nodes total. |
| `data/<name>/taxon_info.json` | Wikipedia text + image per **node** — internal taxa *and* species — keyed by the node's `name`, which for a species is its scientific name. Optional; only the popup reads it. |
| `src/taxoquiz/data/example_tree.json` | **The file the game actually loads** (`game/tree.py`). The bundled example: committed, 530 species, 1,609 nodes, max depth 18. |
| `src/taxoquiz/data/example_taxon_info.json` | The example's Wikipedia text, for taxa **and** species. Committed and shipped, so a clone or `pip install` has working popups. Unlike `example_tree.json` this one *is* regenerable — see below. |

### Regenerating the packaged example info

`scrape_taxon_info.py` writes to `data/<dataset>/taxon_info.json`, never into the
package (an installed package lives in site-packages and must not be written to).
So refreshing the shipped file is a copy:

```bash
mkdir -p data/example
cp src/taxoquiz/data/example_taxon_info.json data/example/taxon_info.json  # so it resumes
.venv/bin/python datagen/scrape_taxon_info.py            # fetches only what is missing
cp data/example/taxon_info.json src/taxoquiz/data/example_taxon_info.json
```

Seeding the copy first matters: without it the run re-fetches every entry that
is already there, which is thousands of needless requests to Wikipedia.

**Delete `data/example/` when you are done.** `taxon_info_read_path()` prefers a
dataset's own file over the packaged one, so a leftover staging copy silently
shadows what actually ships — the app reads the staging file, the wheel carries
the other, and they drift apart with nothing to say so.

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
`data/_cache/wikidata-tree-raw.json` today. Its Animalia subtree yields 18,421
playable species against the example's 530 (18,444 before the extractor collapses
genus/subgenus pairs that share a name).

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
(`COLOR_ANCHOR_PERCENTILE` in `src/taxoquiz/api/main.py`). Anchoring on the deepest lineage
sounds right and plays badly: in the scrape that is Human at 59 of 64, while the
median species sits at 26 — so scaled against 64 a median secret tops out
yellow-orange even when you guess its own genus, and over half of all games could
never look warm however well they were played. The percentile keeps the scale
absolute (same depth, same colour; nothing about the secret leaks) while letting
a typical game reach green. Example anchors at 15, the scrape at 43.

**Ranks resolve themselves** (fixed Aug 2026). Wikidata gives rank as a Q-ID;
`RANK_LABELS` covers the common dozen and `fetch_rank_labels()` looks up anything
else in one batched query at tree-build time. Previously an unrecognised rank fell
through as the raw Q-ID — 1,609 nodes across 37 ranks, including `tribe` at 772
nodes — and the popup displays rank, so it was visible. The query runs even with
warm caches, so re-running `scraper.py` repairs an existing scrape for one
request. Two entries also had a value-node hash stored as their rank Q-ID, because
the rank URI was parsed with a raw `split("/")` instead of `extract_qid`; fixed.

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

**wikidata-tree-raw.json node:** (note `name` is the *common* name here — the
schema is inverted relative to a dataset's `tree.json`; see the Dataset section)
```json
{ "name": "Gabon Coucal", "scientific_name": "Centropus anselli",
  "rank": "species", "qid": "Q1007166" }
```
The synthetic `Life` root is the one node with no `qid`, since it does not exist
in Wikidata — it is created only when the scrape yields disconnected roots.

## Game Logic (implemented — `src/taxoquiz/game/game_state.py`)

Note this diverges from the original sketch: the API returns an annotated **tree**
rather than a per-guess distance report.

- Tree loaded lazily on first use and cached by resolved path in `game/tree.py`,
  so all three game modules share one parsed copy (they each used to parse it
  separately — three copies of a multi-megabyte tree). Nothing mutates it: `_prune` builds
  fresh dicts
- **Every game has a seed** (`game/seed.py`), so any round can be handed to
  someone else. Daily is not a separate path: it is this mechanism with the body
  derived from the date, which is what makes today's game the same for everyone.
  Format `FFFF-BBBBBB`; `FFFF` fingerprints the dataset's species list so a seed
  from a 530-species example is **rejected** on an 18k scrape rather than
  silently resolving to a different animal. Alphabet excludes I/L/O/U so seeds
  survive being read aloud. Seeds are not secret and are not meant to be — the
  mapping is a hash over a public list; that is the price of needing no server
  state. (sitelinks weighting was never implemented — the example carries none)
- Each guess's LCA with the secret is found via lineage comparison; the LCA's
  **depth** is the score, returned as `lca_depth` and used for the frontend's
  colour gradient — red→green, or red→violet if the rainbow scale is chosen in
  the settings menu. Schemes live in `frontend/src/colors.ts` as a hue span and
  nothing else; the preference is front-end only, in `frontend/src/settings.ts`,
  and the API neither knows nor cares. Tree orientation (down/across) is a second
  setting in the same store, shared by the game and explore trees. The settings
  menu is the only control for it — explore used to carry its own toolbar
  toggle, removed once the menu covered all three modes
- Display tree is the union of guessed lineages, pruned to those paths, with
  single-child ancestor chains collapsed — see **Display decisions** for why the
  frontend then re-expands them into spacer rows
- A `???` node marks the child of the deepest reached LCA on the secret's
  lineage — reveals the branch, not the depth
- Win condition: guess matches the secret

## Taxon info covers species too

`taxon_info.json` holds an entry per **node**, not per internal taxon. Species
were excluded originally, which left the leaves — the things you actually guess —
as the only nodes you could not read about.

**Titles come from the Q-ID where the tree has one.** Wikidata's `wbgetentities`
answers 50 at a time with `props=sitelinks&sitefilter=enwiki`, so exact title
resolution costs about one extra request per fifty nodes — *cheaper* than
guessing titles, because it also removes the 404-then-retry every wrong guess
used to cost. Measured: 50 Q-IDs resolved in one 0.47 s request, 50/50 hit.

**But Q-ID cannot be the universal key.** Coverage is all-or-nothing by dataset:
the Wikidata scrape has one on 27,169/27,169 nodes, and `example_tree.json` has
none at all, because it is a hand-curated fixture. So the by-name path is not
legacy and must keep working.

**Where a name is used, species use the scientific one.** The tree's common names
are often a rank too general — "gazelle", "hamster", "right whale" — and fetching
those returns the article about the group. `Gazella gazella` redirects to
"Mountain gazelle"; `Mesocricetus auratus` to "Golden hamster". The common name is
the last fallback, not the first try.

**`rank` and `common_name` are not stored in `taxon_info.json`.** Both live in the
tree, which is the single source of truth; the API merges them onto the response.
A second copy is free to disagree with the tree it describes.

**`/game/state` nodes carry `name` as well as `label`.** They differ for guesses,
which display a common name while info is keyed by the scientific one — looking up
by label only ever worked because ancestors happen to have `label == name`. It is
`null` on the `???` node, which has nothing to look up; that is not a secrecy
measure and should not be read as one, since `/animal` returns the answer to the
client and `App.tsx` keeps it in `localStorage` to check the win without a round
trip.

## Display decisions

Three choices in the frontend that look arbitrary, are not, and would each be
easy to undo by accident. All three exist because they were wrong once.

**The colour scale is absolute, not relative.** `makeColorScale` in
`frontend/src/colors.ts` divides an LCA depth by an anchor taken
from `/dataset`. It used to normalise between the shallowest and deepest guess on
screen, which had two consequences: a set of equally-cold guesses rendered
mid-gradient olive rather than red (min == max fell back to t = 0.5), and a node
could change colour because of a *later* guess rather than anything about itself.
Do not normalise against the **secret's** depth, however tidy the warmth would
look — it leaks how deep the secret sits, which the `???` node exists to hide.

**Vertical distance encodes taxonomic depth, not tree level.** react-d3-tree
positions nodes by tree level, so with single-child chains collapsed every branch
cost one row regardless of the evolutionary distance it covered. On the example
tree (18 deep) that is nearly right; on the scrape (64 deep) it is badly wrong —
with secret = Human, a comb jelly branching at rank 1 and a chimpanzee branching
at rank 55 rendered one row apart, so the shape said they diverged at about the
same time while the colour said otherwise. `nodeToD3` now threads collapsed
chains onto unlabelled spacer nodes, `rowsForGap` rows per edge. **Spacing is
sqrt, not linear** — one row per rank is truthful but makes a 60-rank tree
~5000px tall; the square root keeps the ordering and fits on a screen.

**The MUI palette is pinned to light.** There is no CSS file in the project and
`GameTree` paints nodes on `#fff` with dark react-d3-tree links, so the app is
designed light. Without a `ThemeProvider` and `CssBaseline` nothing set a
background on `body`, and a dark-mode browser showed its own canvas through —
light-theme text on black, with a bright white autocomplete popup over it.
Supporting real dark mode means replacing the hardcoded colours in `GameTree`
first; pinning is deliberate, not an oversight.

**Explore mode fetches more than it shows, and the two budgets are separate
numbers.** `ExploreTree.tsx` fetches `SLICE_BUDGET` (200) nodes but seeds the
expanded set to `DISPLAY_BUDGET` (40). Conflating them gets both wrong: opening
the root with all 200 fetched nodes expanded produced a tree ~7000px tall whose
own root children were off-screen, and fetching only what is shown makes every
click a round trip. Fetching wide and showing narrow means the first screen
reads and the next several clicks cost nothing.

**A clade under `AUTO_EXPAND_SPECIES` (25) species opens whole on one click**,
rather than a level at a time — the level-by-level dance earns its keep on a
clade with hundreds beneath it, not on a genus of three. Two traps, both hit
while building it: a *truncated* node must never be added to the expanded set
(it renders no children, having none in memory, while losing the `+` that says
there is more — a dead end you cannot click out of, and half the nodes in a root
fetch are truncated), and a small clade with any truncation below it is
re-fetched whole first, or "expand all within" stops at the first gap.

**Taxon info is cached client-side in `taxonCache.ts`, and that cache is what
makes the pictures work.** Three things now want the same lookup — the popup,
explore's hover preview, and the thumbnail on the node box — and a node can only
show a thumbnail if something already knows its URL, so the cache is the feature
rather than an optimisation. Two details that matter: a 404 is cached as firmly
as a hit (~3% of nodes have no article, and they must not be re-asked on every
hover) while a transient failure is deliberately *not* cached, so a later hover
retries; and hovering is gated behind `HOVER_DELAY_MS` (350), without which
dragging the mouse across the tree fetches every node it crosses. Verified:
sweeping all 40 visible nodes fires zero requests.

Note what is and is not expensive here. `/taxon/{name}` is our own API reading an
in-memory dict; the only thing that leaves for Wikimedia is the image itself,
once an `<img>` points at it. So the reason not to prefetch everything is the
pictures, not the JSON.

**The server's `budget` is a node count spent breadth-first, not a depth.**
`explore._select`. Depth is the wrong knob on a real taxonomy — the Wikidata
tree opens with a single-child chain, so three levels from the root is nine
nodes while three levels from a bushy genus is hundreds. See `explore.py`.

**Explore's node component uses plain DOM and inline styles, not MUI `sx`.**
`NodeBox` in `ExploreTree.tsx` is the one component that can be on screen tens of
thousands of times, and `sx` runs emotion's style pipeline per node per render.
Everything else in the app should keep using `sx`; this is a local exception with
a measured reason, not a style preference.

**Rendering the whole tree at once works and is unusable.** Measured against the
27,169-node Wikidata scrape: ~180 s to first render, 15.4 s of frozen main thread
per drag afterwards, and Chrome unable to screenshot the page at all. At 1,996
nodes it is 4.7 s and 120 ms — janky but fine. Hence `EXPAND_ALL_WARN = 2000`,
which is a measurement, not a guess. The button is deliberately kept rather than
removed: "what if I render everything?" is a fair question and the app should be
able to answer it. Re-measure before changing that constant.

**Jump-centring reads coordinates back out of the DOM.** The effect keyed on
`focusName` finds `[data-node="…"]`, reads its `<g transform>`, and translates
the view. A node's x follows from its depth, but its y falls out of the whole
layout's leaf ordering, which only react-d3-tree knows — computing it would mean
reimplementing the library. Without this, jumping to Homo sapiens expanded the
right lineage and left you looking at Animalia, 59 levels away.

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

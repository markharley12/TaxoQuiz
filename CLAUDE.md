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

`tests/` covers `datagen/`, the game, the API and explore — 190 tests, ~1.4s, no
network. Run with `.venv/bin/python -m pytest tests/ -q` (`pip install -e ".[test]"`
for pytest and httpx2, which FastAPI's `TestClient` drives the app through).
The `test` extra also pulls in `datagen`, because the scraper tests import
`datagen/scraper.py` and so need `requests` — without it pytest aborts
*collection* and runs none of the other 170 either. That is not a game
dependency: `pip install -e .` is still fastapi and uvicorn alone.

The frontend has its own suite now — 168 tests, ~3s, `npm test` in `frontend/`
(Vitest on jsdom, with React Testing Library). It covers the pure modules:
`colors`, `framing`, `settings`, `media`, `taxonCache`, plus `gameLayout` and
`exploreLayout` — see **Display decisions**, every one of which was wrong once.
Each test names the failure it guards rather than restating the code, and the
suite was checked by mutation: reverting the clamp, the EDGE inset, the sqrt
spacing, the truncation skip and the joined `name` each turns the matching test
red.

`App.test.tsx` covers the **round** — starting one, guessing, winning, giving
up, and surviving a reload — and it is about behaviour a player would notice
rather than markup. Both tree components and `GuessInput` are stubbed there:
the trees render react-d3-tree, which measures SVG that jsdom does not lay out,
and driving an MUI Autocomplete through the DOM would be a test of MUI. Note
the test glob is `src/**/*.test.{ts,tsx}` — before the `tsx`, a component test
did not fail, it simply never ran.

What is still **eyes-only** is anything about how the trees look on a screen.
The pure layout behind them is covered; the drawing is not.

**Both suites run in CI** (`.github/workflows/ci.yml`, Sep 2026) on every push to
master and every PR: pytest on 3.10 and 3.14 (the floor `pyproject.toml` declares
and the version developed on), and the frontend's lint, typecheck, tests and
build. A third job builds the wheel and asserts `taxoquiz/data/example_*.json`
are inside it — that is the `.gitignore` anchoring trap from **Dataset** below,
which broke silently once and is invisible until someone installs the wheel.

It found something on its first run, which is the argument for having it: the
suite passed on this machine and aborted on a clean one, because a developer
venv had `requests` from a datagen install and the documented
`pip install -e ".[test]"` did not. Note the conftest fixtures could not have
caught this — they make the *tests* independent of the machine, and this was
the *environment* depending on it.

Two things make the Python suite hermetic, both in `tests/conftest.py` and both
autouse, because a test that forgets either passes for the wrong reason:

- **Six per-dataset caches get cleared around every test** — `tree._cache`,
  `game_state._indexes`, `pick_animal._species`, `list_animals._species`,
  `explore._indexes`, `api.main._dataset_data_cache`. They key on the dataset
  *name*, so two tests writing different trees as `tmp` would otherwise share
  the first one's.
- **`$TAXOQUIZ_DATA_DIR` points at an empty tmp dir.** `data_dir()` is
  CWD-relative, so without this `available_datasets()`, `/datasets` and the
  picker's contents depend on which scrapes the developer happens to have on
  disk — passing here and failing in CI. Every test starts from "the example and
  nothing else"; the example survives because it is read from the package via
  `importlib.resources`, which is the same property that makes a fresh clone
  playable.

`scraper.sparql` remains the single network seam for the datagen tests, and
every one of them replaces it.

Two behaviours are pinned by tests as *rough edges* rather than as intent, so
they read as decisions if you meet them cold: `get_game_state(secret, [])`
returns `None` (`null` over HTTP) because the union of no lineages prunes the
root away — the frontend never asks, guarding on `guesses.length > 0` — and
`seed.normalise` checks only length, so "not a seed at all" strips to ten valid
characters and is caught by the dataset fingerprint rather than by the parser.

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
`data/_cache/wikidata-tree-raw.json` today. At `MIN_SITELINKS=6` its Animalia
subtree yields 41,167 playable species against the example's 530.

**`datagen/extract_game_tree.py` bridges the two** (added Aug 2026 — before it,
there was no committed way to play on scraped data at all). Raw scraper output is
not loadable, for three separate reasons, all of which fail quietly or confusingly:

1. It is rooted at `Life`; the game wants a kingdom.
2. **The schema is inverted, at every node and not only the leaves.** The scrape
   puts the English name in `name` and the taxon name in `scientific_name`; the
   game wants `name` to be the taxon name with the English one in `common_name`.
   Raw output raises `KeyError: 'common_name'`. Inverting the species alone is
   not enough, and looked like it was for a month — see **Wikidata labels a
   famous clade in English** below.
3. **Names are not unique.** A default Animalia scrape has ~1,100 duplicate common
   names ("Cichlid" covers 38 species) plus 63 duplicate *node* names from real
   homonyms (Gnathostomata is both a vertebrate clade and a sea-urchin
   superfamily), genus nodes mislabelled with a binomial, and genus/subgenus pairs
   sharing a name. The game keys its depth index on the name, so every one of
   these silently corrupts play. The script collapses, qualifies and finally
   number-suffixes until unique, and refuses to write if any remain.

Measured on the current scrape: 41,167 species, **80 levels deep against the
example's 18** — which is why the frontend read its depth scale from `/dataset`
rather than a constant, back when depth was what it drew with. The gap between
those two numbers is also most of the reason it no longer is.

**Colour comes from the LCA's rank, not its depth** (Sep 2026, `src/taxoquiz/ranks.py`).
Every node in both trees carries a `warmth` in 0..1 read off a Linnaean ladder —
kingdom 0.00, phylum 0.17, class 0.33, order 0.50, family 0.67, genus 0.83,
species 1.00 — and a guess carries `lca_warmth`, the rank of its LCA with the
secret. There is **no per-dataset anchor any more**: `COLOR_ANCHOR_PERCENTILE`
and `/dataset`'s `color_anchor_depth` are gone, because a genus is a genus in a
530-species example and in a 41,167-species scrape alike.

The scale used to divide an LCA's *depth* by a high percentile of species depth
(15 for the example, 68 for the scrape). That was absolute *within* a dataset,
which was the right instinct, but it could not be absolute across one, because
**depth is not comparable between lineages** — a fish at 16 and a bird at 65 are
each a whole species' worth of history. Measured on the scrape before the change:

- a guess in the secret's own **family** scored anywhere from **0.10 to 1.00**
  depending which branch it sat in — the same taxonomic fact, painted anywhere
  from red to green;
- a **winning** guess, which scored the secret's own depth, had a median of
  **0.49** (olive), so over half of all games could never look warm however well
  they were played, and only 26% could reach 0.9 at all.

Rank fixes both, and the second one completely: a correct guess has the secret
itself as the LCA, so it is a species-level match and reaches 1.0 in every game.

Three details that are load-bearing:

- **Unranked clades are interpolated, not floored.** They are 17-24% of the LCAs
  between two random species — not a rounding error, because the few that exist
  sit high in the tree where random lineages meet. `rank_levels` places each
  between its nearest ranked ancestor and the **broadest** ranked descendant, by
  how many steps it sits from each, so a chain of clades fans out evenly instead
  of piling up. Broadest rather than nearest, so a clade is never warmer than the
  coldest thing beneath it.
- **The `???` node takes its parent's warmth, not its own rank's.** Its own rank
  is usually Species, i.e. 1.0, so it would render greener than the closest real
  guess — reading as a node you had *found* — and would say "the answer is
  exactly one rung below this". Its parent's warmth is already on screen on the
  parent, so this reveals nothing new. See `_prune`.
- **Still not normalised against the secret's own rank or depth**, however tidy
  the warmth would look. That is the one answer ruled out: it leaks what the
  `???` node exists to hide.

This depends on the dataset's ranks being trustworthy, which they were not until
the `RANK_LABELS` fix below — reading rank as a position in the hierarchy is
exactly what a mislabelled rank breaks.

**Wikidata labels a famous clade in English, and that is not its name** (fixed
Sep 2026). `rdfs:label` for Q7377 is "mammal", for Q5113 "bird", Q1390 "insect",
Q7380 "primate", Q1360 "arthropod" — and Q729, the root of every Animalia scrape,
is "animal". The scientific name is a separate property, P225.
`fetch_nodes_batch` fetched both and then collapsed them into one field with the
label winning, so P225 was requested on every ancestor and stored on none. The
tree ended up naming its most recognisable clades in English and holding no
record of the Latin, which is the one thing a taxonomy is for — 487 internal
nodes in the current scrape.

Both are stored now, and *which one is displayed is not the scraper's decision*:
the raw tree records what Wikidata says (English in `name`, taxon name in
`scientific_name`, the same shape as a species) and `extract_game_tree.py`
inverts it, for internal nodes exactly as it already did for leaves. The
vernacular survives as the node's `common_name`, which is a gain rather than a
tidy-up: `common_name_of()` and explore's search already read it wherever it
appears, so "bird" now finds Aves.

Two consequences worth keeping in mind:

- **`find_taxon` matches either name**, because `--taxon Animalia` has to find a
  node the scrape calls "animal".
- **An ancestor cache from before the fix cannot be repaired by inspection** — a
  lone label cannot say whether it is "Mammalia" or "mammal" — so entries with no
  `sci` key are refetched. That is one pass over the ancestors (22,370 nodes, 56
  batches, about four minutes), cheap beside stage 1, and it repairs an existing
  scrape in place. `main()` must write the cache when a repair happens: a repair
  rewrites entries without adding any, so the `len(ancestors) != before` guard
  alone would refetch the same nodes on every run and save the result on none.

**Rank casing is normalised in `extract_game_tree.title_rank`.** The example
fixture is uniformly title case (Species, Genus, Family) while Wikidata's rank
labels arrive lowercase, and the leaf rank was hardcoded `"Species"` — so a
scraped dataset showed "Species" on a leaf and "genus" on its parent, both on
screen at once in the popup. Capitalise the first letter only; `.title()` is
wrong for the multi-word tail of ranks ("species group", not "Species Group").

**Ranks resolve themselves** (fixed Aug 2026). Wikidata gives rank as a Q-ID and
`fetch_rank_labels()` looks every one up in a single batched query at tree-build
time. Previously an unrecognised rank fell through as the raw Q-ID — 1,609 nodes
across 37 ranks, including `tribe` at 772 nodes — and the popup displays rank, so
it was visible. The query runs even with warm caches, so re-running `scraper.py`
repairs an existing scrape for one request. Two entries also had a value-node hash
stored as their rank Q-ID, because the rank URI was parsed with a raw `split("/")`
instead of `extract_qid`; fixed.

**The hardcoded rank map is gone, and 15 of its 23 entries were wrong** (Sep
2026). `RANK_LABELS` sat in front of that lookup as a "no query needed for the
common dozen" shortcut, and because it was consulted *first* it shadowed the
authoritative answer wherever it had an entry — so its wrong answers always won.
Only the eight ranks anyone can recite were right (species, kingdom, phylum,
class, order, family, genus, clade). The rest pointed at unrelated Q-IDs, some
not taxonomic at all: `Q1054074` ("superorder") is a Fiat 600 Multipla,
`Q2361108` ("cohort") is a place in Sweden, `Q7506714` ("superclass") is the
Siam area.

Measured on the Sep 2026 scrape, resolving every rank properly moves 355 beetle
superfamilies out of `Subkingdom` (356 → 2), 1,000-odd subfamilies out of
`Infraorder` (1,051 → 87), and takes `Superfamily` from 48 to 354. It is visible
in the popup, which displays rank, and it is *structural* for anything that reads
rank as a position in the hierarchy: the share of parent→child edges where the
child's rank is broader than its parent's falls from **2.65% to 0.13%**. The
example fixture was always at 0%, being hand-curated, which is why nothing caught
this.

The lesson generalises past the table: a hand-written lookup in front of a
correct one is a liability, and `fetch_rank_labels()` costs one request for ~53
ranks whatever the tree size. Rebuilding is how an existing scrape is repaired —
species counts are unaffected (41,167 before and after), so only the rank strings
move.

### Sizing a scrape

`scraper.py` filters species by `MIN_SITELINKS` (top of the file) — the number of
Wikipedia language editions with an article, used as a fame/significance score.
Measured counts across all life:

| `MIN_SITELINKS` | Species |
| ---: | ---: |
| 6 | 63,712 |
| 10 *(default)* | 41,143 |
| 20 | 17,809 |
| 30 | 6,186 |
| 50 | 1,486 |
| 75 | 508 |

Higher threshold = smaller, more famous, more guessable set.

**Lowering the threshold fetches only the band it adds.** A species' sitelink
count does not depend on the query, so the set at one threshold is a strict
subset of the set at any lower one — verified against Wikidata: `>=10` (41,648)
plus `[6,10)` (22,064) is exactly `>=6` (63,712). `fetch_plan(have, want)`
decides between a full fetch, a band, and nothing; `cache_threshold(species)`
reads what a cache represents off the data rather than storing it alongside,
where it could drift. While this was being added the threshold turned out to be
doing nothing at all: `main()` handed the whole cache to `build_tree` unfiltered,
so with a cache present `MIN_SITELINKS` changed neither direction, and both
READMEs described the working version as a feature. `at_threshold()` is what
makes it mean something.

**`datagen/seed_taxon_info.py` copies one dataset's `taxon_info.json` into
another**, guarded on Q-ID so a name that has come to mean a different taxon is
refetched rather than inheriting the old article. Since `scrape_taxon_info.py`
fetches only names it lacks, this is what keeps the Wikipedia stage small when a
dataset is rebuilt — seeding the Sep 2026 rebuild from its predecessor left 569
nodes to fetch out of 57,051, minutes instead of an hour. Note it matches on
*name*, so the nodes renamed from vernacular to Latin were among the 569.

**`datagen/SCALING.md`** holds the timing and cost measurements for all of this,
including one that was confounded and had to be redone. Consult it before
predicting how long a stage will take: taxon info was predicted at 24 minutes and
took 63.

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

**wikidata-tree-raw.json node:** (note `name` is the *English* name here — the
schema is inverted relative to a dataset's `tree.json`; see the Dataset section)
```json
{ "name": "Gabon Coucal", "scientific_name": "Centropus anselli",
  "rank": "species", "qid": "Q1007166" }
```
Internal nodes carry the same two fields, and for a famous clade they differ:
`{ "name": "mammal", "scientific_name": "Mammalia", "rank": "class",
"qid": "Q7377" }`. Where Wikidata's label is already the taxon name, which is the
usual case, the two are the same string.
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
  **rank** is the score, returned as `lca_warmth` (0..1, off the ladder in
  `taxoquiz/ranks.py`) and used for the frontend's colour gradient. `lca_depth`
  is still returned beside it, but nothing draws with it any more — see
  **Colour comes from the LCA's rank** above for why depth could not do this
  job — red→green, or red→violet if the rainbow scale is chosen in
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
- **Giving up is client-side** (Sep 2026). A round ends two ways and only one is
  a win; `revealed` in `App.tsx` is the other. It needs no API call and no new
  node type, because `/animal` already hands the client the secret and
  `localStorage` already holds it — the same property that lets the win be
  checked without a round trip. The `???` node stays as it is: replacing it with
  the answer would need a node type the API does not have, and the banner says
  the same thing without ever letting `???` pretend it was found. `revealed` is
  persisted with the session, or a reload would hand the round back with its
  answer already spent

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
the Wikidata scrape has one on every node (57,051/57,051), and `example_tree.json` has
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
`frontend/src/colors.ts` takes a `warmth` in 0..1 straight from the API and turns
it into a colour; it takes no anchor and no dataset. It used to normalise between
the shallowest and deepest guess on screen, which had two consequences: a set of
equally-cold guesses rendered mid-gradient olive rather than red (min == max fell
back to t = 0.5), and a node could change colour because of a *later* guess
rather than anything about itself. It then spent a while dividing an LCA depth by
a per-dataset anchor, which fixed both and introduced a third — see **Colour
comes from the LCA's rank** above. Do not normalise against the **secret's** rank
or depth, however tidy the warmth would look: it leaks where the secret sits,
which the `???` node exists to hide.

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

**The look lives in `frontend/src/theme.ts`, and there is still no CSS file.**
Everything — palette, type scale, component defaults — is one MUI theme, so a
change lands everywhere rather than in whichever component someone remembered.
The design is a field guide rather than a dashboard: warm paper (`PAPER`),
ink (`INK`), a serif for the names and a sans for the controls. A taxonomy is
mostly *words*, and they were previously all set in the browser's fallback
Helvetica at one weight, which is most of why the app read as a form.

**The accent is blue, and must not be green or red.** Depth is encoded as a
red→green ramp across every node in both trees, and that ramp is the only thing
on screen carrying meaning. An accent anywhere inside it reads as a score. Ink
blue sits outside the ramp entirely.

**Fonts are bundled, not fetched.** `@fontsource` ships the woff2 into the
build, so the app looks like itself with no network — the same property the
packaged example dataset exists for. The build emits every subset and that is
not waste: `unicode-range` means a reader of Latin text downloads the Latin file
alone, ~85KB for the pair rather than the 250KB the build listing implies.

**The ramp's lightness is a function of its hue** (`ramp` in `colors.ts`), which
is what stops it looking like raw HSL. At a fixed lightness yellow reads far
brighter than red or green, so a red→green sweep held at 70%/35% went acid at
the ends and mustard through the middle — which is where most of a game's nodes
actually sit. Darkening around 60° turns that middle into moss and the ends into
brick and forest. Nothing about the *scale* changed: same `t`, same hue span,
same clamp, so a given depth is still always the same colour.

**Saturation is a function of depth, and it is the second channel rather than
decoration** (Sep 2026). An absolute scale is right for the reasons above, but it
has a consequence that only shows up on screen: *any one view spans a narrow band
of depths*, so every screen is close to monochrome. Measured on the example, a
game four guesses in used **32° of the 120 available** — seven nodes, every one a
green — and explore's opening screen used **16°**, every one a brick red. Hue
alone therefore separates almost nothing *within* a view, which is the only place
anyone reads it. So saturation rises with `t`: shallow is faded, deep is vivid,
the closest guess is the most saturated thing on the page. Still absolute, still
leaks nothing, and it moves where hue barely does.

**Nodes are drawn by what they are, and both trees agree. The amount of colour
a node gets is the hierarchy** (Sep 2026):

| | Treatment |
|---|---|
| Guess | **Filled** with its colour, white text — the loudest thing in the tree |
| On-path clade / explore clade | Card, ink text, a **5px spine** of its colour, `makeTintScale` wash |
| Species (explore) | Card with a coloured edge |
| Off-path context | Quiet outline, no colour at all |
| `???` | Dashed, over the same wash as an on-path clade |

**This was the other way round until Sep 2026, and that was backwards.** Clades
were filled with the scale — 200×56 of solid colour per node — so the least
actionable number on screen was also the loudest, and a game four guesses in read
as a wall of green boxes rather than as a tree. Explore was worse: its opening
screen is Animalia plus two ranks, i.e. 16° of hue over thirty-odd nodes, so it
came out as one flat brick field with the names in small white type on top of it.
Meanwhile the *guesses* — the only nodes whose colour a player is ever asked to
compare — were the quietest things on the page.

The spine keeps the depth reading exactly (same scale, same colour) while giving
the ink back to the words, which is what a taxonomy is. `makeTintScale` is now a
pale wash for those cards rather than "the fill, a step lighter". The fill moved
to the guesses, where there are four or five against a quiet tree instead of
twenty — **the count is what makes a fill work there and not here.** The `???`
node stays dashed, because as a solid block it read as a node you had *found*,
which is the one thing it is not; it takes the wash because it sits on the path,
and left transparent it was the faintest thing on a screen it ought to anchor.

**Names are capitalised at the point they are drawn, and nowhere else**
(Sep 2026). Datasets store vernacular names lower case — "blue whale", "african
wild dog" — because that is Wikidata's label and a scrape should record what the
source says. `displayName` in `frontend/src/names.ts` upper-cases the first
letter only: sentence case is the zoological convention, and CSS
`text-transform: capitalize` gives "Blue Whale" and mangles "lions mane
jellyfish".

**Display only, and that is load-bearing.** The API matches a guess exactly and
answers `Unknown animal: 'Lion'` for a name it holds as `lion`. Autocomplete
*is* case-insensitive, so a capitalised name reaches the list and then fails at
the guess — worse than never capitalising at all. So the raw name stays the
value wherever it is a key: `data-node`, the submitted guess, the win
comparison, the taxon cache. In the Autocomplete this is `getOptionLabel`, which
changes what is shown without touching the option's value.

**Vertical distance is the tree's meaning; horizontal distance is just cost**
(Sep 2026). The game's boxes and every gap around them came down — a generation
cost 240px with a mouse and 250 on a phone, so a 390px screen could not show a
parent and a child in full, and you panned to read a tree whose whole point is
its shape. Across is the phone default precisely because generations run along
the axis you have least of, which is what makes the pitch worth spending on.
Explore gave up its connector gap but *not* its box width: it exists to read a
taxonomy, its box already spends most of itself on chrome, and a narrower one
buys a column by ellipsising the names that are the point.

**`framing.ts` places a tree by its content, per axis.** react-d3-tree pins the
root wherever it is told, which is right while the tree is bigger than the view
and wrong the rest of the time: a three-level explore slice sat in the top third
of a 900px canvas, and a game tree centred on its root ran off the left edge,
because a root is only in the middle of its subtree when that subtree is
symmetrical. Centre the content when it fits an axis, keep the pin when it does
not. Skipped above `FRAME_NODE_LIMIT` (`getBBox` walks the subtree, and a tree
that size does not fit anyway) and skipped on coarse pointers, where `fitWidth`
has already sized the box so root-plus-one-column exactly fills the view.

**Dark mode is still unsupported, and pinning is deliberate.** Both trees assume
a light ground — the link colour, the card fills, the leaf outlines. Without a
`ThemeProvider` and `CssBaseline` nothing set a background on `body` at all, and
a dark-mode browser showed its own canvas through: light text on black with a
bright white autocomplete over it. Real dark mode means giving the trees a
second palette, not flipping the `mode` flag.

**Explore mode fetches more than it shows, and the two budgets are separate
numbers.** Explore fetches `SLICE_BUDGET` (200) nodes but seeds the expanded set
to the node size's own `show` (40 with a mouse, 14 on a phone — a phone shows
fewer because it has room for fewer). Conflating them gets both wrong: opening
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
makes the pictures work.** Both trees now want the same lookup — the popup, the
hover preview, and the thumbnail on the node box — and a node can only
show a thumbnail if something already knows its URL, so the cache is the feature
rather than an optimisation.

**It is keyed on dataset *and* name, and that is load-bearing.** 1,047 names
appear in both the example and wikidata datasets; 86% of them have a different
description and 68% a different picture — Animalia is 923 characters in the
example set and 3,369 in the scrape, with a different image. Keyed on name
alone, switching dataset would quietly serve the other one's article for a name
you had already looked at. This is exactly the seam where the dataset-picker
branch met the cache, and it is why the two could not simply be merged
textually.

Two more details that matter: a 404 is cached as firmly
as a hit (~3% of nodes have no article, and they must not be re-asked on every
hover) while a transient failure is deliberately *not* cached, so a later hover
retries; and hovering is gated behind `HOVER_DELAY_MS` (350), without which
dragging the mouse across the tree fetches every node it crosses. Verified:
sweeping all 40 visible nodes fires zero requests.

**Hover previews are mouse-only, on purpose.** A tap synthesises
`pointerenter` but nothing ever synthesises the matching leave, so on a phone
the card appeared and then sat there until you tapped something else. The
handler checks `pointerType`. Touch users reach the same picture by tapping
through to the popup, which fills the same cache and so leaves the thumbnail on
the node exactly as a hover would — that, not the hover, is the path that has to
work on a phone. When testing this, note that React implements `onPointerEnter`
via delegated `pointerover`: dispatching a synthetic `pointerenter` reaches
nothing and gives a green result for the wrong reason.

**A node's size under a fingertip is its CSS size times the tree's zoom, and
forgetting that is what made the phone unusable** (fixed Sep 2026). Both trees
draw nodes in a `foreignObject` inside an SVG that react-d3-tree scales, so
explore's 170×38 box at `zoom 0.8` reached the screen as 136×30, its info button
as **12×12**, and the `+` as 6×16 with its centre **12px from the info
button's**. Against a ~44px fingertip those two are one target: tapping `+` to
open a clade opened its article instead — and the article, the only route to a
picture without a mouse, was itself that 12px dot. Both reported symptoms ("can't
hit the plus", "hard to get pics up") were this single cause.

`frontend/src/media.ts` answers *"is this a finger?"* (`useCoarsePointer`, on
`pointer: coarse`) rather than *"is the screen small?"* — a touch laptop is both
coarse and wide. `NODE_SIZES` in `ExploreTree.tsx` and `BOX_SIZES` in
`GameTree.tsx` carry a fine and a coarse row; spacing is **derived** from the box
(`spacingFor`, `gameSpacing`) so a taller box cannot overlap its own siblings,
and the fine numbers reproduce the previous constants exactly. Measured after:
box 173×56, info 38×52, the two controls 139px apart, on a 390px phone.

Four decisions inside that, each of which looks arbitrary and is not:

- **Info sits at the far left and `+` at the far right.** Not symmetry — it is
  the fix. They were neighbours, so a miss did the other thing. Now most of the
  box lies between them, and since the box itself toggles, *every* miss lands on
  "expand", which is both the commoner intent and the one a second tap undoes.
- **`+` is deliberately not sized as a touch target.** The whole box toggles, so
  it is a sign saying "there is more below", not something to hit. Only the info
  button has to be aimed at, being the one small control competing with the box.
  Keeping `+` narrow buys back label width.
- **The coarse box width is measured, not assumed** (`fitWidth`). A phone must
  show a parent *and a whole child column*, or the `+` at the child's right edge
  is past the view and the node reads as a dead end. The budget is the
  container, not the viewport — the app's own padding took a 390px phone down to
  364, which clipped every child while the arithmetic said it fit — and the
  root's `EDGE` inset counts too, which clipped them again after the first fix.
  A `ResizeObserver` re-fits on rotation, and it is keyed on `hasTree`, not `[]`:
  before the tree loads the component renders a spinner and the ref is null, so
  a mount-only effect measured nothing.
- **`seedExpanded` opens exactly one level on a phone** (`maxLevels`). Two
  columns fit, so a third generation is off-screen — and a node whose children
  are *all* off-screen renders with no `+` (it is open) and nothing visible
  below it, which reads as a dead end rather than as "pan right".

**Down is the wrong default on a phone; Across is right.** The difference is
which axis siblings run along. Down puts them side by side, so a 390px screen
shows two and gives all the room to generations you can only walk one at a time.
Across stacks them vertically: a phone shows a dozen of the choices it is
actually choosing between, and scrolls through them the way it scrolls
everything. Only the *default* moves (`settings.ts`), and a saved choice still
wins.

**The game view follows the newest guess.** The tree grows away from its root,
so pinning the root is right for an empty tree and wrong from the first guess
on: four guesses in, a phone showed `Animalia` and nothing else, with every
guess 500–1500px further along. `GameTree` re-centres on the guess just made,
but only when it is actually outside the view — on a desktop the whole tree
usually fits, and yanking a view the reader is looking at is worse than not
moving it. **The retry loop is load-bearing, not defensive:** react-d3-tree lays
its nodes out in its own commit, so on the commit where `treeData` arrives the
node is not in the DOM, a single lookup finds nothing, and the effect never runs
again because its deps have not changed. That failure looks exactly like an
effect that fired and decided to do nothing — which is how it was written the
first time, and why it silently did nothing.

**`touch-action: none` and `dvh` on both tree containers.** The tree pans
itself, so the browser must not also try to scroll the page from a drag starting
there, or the two fight and neither happens. And `vh` on a phone is the height
with the browser's toolbars *hidden*, so a `vh`-sized box overflows the screen
whenever they show — which is what left 24px of page scroll behind the tree.

**The pure layout logic lives beside the components, not inside them.**
`frontend/src/gameLayout.ts` (compress, `rowsForGap`, `nodeToD3`, `BOX_SIZES`)
and `frontend/src/exploreLayout.ts` (`fitWidth`, `seedExpanded`,
`addLoadedNames`, `NODE_SIZES`, the budgets) were lifted out of the two `.tsx`
files verbatim. The reason is testability and it is not merely stylistic: the
eslint config runs `react-refresh/only-export-components`, so a `.tsx` file
cannot export a non-component for a test to import. Anything pure that wants a
test has to move to a `.ts` module — as `colors`, `framing` and `media` already
had.

`components/HoverPreview.tsx` holds the hook, the card and the thumbnail, shared
by both trees rather than copied into each. On the game tree the picture is the
**first** name in a compressed node's `taxa`, which is joined deepest-first and
so is both the most specific taxon and the one the label leads with. The `???`
node carries no `taxa` at all, so it never looks anything up — the same property
that makes it unclickable is what stops it leaking the answer through a picture.

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

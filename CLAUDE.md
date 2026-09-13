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

`./start.sh` runs the API and frontend together — but the frontend no longer
needs the API to play the example. It carries a TypeScript port of the game
(`frontend/src/engine/`) and runs on static files alone. That one build is both
**the website**, live at <https://markharley12.github.io/TaxoQuiz/>, and **the
Android app** — see the two sections of those names below. See **The engine runs twice** below before changing any game
logic: the rules now exist in two languages and are held together by a test.

`tests/` covers `datagen/`, the game, the API, explore and **the shipped data
itself** — 250 tests, ~1.7s, no network. Run with
`.venv/bin/python -m pytest tests/ -q` (`pip install -e ".[test]"` for pytest and
httpx2, which FastAPI's `TestClient` drives the app through). The `test` extra
also pulls in `datagen`, because the scraper tests import `datagen/scraper.py`
and so need `requests` — without it pytest aborts *collection* and runs none of
the others either. That is not a game dependency: `pip install -e .` is still
fastapi and uvicorn alone.

`tests/test_dataset_integrity.py` is the odd one out and deliberately so: every
other test checks code against a fixture it wrote, which is why both of this
repo's data bugs got past the suite. It runs `datagen/validate_dataset.py` over
the example the game actually ships with — see **Validating a dataset**.

The frontend has its own suite now — 273 tests, ~3s, `npm test` in `frontend/`
(Vitest on jsdom, with React Testing Library). It covers the pure modules:
`colors`, `framing`, `settings`, `media`, `taxonCache`, `guessRow`, plus
`gameLayout` and `exploreLayout` — see **Display decisions**, every one of which
was wrong once. 79 of the 273 are `engine/conformance.test.ts` and 10 are
`api.test.ts`; see **The engine runs twice**.
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
A fourth job builds the Android debug APK and keeps it as a 30-day artifact —
the Android build had already broken lint once with CI none the wiser. The
actions are on their v7 majors, since v4 targeted the deprecated Node 20, and
`.github/dependabot.yml` opens grouped monthly PRs for actions, npm and pip.
**CI installs npm 11 before `npm ci`**, in every job that runs it: the lockfile
is written by npm 11 here, and Node 22's bundled npm 10 rejected one it wrote
(`yaml@1.10.3 does not satisfy yaml@2.9.1`) — which failed every frontend job
and blocked a Pages deploy. Reproduced by running `npm ci` on a copy of the
two files with each npm. Regenerating the lockfile with npm 10 instead would
only last until the next `npm install` here.

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
- `frontend/` — the GUI. `src/engine/` inside it is a TypeScript port of
  `game/`, `explore.py` and `ranks.py`, so the app can play the example with no
  server. It reads the example from `src/taxoquiz/data/` in place rather than
  keeping a copy.

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
| `src/taxoquiz/data/example_tree.json` | **The file the game actually loads** (`game/tree.py`). The bundled example: committed, 530 species, 1,615 nodes, max depth 21. |
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

### The clade layer above the phyla (Sep 2026)

The example used to go **Animalia → Phylum with nothing between**, so any two
species in different phyla met at the kingdom. A human and a starfish scored
*exactly* what a human and a sea sponge did, though the first pair are both
deuterostomes and the second splits at the base of the animals — the game's
whole subject rendered flat. Compare Metazooa, which joins human and starfish at
Deuterostomia; that is the shape people expect, and it is also the correct one.

Six clades were inserted between the kingdom and the phyla, taking their names
and topology from the Wikidata scrape so the two datasets agree about the same
taxa:

```
Animalia
├── Porifera                      (sponges split first, and that must stay visible)
└── Eumetazoa
    ├── Cnidaria
    └── Bilateria
        ├── Deuterostomia → Chordata, Echinodermata
        └── Protostomia
            ├── Ecdysozoa → Arthropoda, Nematoda, Tardigrada
            └── Spiralia  → Mollusca, Annelida, Platyhelminthes
```

Three decisions inside that:

- **Only clades that actually branch here.** The scrape also has Parahoxozoa and
  Ambulacraria, but with no Placozoa and no Hemichordata among the 530 they
  would be single-child pass-throughs — collapsed on display and never anyone's
  LCA, so they would add a name to read and no information.
- **Rank is `Clade`, not what Wikidata calls them.** The scrape has
  Deuterostomia as a *suborder* and Bilateria as a *subkingdom*, which on
  `taxoquiz/ranks.py` are levels 3.3 and 0.3 — a human-and-starfish guess would
  come out warmer than a shared family. Unranked is the honest answer, and
  `rank_levels` interpolates the chain evenly between the kingdom above and the
  phyla below: Eumetazoa 0.04, Bilateria 0.08, Deuterostomia 0.13, against
  Chordata's 0.17. This is precisely the case that interpolation exists for.
  The scrape's own ranks here were wrong in both directions —
  `wikidata-2026-09` has Deuterostomia as a suborder (0.55), `wikidata-ranks-fixed`
  as a superphylum — which is what prompted the belief check below; both now
  score a human-and-starfish guess at 0.33 and 0.13 respectively, in the right
  order either way.
- **Existing seeds still work.** The seed fingerprint is over the *species*
  list, and only internal nodes were added.

The numbers in the file table above moved with it: 1,609 nodes → 1,615, max
depth 18 → 21 (everything under Chordata gained three levels), and six tests
that pinned those figures were updated. `example_taxon_info.json` was regenerated by the
procedure above to cover the six new nodes, so their popups read.

### Validating a dataset — and why this was needed

`datagen/validate_dataset.py` answers "is this tree fit to play on?" for any
dataset. Run it after a build and before trusting one:

```bash
python3 datagen/validate_dataset.py                     # the selected dataset
python3 datagen/validate_dataset.py --dataset wikidata-2026-09
python3 datagen/validate_dataset.py --all
```

**The root cause it exists for.** Two bugs of one shape reached a screen a month
apart: the scraper's `RANK_LABELS` filed 355 beetle superfamilies as
`Subkingdom`, and the example tree went Animalia → Phylum with nothing between.
Both were errors *in the data*, and every test passed straight through them,
because every test built its own fixture and checked the code against it. Code
that correctly colours a tree it is handed cannot tell you the tree is wrong. So
the gap was not a missing assertion, it was a missing *subject*: nothing checked
the shipped tree against anything outside itself.

Three groups of check, weakest first, and the order matters — each catches what
the one before cannot:

1. **Shape** — what the game's own code assumes. Unique names (the depth index
   is keyed on the name, so a duplicate corrupts play without raising), leaves
   ranked as species, no empty `children` lists.
2. **Warmth** — the invariant the colour scale needs: going deeper may never get
   colder. Plus the share of rank claims `believed_levels` had to reject, which
   fails the run above 5%. A dataset rejecting a lot has rotten ranks upstream.
3. **Biology** — a short table of relationships nobody disputes, asserted as an
   **ordering** rather than a number, so the same table holds on 530 species and
   on 41,167: a human is closer to a chimp than to a lion, than to a chicken,
   than to a salmon, than to a starfish, than to a wasp, than to a coral, than
   to a sponge. Pairs whose species are absent are skipped, not failed.

Group 3 is the one that catches a tree which is internally consistent and still
wrong, which is exactly what the flat example was. Verified against the fixture
as it shipped the day before: five failures, naming the pairs by hand.

`tests/test_dataset_integrity.py` runs all three over the packaged example on
every CI run, and then over deliberately broken trees so the checks are known to
bite — a flat tree, a duplicate name, an epidemic of bad ranks. `extract_game_tree.py`
runs groups 1 and 2 before it writes and refuses on failure, in the same spirit
as its existing duplicate-name guard; group 3 is left to the CLI because a
`--taxon Insecta` scrape legitimately has no humans in it.

**What it found first time out — fixed Sep 2026.** Both older scrapes fail the
bat chain: a vampire bat scores *exactly the same* against a wolf, a human, a
kangaroo and a platypus, because `Chiroptera` hung directly off `Mammalia` with
Theria, Eutheria, Placentalia, Boreoeutheria, Laurasiatheria and Scrotifera all
skipped. 106 edges skipped a full rank tier like this, covering 3,170 nodes.

The cause was third in a series and the same mistake as the other two.
`fetch_nodes_batch` and `fetch_species` both did `if id in results: continue`,
so when a taxon has several `P171` statements **the first row won, arbitrarily**,
and it tended to be the broadest. Now every candidate is kept (`parents`, in both
caches), the ancestor walk fetches all of them — 980 clades no lineage had
reached before — and `choose_parents` hangs each node from the candidate with the
**longest path to a root**. Where one candidate descends from another, the
descendant's path is always the longer, so no separate "which is narrower" test
is needed. An old cache is repaired in place: species by a parent-only query
(63,185 of them, in batches of 400), ancestors by a refetch.

The rebuild is `wikidata-parents-fixed`: 41,117 species. A bat meets a wolf at Scrotifera
(0.487), a human at Boreoeutheria (0.475), a kangaroo at Mammalia (0.395).
**One ordering still fails, and the fault is Wikidata's:** `Diprotodontia` lists
only `Mammalia` as its parent, although Marsupialia → Metatheria → Theria exists,
so a kangaroo meets a bat at the class, level with the platypus. No choice among
candidates can reach a parent Wikidata never lists, and a hand-written override
would be the `RANK_LABELS` mistake over again. **The packaged example is
unaffected: 0 rejected ranks, every check green.**

The rebuild also surfaced a latent hole. `sparql` answers a query that has spent
its retries with no rows, and for the parent repair no rows means "keep the
cached parent and mark it done" — 400 species closed off from repair by one 502,
in a run that looked successful. That query now passes `strict=True` and raises.
Two 502s did occur during the rebuild; both recovered on retry.

**Keeping every parent also made fake species — found on a phone, fixed Sep 2026.**
A candidate parent that loses its only child to a more specific one is left with
no children, and `extract_game_tree.convert` stamped `"Species"` on every leaf. So
the first `wikidata-parents-fixed` carried **189 childless clades as species**:
Apo-Chiroptera showed in explore as a bat photograph labelled "Species", a dead
end beside the real bats, and every one of them was guessable and could be drawn
as a seed's secret. It also produced a wrong claim, since corrected: the dataset
"gained 139 species", when the real count had gone from 41,120 to 41,117 and
the difference was fakes. The older scrapes already had 47, genera none of whose
species reached the threshold, so the bug predates the parent fix, which only
made it four times worse.

Three layers now, because it got past two:

- `drop_childless_taxa` in the extractor removes every leaf that was not a
  species in the raw tree, and any taxon that leaves empty — 210 nodes on the
  rebuild. The raw tree keeps them, since it records what Wikidata says.
- `convert` gives a leaf its own rank instead of stamping "Species", so one that
  slips through is visible.
- The shape check **fails** a leaf that is not a species. It used to note it,
  and could never have seen one, since every leaf had been stamped.

The pattern across all three bugs is worth naming, since it is now the repo's
most expensive habit: *taking the first available answer instead of the best
one, and never checking the result against anything outside itself.*
`RANK_LABELS` answered before the query could; the example fixture recorded only
the ranks its generator knew about; the scraper keeps whichever parent row
arrives first. The belief check and this validator are both instances of the
same remedy — check the claim against the evidence.

### `example_tree.json` is a fixture, not build output

It was generated once from a hand-curated NCBI-style taxonomy and checked in, so
that a clone is playable with no scrape and no network. **Nothing rebuilds it, and
it is not a subtree of the Wikidata scrape** — don't go looking for the script.
(The generator, `build_animals-1.py`, was deleted in Aug 2026 as legacy; the file
was verified byte-for-byte reproducible from it first, so nothing was lost that
the committed JSON doesn't already hold. It's in git history if ever needed. The
file was also called `animals_tree.json` at the repo root until Aug 2026.)
It has since been hand-edited once — the clade layer above — so it is no longer
byte-for-byte what that generator produced. Edit it the same way if it needs
more: by hand or by a one-off script, and update the counts here and the six
tests that pin them.

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

**A rank is a claim; the tree is the evidence** (Sep 2026, `believed_levels`).
The above depends on ranks being trustworthy, and they are not: reading rank as
a position in the hierarchy is exactly what a mislabelled rank breaks, and
Wikidata mislabels plenty even after the `RANK_LABELS` repair below. So a level
is used only where it is consistent with the ranked nodes around it — strictly
broader than every ranked ancestor, strictly narrower than every ranked
descendant — and a rejected claim falls through to the interpolation that
already handles clades. A suborder cannot contain a phylum; a subsection cannot
contain an order.

Three decisions in that, each one a bug that reached a screen:

- **Both ends of a contradiction are distrusted, judged against raw labels.** An
  earlier version believed the shallower claim and judged the deeper one against
  it, which blames the wrong node whenever the error is up the tree: Wikidata
  ranks `Tetrapodomorpha` a *subclass* and it contains the class Mammalia, so
  trusting the ancestor rejected **Mammalia** and flattened 26 nodes from the
  tetrapods to the therians onto one value — a human and a lion scored exactly
  what a human and a chicken did. Losing a label costs a name; losing the
  ordering costs the game.
- **Ties are rejected too.** `Bilateria` is a subkingdom inside the subkingdom
  `Eumetazoa`, so equal levels said a human and a wasp are exactly as related as
  a human and a coral. The tree says one contains the other.
- **A leaf is always believed.** Species must reach the top of the scale, and
  Wikidata carries synonym pairs nested species-under-species (`Ammodramus
  bairdii` under `Centronyx bairdii`) which the tie rule would otherwise reject.

**Deeper is strictly warmer, not merely no colder** (Sep 2026). Interpolation
used to be floored at the parent, which fixed 8 inversions of ~0.003 on the
scrape and left ties in their place. On the `wikidata-parents-fixed` rebuild, 20
clades in a row, Sarcopterygii to Sphenacodontia, came out at exactly 0.312, so a
crocodile and a frog scored the same against a bat though Amniota sits inside
Tetrapoda. A node that would not come out above its parent is now placed a share
of the way from the parent to the broadest believed rank below it, which keeps it
below every believed descendant. Ties: 0 of 1,084 internal edges on the example
(so its warmth, and the conformance file's, did not move), and 0 on the rebuild,
down from 73.

Rejection share is the early-warning number, and `validate_dataset.py` reports
it: 0% for the packaged example, 0.28% for `wikidata-ranks-fixed`, 6.5% for
`wikidata-2026-09` — which is a dataset to rebuild, not to play.

**Ranks that mean two things are off the ladder** (Sep 2026). `division`,
`subdivision`, `section`, `subsection`, `series` and `subseries` are botanical
ranks near phylum and genus, *and* zoological ranks for supra-ordinal groups.
The ladder listed the botanical readings. On the Sep 2026 scrape `Ctenosquamata`
is a *section* holding 4,482 nodes, `Acanthomorphata` a *subsection* holding
4,399 and `Acanthopterygii` a *division* holding 4,398 — all fish groups below
class, scored 0.90, 0.92 and 0.17. Two acanthomorph fish came out near-perfect
green while the correct answer was colder. There is no right constant for a word
that means two things, so they are unranked and the tree places them. Same
lesson as `RANK_LABELS`: a hand-written answer in front of the evidence wins
even where it is wrong.

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

**The guess list is one line, and how many chips that is gets measured** (Sep
2026, `components/GuessList.tsx` + `guessRow.ts`). It used to be a wrapping row
of every guess at full size, which on a phone spent a line of screen every two
or three turns — ten guesses in it cost three rows above the tree, on the axis
the tree has least of. It is the least important thing on the page: the tree
already shows every guess in its place and `GuessInput` already excludes the
ones spent, so it is a reminder, not a working surface. Small chips, clamped to
one row, with a `+N more` toggle for the rest.

Three details, each of which is a way to get it wrong:

- **Newest first.** Guesses in the order they were made put the oldest on the
  visible line and hide the freshest — including, at the end of a won round, the
  winning guess, which is the one chip anybody wants to see.
- **Measured, not counted.** The chips are names, so no fixed number of them is
  a line ("Tiger" is 48px, "African elephant" 119px). `firstRowCount` reads the
  chips' `offsetTop` back out of the DOM, the same trick as jump-centring above,
  and a `ResizeObserver` re-measures on rotation. Clamping is `overflow: hidden`
  rather than unmounting, because a chip that leaves the layout measures as
  fitting and the row would flip between the two states forever.
- **The toggle is always in the layout**, `visibility: hidden` when there is
  nothing to hide. Removing it would give the row back ~70px, which can be
  exactly enough for the last chip to fit — and then there is nothing to hide,
  and the toggle comes back, and the row hunts.

In jsdom every `offsetTop` is 0, so `firstRowCount` returns the whole list and
nothing is hidden — which is why `App.test.tsx` can still find a guess chip by
its text without knowing this component exists.

**Give up rides at the end of the seed row**, for the same reason: on a phone it
wrapped under the guess bar and spent a whole row on the control you press once
a game. Far right rather than next to `Copy` — most of the row lies between
them, so a miss is a miss and not the other action. It is a spacer `Box` and not
`ml: 'auto'`, because `Stack` sets its own left margin on every child and would
fight the override.

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

## The engine runs twice (Sep 2026)

The game logic exists in Python and in TypeScript (`frontend/src/engine/`). The
port is what lets the app run with no server — as a static website now, and
wrapped as an Android/iOS app (Capacitor is the plan) next. The Python stays: it
is the CLI, it serves scraped datasets too big to ship, and it is the reference
the port is checked against.

**Two copies of a rule drift, so a test holds them together.**
`tests/conformance.py` writes Python's answers to a fixed set of questions into
`frontend/src/engine/conformance.json`: warmth for every node of the example and
for synthetic trees built to hit each branch of `believed_levels`, SHA-256 at
every padding boundary, seeds, daily bodies, 32 game states, autocomplete,
explore slices, lineages, searches and taxon info. Both suites check it:

- `tests/test_conformance.py` fails while the file is stale, so a Python change
  cannot land without regenerating it (`python tests/conformance.py`);
- `engine/conformance.test.ts` fails while TypeScript disagrees with the file,
  so the regenerated file cannot land without the matching port.

Numbers are compared with `===`, never a tolerance. Both sides do the same IEEE
operations in the same order, so any difference is a real divergence.

**Checked by mutation, which found two gaps.** Twelve single-rule breaks in the
port; ten turned the suite red at once. The floor that stops interpolated clades
crossing, and the node budget's `>` against `>=`, did not: no case reached
either. The synthetic floor tree and the exact-budget slice were added for them.
Two further breaks change nothing and are not gaps — `>=` for the deepest LCA
(two LCAs at one depth on one lineage are the same node) and dropping
autocomplete's lower-casing (no example name has a capital). The Python half
bites too: breaking ties in `ranks.py` or the seed prefix fails
`test_conformance.py`.

**Also verified once against both scrapes**, outside the suite since `data/` is
not committed: all 57,051 warmths exact on `wikidata-ranks-fixed` *and* on
`wikidata-2026-09`, whose 6.5% rejected ranks are the hardest case for
`believed_levels`, plus 60 random rounds, 40 seeds, searches and the root slice.
On a laptop, indexing a full scrape takes ~0.3s and a guess ~0.5ms.

**Who answers is decided in `api.ts`, and components never know.** Its exports
kept their signatures. The **example** is answered by the engine; **any other**
dataset goes over HTTP, since a scrape lives on a server's disk. An unset dataset
still means "the server's default" — that is how `TAXOQUIZ_DATASET=x ./start.sh`
plays a scrape — so the first request asks `/api/dataset` once. No answer means
the example, and "no answer" is the common case, not an edge: a static host and
a phone's asset server both answer with `index.html`, which fails to parse. A
server that accepts and never replies is abandoned after `PROBE_TIMEOUT_MS`.

Decisions inside the port, each one a way to get it quietly wrong:

- **SHA-256 is plain TypeScript, not `crypto.subtle`.** That only exists in a
  secure context, and the dev server is reached from a phone over plain http on
  Tailscale — the game would start on a laptop and fail on the phone. It is also
  async, which would have made every function above it async. The round
  constants are derived from the prime roots rather than pasted.
- **Seeds use `BigInt`.** Python reads the whole 256-bit digest as one integer
  before taking a modulus; a `Number` loses that silently.
- **The daily uses the UTC date, on both sides.** The client cannot know the
  server's timezone, and `App.tsx` already stamped saved sessions with the UTC
  date, so a server-local daily expired an hour off on a UK clock anyway.
  `pick_animal.utc_today()` is the Python half.
- **Name-keyed lookups are `Map`s.** A plain object answers `constructor` and
  `toString` from its prototype; a synthetic tree in the golden file carries
  both as ranks.
- **The example is fetched by URL, not imported.** As a module, 1.8MB of JSON
  would sit in the bundle and parse before first paint, the taxon text would load
  before any popup asked for it, and `tsc` would infer a type for every node.
  `?url` emits hashed assets that load the same from a dev server, a static host
  and a phone. The tree is 633KB and gzips to 24KB.
- **The files are read from `src/taxoquiz/data/` in place, not copied**, which
  needs `server.fs.allow: ['..']` in `vite.config.ts` — without it the dev server
  403s the tree while the build works fine.
- **A failed download is not cached.** On a phone the next attempt may have
  signal.

Verified in Chrome against the built app served by `python -m http.server`: a
practice round, autocomplete and a guess drawn with its `???`, no console errors,
and no request to `/api` but the probe and the settings menu's dataset list (both
404, both falling back). The seed it produced resolved to the same animal in
Python.

**Changing game logic now means:** change the Python, run
`python tests/conformance.py`, then make the TypeScript pass. The docstrings
explaining *why* stay in the Python; the TypeScript points there rather than
repeating them, so the reasoning has one home.

## The website (Sep 2026)

<https://markharley12.github.io/TaxoQuiz/>, deployed by `.github/workflows/pages.yml`
on every push to `master`: frontend tests, build, publish `frontend/dist`. GitHub
Pages is free because the repo is public; Pages was switched on with
`gh api -X POST repos/markharley12/TaxoQuiz/pages -f build_type=workflow`. Both workflows use the v7 majors of the actions, and Dependabot keeps them
current.

It is also the iPhone route. An iPhone cannot install an app from a file the way
Android takes an APK — that needs the App Store or TestFlight, a $99/year Apple
developer account, and a Mac or a rented macOS build machine. *Add to Home
Screen* on the website needs none of that.

Decisions, each a way to get this quietly wrong:

- **`base: './'` in `vite.config.ts`.** One build then works under Pages'
  `/TaxoQuiz/`, at a domain root, and inside the Android app. With the default
  absolute `/` the Pages site is blank: every script is requested from the
  domain root. The `/api` probe in `api.ts` stays absolute on purpose — on Pages
  it asks `github.io/api/dataset`, gets a 404, and plays the example.
- **The service worker is hand-written** (`frontend/pwa/sw.js`, ~50 lines), and
  a build plugin in `vite.config.ts` writes in `VERSION`, a hash over every
  built and public file, and `FILES`, the exact list. The plugin throws if either
  placeholder has gone, rather than shipping a worker that caches nothing.
- **A page is always exactly one build.** Files are named by content hash and a
  deploy replaces all of them, so everything is served cache-first, `index.html`
  included, and a new worker **waits** (no `skipWaiting`) until the old
  version's pages are closed. Taking over mid-round would delete the cache under
  a page whose next lazy fetch, the taxon text, would 404 on the new site. The
  price: an update reaches a player on the second open after a deploy.
- **Not registered in dev**, where it would hide edits, **nor inside Capacitor**
  (`Capacitor.isNativePlatform()`), where the files are already on the device and
  a worker could only serve the previous version after an APK update.
- **Other origins are not cached.** The Wikimedia pictures carry their own
  licences and would fill the phone.
- **The precache is 21 files, 2.67MB**, including every font subset. Normally
  `unicode-range` means only the Latin files are fetched; precaching fetches the
  others too, about 300KB. Accepted rather than special-cased.
- **The favicon was Vite's own logo** until this change. `pwa/icon.svg` is
  full-bleed paper, because iOS fills an icon's transparency with black and a
  maskable icon may be cropped to a circle; the drawing stays inside the central
  80%. `public/favicon.svg` is the same art with rounded corners.
  `pwa/render-icons.sh` renders the PNGs with headless Chrome, and they are
  committed.
- **The popup carries a CC BY-SA 4.0 notice** beside "From Wikipedia", since the
  text is now served publicly, not only redistributed in the repo.

**Verified** on the build, served under `/TaxoQuiz/` from a local static server
as Pages serves it: the worker activated with scope `/TaxoQuiz/` and 21 files
cached. With the server then killed, a reload came from the cache and a practice
round started with a seed; the probe rejected in 7ms and the tree came from the
cache in 4ms. The APK still builds with the relative base.

**The update flow was verified across two real deploys** (Sep 2026), in Chrome
with the first build already cached. Opening the site after the second deploy
served the *old* build whole (its own script hash), with the new worker
`installed` and waiting and both caches present. After the tab was closed, the
next visit was controlled by the new worker, served the script the live site
serves, and had deleted the old cache.

**Not verified:** a guess made offline (the engine path is exercised online and
by the suites), and *Add to Home Screen* on a real iPhone. Also, Chrome screenshots of the offline page timed out while
the page kept answering scripts; the cause was not investigated, and the checks
above were made through the DOM.

## The Android app (Sep 2026)

Capacitor 8 wraps `frontend/dist` in a native shell: `frontend/capacitor.config.ts`
and the Gradle project in `frontend/android/`. The web app is served from inside
the APK, so it depends on the engine above; there is nothing else to it. Build
with `npm run android:apk` in `frontend/` — the README has the one-off SDK setup.
A debug APK (~4.9MB) was installed on a real phone by sideloading and reported
working; that is the extent of device testing so far, and it was not
instrumented.

Things that look arbitrary or are easy to get wrong:

- **`appId` is `io.github.markharley12.taxoquiz` and is permanent after the
  first store upload** — a store treats a new ID as a different app. Free to
  change until then.
- **`android/` is committed; its copy of the web app is not.**
  `app/src/main/assets/public`, the generated `capacitor.config.json` and
  `local.properties` are all in `android/.gitignore`. So a fresh clone has no web
  assets in the Android project until `cap sync` runs, and a bare `./gradlew`
  after a frontend change packages the *previous* build. `android:apk` exists to
  make that ordering impossible to skip.
- **`sdkmanager` is gone; the `android` CLI replaced it** (Sep 2026, cmdline-tools
  23). `sdkmanager --licenses` now says the option is no longer needed, and the
  new CLI shows the SDK terms on first run instead. It also **collects usage
  metrics by default** — pass `--no-metrics`. Packages installed:
  `platform-tools`, `platforms;android-36`, `build-tools;35.0.0` (what
  `variables.gradle` and AGP 8.13 ask for), and JDK 21 (`VERSION_21` in the
  generated Gradle files).
- **The emulator was not usable on the dev machine.** Creating a device, which
  downloads a ~1.5GB system image, was killed for low memory: swap was nearly
  full from the desktop's own apps. A Gradle daemon left behind by a build held
  1.3GB of that — `./gradlew --stop` after building if memory is tight. Test on a
  phone instead, which is the better test anyway.
- **`npm audit` reports 4 moderate findings, all one `uuid` advisory**, and it
  applies only when a caller passes a `buf`. Two routes in: `@capacitor/cli`'s
  Xcode tooling (build-time, never in the APK; npm's only fix is a downgrade
  that would split the Capacitor packages across versions) and `react-d3-tree`,
  which ships in the app but calls a bare `uuidv4()` in all three places.
  Left alone deliberately. Everything else `npm update` cleared (Sep 2026).

**The back button closes the newest overlay, then minimises** (Sep 2026,
`frontend/src/backButton.ts`). With no listener, Capacitor closed the app from any
screen, since the app keeps no browser history. Back-to-the-mode-menu would have
been wrong: `handleChangeMode` clears the saved session, so it would throw away a
daily round. Overlays — the taxon popup, both confirmations, explore's
expand-all warning, the settings menu — register with `useCloseOnBack(open,
close)`, a stack, so one press closes one thing and the newest first; with none
open, `App.minimizeApp()` leaves the round exactly where it was. Native only: in a
browser, back belongs to the browser. **A new dialog must call the hook**, or back
skips straight past it and minimises the app underneath.

CI's `android` job builds the standard debug APK on every push and keeps it for 30
days. Each run signs with a fresh debug key, so a newer CI APK will not install
over an older one — uninstall first.

**Release signing** (Sep 2026). `npm run android:release` signs with a key kept
outside the repo: `~/.android/taxoquiz-release.jks`, with its password in
`~/.gradle/gradle.properties` as `TAXOQUIZ_RELEASE_*` (also read from the
environment). `build.gradle` signs release builds only when those are present,
so a clone without them still builds, unsigned. Certificate SHA-256
`85:62:B9:72:…:30:FC:1B:C2`, valid until 2054, verified on a built APK with
`apksigner`. **Back up both files together**: losing the key means no update can
ever be published as this app. It is deliberately **not** in GitHub secrets — the
owner chose to keep it on one machine — so CI's artifact stays a debug APK, on a
fresh key each run. Release and debug APKs carry different signatures, so moving a
phone from one to the other needs one uninstall, which loses its saved round.

**The launcher icon and splash** are generated by `@capacitor/assets` from
`frontend/assets/logo.png`, which `pwa/render-icons.sh` renders from the same
`pwa/icon.svg` as the website's icons, set on the paper colour. The tool also
reformats `AndroidManifest.xml` without changing its meaning; that is reverted
after generating, so the diff shows only what changed. The README has the command.

**TaxoQuiz Full, the big-dataset app** (Sep 2026).
`VITE_BUNDLED_DATASET=<a dataset under data/> npm run android:full` builds a
second app — `io.github.markharley12.taxoquiz.full`, named "TaxoQuiz Full" — that
installs beside the ordinary one and plays that dataset on the device. Only a
machine holding the scrape can build it, since `data/` is not committed.

- **A Gradle flavour decides the identity; the build decides the data.** The
  `standard` and `full` flavours in `app/build.gradle` differ only in ID and name
  (`src/full/res/values/strings.xml`). What is inside is whatever `cap sync` last
  copied, so every `android:*` script builds and syncs first, and `android:full`
  refuses to run without the variable.
- **`@bundle/tree.json` and `@bundle/taxon_info.json` are Vite aliases**
  (`vite.config.ts`) onto the example or `data/<name>/`. A named dataset that is
  missing fails the build, rather than quietly bundling the example into an app
  called "Full". `engine/local.ts` exports `BUNDLED`, which `api.ts` routes to the
  device where it used to route `EXAMPLE`.
- **Size.** Built from `wikidata-parents-fixed`, the APK is 15MB, carrying a 7.1MB
  tree and 43.5MB of taxon text; the text loads on the first popup, not at start.
  Not yet measured on a phone.
- **Flavours moved the APK paths:** `apk/standard/debug/app-standard-debug.apk`,
  `apk/standard/release/app-standard-release.apk`,
  `apk/full/release/app-full-release.apk`.

Not done yet: iOS.

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

Ctrl+C stops both. The Vite dev server proxies `/api/*` to `localhost:8000`. The
frontend plays the example without it; the API is needed for scraped datasets.

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
- Game logic lives in two languages: change the Python, regenerate `frontend/src/engine/conformance.json` with `python tests/conformance.py`, then port the change until `npm test` passes
- Keep the tree loading separate from game logic so it can be cached at API startup
- `data/` is gitignored; committed code must work from the bundled
  `src/taxoquiz/data/example_tree.json`, which is checked in. Never make the game
  depend on anything in `data/` — the taxon-info popup is the one optional
  feature that does, and it degrades to 404s rather than failing to start.

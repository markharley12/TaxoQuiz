# `data/` — what all these JSON files are

Everything in here is **generated and regenerable**, which is why it is
gitignored (this README is the one exception). The one dataset that is *not*
here is the example the game plays by default: that ships inside the package, at
`src/taxoquiz/data/example_tree.json`.

There are three kinds of thing in this directory.

## 1. Datasets — `data/<name>/`

A dataset is one playable taxonomy plus the Wikipedia text that matches it.
Select one with `TAXOQUIZ_DATASET=<name>`; unset plays the bundled example.

| File | What it is | Made by |
| --- | --- | --- |
| `tree.json` | **The taxonomy you play on.** Nested `{name, rank, children}`, species at the leaves. | `datagen/extract_game_tree.py` |
| `taxon_list.json` | Flat list of every *ancestor* in that tree — the things a popup can be opened on. Purely an input to the next step. | `datagen/build_taxon_list.py` |
| `taxon_info.json` | Wikipedia summary + thumbnail per taxon, keyed by name. Only the click-a-node popup uses it. | `datagen/scrape_taxon_info.py` |

Only `tree.json` is required. Without `taxon_info.json` the game plays fine and
every popup reads "No information available".

**These three belong together.** They used to be selectable independently, which
made it easy to play an 18k-species tree while showing the 530-species example's
text — a whole tree of "No information available" with nothing obviously wrong.
Keeping them in one directory is what prevents that.

`data/example/` is a special case: it holds the taxon info for the *bundled*
tree, since that text is large and regenerable and so isn't shipped in the
package.

## 2. Scraper intermediates — `data/_scrape/`

Raw output from `datagen/scraper.py`, shared by every dataset. Big, slow to
rebuild, and not used by the game at runtime — only by `extract_game_tree.py`.

| File | What it is |
| --- | --- |
| `species.json` | Flat `Q-ID → {common_name, scientific_name, parent, sitelinks}` for every species matched. |
| `ancestors.json` | Flat `Q-ID → ancestor metadata`, filled in while walking parent taxa upward. |
| `tree_of_life.json` | Those two assembled into one nested tree rooted at **Life**. The big one (~43MB). |

`species.json` and `ancestors.json` are caches: a scrape that dies part-way
resumes from them instead of re-fetching everything.

**`tree_of_life.json` is not playable.** It is rooted at Life rather than a
kingdom, its schema is inverted relative to the game's (it puts the common name
in `name`), and its names are not unique. `extract_game_tree.py` exists to
convert it; see `datagen/README.md`.

## 3. This README

Committed, unlike everything else here.

## Which file does the game actually read?

Exactly two, both from the selected dataset:

- `tree.json` — required, on every request
- `taxon_info.json` — optional, only for the popup

Everything else is scaffolding for producing those. `GET /dataset` reports which
dataset is live and how much of it is present.

## Safety

Every write here is atomic (write to a temp file, then `os.replace`), so an
interrupted scrape leaves the previous version intact and resumes from its last
checkpoint. `extract_game_tree.py` also refuses to overwrite an existing
`tree.json` without `--force` — build a new dataset alongside the one you're
using and switch when you're happy with it.

Nothing in here is backed up, because all of it can be rebuilt. The thing that
cannot is the bundled example tree, and that lives in git.

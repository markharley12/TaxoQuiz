# `data/` — what all these JSON files are

Everything in here is **generated and regenerable**, which is why it is
gitignored (this README is the one exception). The one dataset that is *not*
here is the example the game plays by default: it ships inside the package, as
`src/taxoquiz/data/example_tree.json` plus `example_taxon_info.json`, so a clone
is playable and has working taxon popups without anything in this directory.

There are three kinds of thing in this directory.

## 1. Datasets — `data/<name>/`

A dataset is one playable taxonomy plus the Wikipedia text that matches it.
Select one with `TAXOQUIZ_DATASET=<name>`; unset plays the bundled example.

| File | What it is | Made by |
| --- | --- | --- |
| `tree.json` | **The taxonomy you play on.** Nested `{name, rank, children}`, species at the leaves. | `datagen/extract_game_tree.py` |
| `taxon_info.json` | Wikipedia summary + thumbnail per taxon, keyed by name. Only the click-a-node popup uses it. | `datagen/scrape_taxon_info.py` |

Only `tree.json` is required. Without `taxon_info.json` the game plays fine and
every popup reads "No information available".

**These two belong together.** They used to be selectable independently, which
made it easy to play an 18k-species tree while showing the 530-species example's
text — a whole tree of "No information available" with nothing obviously wrong.
Keeping them in one directory is what prevents that.

There used to be a third file, `taxon_list.json`, listing which taxa to fetch.
It was removed in Aug 2026: it was entirely derivable from `tree.json` (it was
just "every node with children"), so it was a second copy of something the tree
already determined, and one that could fall out of step with it. The scraper now
reads the tree directly and writes its results into `taxon_info.json` as it
goes.

For the same reason `taxon_info.json` does **not** store `rank`, even though the
popup displays it — `tree.json` defines the rank, and a copy here could disagree
with the tree it describes. The API merges it in from the tree on read.

There is no `data/example/` — the example's text is bundled in the package
instead, so it is available to a `pip install` and not just a clone. If you ever
want to regenerate it, `TAXOQUIZ_DATASET=example` writes here and that file then
takes precedence over the packaged one.

## 2. Scrape cache — `data/_cache/`

Raw output from `datagen/scraper.py`, shared by every dataset. **Always safe to
delete** — everything here is rebuildable, and nothing reads it at runtime; the
only cost of losing it is running the scrape again. Only `extract_game_tree.py`
reads it, and only when you are building a new dataset.

| File | What it is |
| --- | --- |
| `wikidata-species.json` | Flat `Q-ID → {common_name, scientific_name, parent, sitelinks}` for every species matched. From the network. |
| `wikidata-ancestors.json` | Flat `Q-ID → ancestor metadata`, filled in while walking parent taxa upward. From the network. |
| `wikidata-tree-raw.json` | Those two assembled into one nested tree rooted at **Life** (~51MB). Built offline from the two above, so it costs no network to rebuild. |

Both flat files are resume caches: a scrape that dies part-way picks up from them
instead of re-fetching everything.

**`wikidata-species.json` has a second, less obvious use — keep it.** It is the only place
`sitelinks` survives; `wikidata-tree-raw.json` drops the field. Since `sitelinks` is
what `MIN_SITELINKS` filters on, this cache is what lets you rebuild at a
different size (a smaller, more famous set, say) without re-querying Wikidata,
which is by far the slowest step. `wikidata-ancestors.json` has no such second life and is
purely a resume aid.

### `wikidata-tree-raw.json` vs a dataset's `tree.json`

These sound like the same thing at two sizes. They are not — the difference is
**schema**, and the raw one crashes the game:

| | `_cache/wikidata-tree-raw.json` | `<dataset>/tree.json` |
| --- | --- | --- |
| root | Life | a kingdom, e.g. Animalia |
| nodes | 57,805 | 27,169 |
| a leaf's `name` | the **common** name, `"Gabon Coucal"` | the **binomial**, `"Mnemiopsis leidyi"` |
| `common_name` field | absent | present |
| node names unique | no — 63 collisions | yes, enforced |
| playable | **no** — `KeyError: 'common_name'` | yes |

`-raw` in the filename is the warning. `extract_game_tree.py` does the
conversion; see [`datagen/README.md`](../datagen/README.md) for what it has to
fix and why.

## 3. This README

Committed, unlike everything else here.

## Which file does the game actually read?

Exactly two, both from the selected dataset:

- `tree.json` — required, on every request
- `taxon_info.json` — optional, only for the popup

Everything in `_cache/` is scaffolding for producing those, and is never read at
runtime. `GET /dataset` reports which
dataset is live and how much of it is present.

## Safety

Every write here is atomic (write to a temp file, then `os.replace`), so an
interrupted scrape leaves the previous version intact and resumes from its last
checkpoint. `extract_game_tree.py` also refuses to overwrite an existing
`tree.json` without `--force` — build a new dataset alongside the one you're
using and switch when you're happy with it.

Nothing in here is backed up, because all of it can be rebuilt. The thing that
cannot is the bundled example tree, and that lives in git.

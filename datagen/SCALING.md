# Growing a dataset without rebuilding it

*Written 4 Sep 2026, from measurements taken the same day. Every number here was
measured against the live Wikidata and Wikipedia endpoints; where a figure is an
estimate it says so.*

The question this answers: **the dataset we have is a subset of any bigger one we
would build, so what actually has to be re-fetched?**

The answer turned out to be "much less than everything, but the pipeline could
not express that" — and, separately, that the sitelink threshold had been silently
doing nothing for some time.

---

## 1. The subset property is real, and now measured

A species' sitelink count is a property of the species, not of the query. So the
set at threshold *N* is a strict subset of the set at any lower threshold, and the
difference is exactly the band in between.

Verified against Wikidata rather than assumed:

| Query | Species |
| --- | --- |
| `>= 6` | 63,712 |
| `>= 10` (what we already hold) | 41,648 |
| `[6, 10)` (the band) | 22,064 |
| **`>= 10` + band** | **63,712 — exact** |

So a threshold-6 scrape costs one 22,064-row band fetch, not a 63,712-row rebuild.
`tests/test_scraper_incremental.py::test_band_plus_existing_equals_a_full_fetch`
holds this property offline so it cannot regress.

### How many species are down there

| Threshold | Species (all of Life) |
| --- | --- |
| `>= 10` | 41,648 |
| `>= 8` | 51,276 |
| `>= 6` | 63,712 |
| `>= 3` | 77,052 |

`>= 4` and `>= 5` **could not be counted** — the endpoint returned 502 and then a
read timeout, while `>= 3` succeeded moments later. The public SPARQL endpoint is
unreliable on aggregate queries at this size; this is load, not a hard limit, and
it is the same class of constraint that `scraper.py`'s docstring already records
for `wdt:P171+`. Do not read a failed COUNT as "no data".

---

## 2. The bug this uncovered: the threshold did nothing

`main()` loaded the species cache and passed it to `build_tree` **unfiltered**, so
once a cache existed `MIN_SITELINKS` had no effect in *either* direction:

```
MIN_SITELINKS=10  -> 41,140 leaf species
MIN_SITELINKS=30  -> 41,140 leaf species
MIN_SITELINKS=50  -> 41,140 leaf species
```

Two consequences, both of which had made it into the docs as features:

- **Lowering it did nothing** — the cache short-circuit meant no fetch, so you got
  the old dataset back and nothing said otherwise.
- **Raising it did nothing** — `data/README.md` claimed the species cache "lets you
  rebuild at a different size (a smaller, more famous set, say) without re-querying
  Wikidata". That path never filtered, so it returned the cached set unchanged.

Fixed by `at_threshold()`, which narrows the cache to the requested threshold
before the tree is built, and is regression-tested.

---

## 3. Ancestors are only ~44% covered — less than expected

The guess going in was that obscure species mostly hang off genera we already
have, making stage 2 nearly free. Measured on a 2,000-species sample from the new
band:

| | |
| --- | --- |
| distinct parents | 1,083 |
| already in cache | 478 (**44%**) |
| to fetch | 605 |

That works out at **~0.30 new ancestor nodes per new species**, so 22,064 new
species implies roughly 6,600 new ancestor nodes. Cheap, but not free — worth
knowing before assuming stage 2 is a no-op.

`fetch_all_ancestors` now takes a `known=` seed so it fetches only the lineage the
new species actually introduce, instead of being skipped entirely whenever the
ancestors cache file happened to exist.

---

## 4. SPARQL page size: bigger is better, up to a cliff

Sweeping `LIMIT` over the `[6,10)` band:

| LIMIT | rows | secs | rows/s |
| --- | --- | --- | --- |
| 1,000 | 1,000 | 26.8 | 37 |
| 2,500 | 2,500 | 11.0 | 227 |
| 5,000 | 5,000 | 29.4 | 170 |
| **10,000** | **10,000** | **15.8** | **632** |
| 20,000 | — | — | **502 Bad Gateway** |

Timings are noisy — 1,000 rows took longer than 2,500 — so treat the middle rows
as roughly equivalent and the endpoints as the real signal: **10,000 works and is
fastest, 20,000 fails.** `--page-size` is now a flag rather than a source edit.

---

## 5. Wikipedia is the long pole, and the first measurement of it was wrong

The taxon-info scrape is by far the most requests. First pass suggested 8 workers
gave a **25× speedup** — which was too good, and was. That test re-fetched the same
8 batches the serial arm had just pulled, so the concurrent arms were reading
Wikipedia's warm cache.

Re-run with **distinct titles per batch**, taken from deep in the tree so they are
obscure enough not to be hot:

| Mode | Throughput | vs serial |
| --- | --- | --- |
| serial (`DELAY=0.5`) | 20.5 nodes/s | 1.0× |
| concurrent ×2 | 76.2 nodes/s | 3.7× |
| **concurrent ×4** | **116.1 nodes/s** | **5.7×** |
| concurrent ×8 | 107.7 nodes/s | 5.3× — *no better than ×4* |

**The honest number is 5.7×, not 25×.** Concurrency saturates at 4 workers.

### And then concurrency turned out to be unnecessary

`taxon_info.json` is keyed by **node name**, and the scraper only fetches names not
already present. So the new dataset can be **seeded by copying the existing
`taxon_info.json`**, and only the genuinely new nodes get fetched — roughly 15,000
rather than ~42,000.

At the measured serial rate that is about **12 minutes**. Adding threads would save
ten minutes on a job run once, at the cost of new code, a new failure mode and a
worse-behaved client against a donated API.

**So: seeding is the optimisation, and concurrency is not adopted.** The profiling
is recorded here because it is what justifies *not* doing it — the measurement that
changes your mind is worth as much as the one that confirms it.

**Guard when seeding:** drop any copied entry whose `qid` disagrees with the new
tree's `qid` for that name. Names are near-stable between trees, but
`extract_game_tree.make_names_unique` can assign a uniquifier suffix
(`Lepus (Lepus)`) differently as the tree grows, and the Q-ID makes the check exact
rather than hopeful.

---

## 6. Stage 1 now really does resume

`data/README.md` said the flat caches were resume caches and that "a scrape that
dies part-way picks up from its last checkpoint". For stage 1 that was **not true**:
the cache was written once, after the whole paged fetch returned. A run that died
on page 3 of 3 saved nothing.

`fetch_species` now takes a `checkpoint` callback and `main()` writes the merged
cache after every page. `ORDER BY ?species` makes each saved prefix stable.

---

## What changed in the code

| Change | Why |
| --- | --- |
| `fetch_species(min, below=, page_size=, checkpoint=)` | band fetching, tunable paging, real resume |
| `cache_threshold(species)` | what threshold a cache represents, read back off the data |
| `fetch_plan(have, want)` | full fetch / band / nothing — the decision, isolated and testable |
| `at_threshold(species, min)` | **makes the threshold mean something**; fixes §2 |
| `fetch_all_ancestors(species, known=)` | grow lineages instead of skipping stage 2 |
| `--min-sitelinks`, `--page-size`, `--plan` | no source edit to change size; `--plan` says what it would do |

`--plan` is the one to reach for first:

```bash
python3 datagen/scraper.py --min-sitelinks 6 --plan
#   cache threshold: 10   wanted: 6
#   -> fetch sitelinks >= 6 and < 10 (band only — the rest is cached)
```

## Tests

`tests/test_scraper_incremental.py` — 11 tests, ~0.1s, no network. `scraper.sparql`
is the single network seam and every test replaces it, so the suite cannot be
broken by Wikidata being slow. Run with `python3 -m pytest tests/ -q`.

These are the repo's first tests.

## Why threshold 6

It is the largest step whose band correctness and paging were both verified
end-to-end, and it adds 53% more species. It is no longer a costly or final
decision: going to 5 or 4 later costs only the next band, which is the whole point
of the change.

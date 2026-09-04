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

---

## 7. The bug that mattered most: taxa with no English label

Everything above is about fetching *more*. This section is about the ~46% of
Animalia that the previous scrape never had.

`fetch_nodes_batch` asked for a label as a **required** clause:

```sparql
?item rdfs:label ?label .
FILTER(LANG(?label) = "en")
```

Wikidata has plenty of taxa with no English label at all. `Dinosauriformes`
(`Q2740164`) is one: it has a scientific name (P225) and a parent (P171), and its
`labels` object is empty. Such a node returned **no row**, so it was silently
skipped — and skipping one node does not lose one node, it **detaches everything
below it**. `build_tree` then wrapped the orphans in a synthetic `Life` root, so
the output looked structurally fine and reported no error.

Dinosauriformes alone cost 10,625 species — every bird — which sat outside
Animalia in a tree that otherwise looked complete.

Fixed by making every clause OPTIONAL and falling back to the scientific name,
which taxon nodes always have. The effect on the same species set:

| Build | Animalia species | Disconnected roots |
| --- | --- | --- |
| as first built | 26,434 | 910 |
| + self-healing ancestor walk | 30,200 | 174 |
| **+ optional label** | **41,181** | **3** |

The 3 remaining are the real root (Biota) and two single-species curiosities.

### How much of the growth was the bug, not the threshold

Rebuilding at the **old** threshold of 10 with today's fixes settles it:

| | Animalia species |
| --- | --- |
| `wikidata-2026-08`, as shipped at `>= 10` | 18,421 |
| rebuilt at `>= 10` with the fixes | **34,358** |
| `wikidata-2026-09-sl6` at `>= 6` | 41,152 |

So of the 18,421 → 41,152 jump, **+15,937 is the bug fix and +6,794 is the lower
threshold.** The previous dataset was missing **46% of Animalia**, and nothing in
it looked wrong. It is the same failure shape as §2: a plausible artefact rather
than an error.

### Two lessons worth keeping

1. **A required clause in a batch query is a silent filter.** Anything that fails
   to match vanishes from a result the caller reads as complete.
2. **Watch the orphan count.** `build_tree` prints "N disconnected roots". It went
   133 → 910 and nothing treated that as a failure. It is the cheapest available
   signal that a tree is broken, and it should probably be a threshold that
   *fails* rather than a line of output.

---

## 8. Where the taxon-info scrape's time actually goes

Predicted 24 minutes, took **63**. The profile in §5 measured only the Wikipedia
summary call; the production path also resolves Q-IDs to titles via Wikidata,
with its own `DELAY`. Benchmarking one stage and quoting it as the pipeline is
how an estimate ends up 2.5× out.

Measured at **6.4s per 50-node chunk**:

| Per chunk | Requests | ~Time |
| --- | --- | --- |
| Wikidata: 50 Q-IDs → titles | 1 | 1.0s |
| Wikipedia round 0 (~50 titles, 20/call) | 3 | 3.0s |
| **Wikipedia fallback rounds 1–3** | **~3** | **~2.4s** |
| Checkpoint write | — | 0.32s |

**The fallback rounds are half the requests for a small fraction of the work.**
`candidate_titles` gives each node up to four titles, tried in rounds — one
batched request per round. Round 0 carries all 50 nodes; rounds 1–3 carry only
stragglers but each still costs a full request and a full `DELAY`. The code's
comment says fallbacks are "a few percent"; that was written when the miss rate
was 3.2%, and at threshold 6 it is ~10%.

**Open improvement:** rounds 1–3 together carry well under 20 titles, so they
could be merged into one request instead of three — roughly 40% off the runtime.

**Checkpointing is not the problem**, though it looks like it: a 44.5MB file
rewritten every 50 nodes is ~21GB of writes, but it measures at 0.32s per chunk —
**5%**. Worth stating because it is the obvious suspect and it is wrong.

---

## 9. What shipped

`wikidata-2026-09-sl6` — Animalia at `>= 6` sitelinks, built 4 Sep 2026.

| | |
| --- | --- |
| species | 41,152 |
| total nodes | 56,980 |
| max depth | 82 (previous dataset: 64) |
| taxon-info entries | 56,980 |
| species with no text | 2,489 (6.0%) |
| species with an image | 31,566 (76.7%) |
| internal taxa with no text | 610 (3.9%) |

Seeding carried **27,167 of 27,169** entries across with **zero Q-ID mismatches**,
so the Wikipedia stage fetched 29,813 nodes rather than 56,980.

`wikidata-2026-08` is kept alongside it — both are selectable from the settings
menu, which makes the two directly comparable in the game.

# Fixing what we find, upstream

TaxoQuiz is built from Wikidata and Wikipedia, so reading 41,000 species through
a game turns up their mistakes. This file holds the rules for acting on them and
describes the loop that keeps track.

## Rules

**Slowly, by hand, one edit at a time.** Nothing here edits anything. Every
change is made by a person, under their own account, after reading the item,
its references and its history. Wikidata's bot policy expects that for anything
beyond a small manual batch, and an edit that turns out wrong costs other
editors' time and the project's goodwill. The aim is a reputation for edits
that never need reverting.

1. **Start with reverts.** A bad value introduced recently, by a temporary or
   new account, over one that stood for years, is the safest edit there is:
   it restores a consensus rather than asserting a new one.
2. **Then single-statement fixes the item itself proves.** Its own label,
   article title and species all agree on the right value.
3. **Never remove a sourced statement** without reading the source. If the
   source says it, the conversation is about the source.
4. **A pattern is a conversation, not a batch.** Where one cause explains
   hundreds of hits, raise it with the editors who maintain that area
   (WikiProject Taxonomy on Wikidata, WikiProject Tree of Life on Wikipedia)
   before touching any of them.
5. **Wikidata before Wikipedia.** Wikidata edits are structured, small and
   easy to check. A Wikipedia edit changes prose people read; we do none until
   the Wikidata side has gone well for a while.
6. **Record every edit**, and look again a week later to see whether it stood.

## The loop

```bash
# 1. Find: what looks odd, offline, from our own data
python3 datagen/audit_dataset.py --dataset wikidata-parents-fixed --html audit.html

# 2. Confirm: re-ask live Wikidata, gather evidence, update the ledger
python3 datagen/upstream_check.py --dataset wikidata-parents-fixed --out leads.md

# 3. Fix by hand on wikidata.org, then record it
python3 datagen/upstream_check.py --mark bad-species-name:Q1956228 edited --note "<diff link>"

# 4. A later run of step 2 sees the fix live and marks the lead resolved

# 5. Pull fixes back into our caches, then rebuild as usual
python3 datagen/scraper.py --min-sitelinks 6 --refresh-ledger
```

`upstream_leads.json` is the ledger and is committed: it is the one thing here
that cannot be regenerated, since it holds human decisions and the history of
what was fixed when. A lead is `confirmed`, `edited`, `dismissed` (a person
judged it not an error, and it is never raised again) or `resolved` (it no
longer reproduces on Wikidata, whoever fixed it). A run never overwrites a
human status or note, and resolves a lead only when it actually re-asked
Wikidata about that item. Resolved leads reopen if the error comes back, which
is how repeated vandalism shows itself.

Step 5 exists because the caches are never re-asked about anything they hold.
That keeps rebuilds cheap, but it also means a vandalised name, once scraped,
would stay in the game after Wikidata had been put right.

## Kinds of lead

| Kind | What it is | Found first |
|---|---|---|
| `binomial-on-higher-taxon` | A genus's taxon name (P225) is a binomial | Hippocamelus, renamed "Six seven" and then "Hippocamelus bisilcus" by a temporary account in May 2026 |
| `bad-species-name` | A species' taxon name is not a binomial | Oreochromis lidole, renamed "something about fish" by an IP in March 2023; the emperor newt's name has a non-breaking space from a 2013 bot import |

A new kind belongs in `upstream_check.py` only when the right value can be read
off the item itself. If finding it needs judgement, it is an audit check and
stays there.

## Patterns, not edits

**Group words as common names** (`group-noun-common-name` in the ledger). About
1,000 species in the Full dataset carry a bare group word ("Snake",
"Triggerfish", "Cichlid") among their English names. 774 cite the IUCN Red List
and 74 ARKive, both bulk imports, so the sources really do say it. Some are
genuine names (the British moths "Chestnut" and "Peacock" from the Belgian
Species List). The game no longer shows these where a better name exists (see
`scraper.display_names`). Upstream, the useful step is a note on WikiProject
Taxonomy with these counts, not removals.

## Other leads, not yet worked

From `audit_dataset.py` on the Full dataset, Oct 2026. Each needs taxonomic
judgement, so none is in the ledger.

| Lead | Hits | Note |
|---|---:|---|
| No photo anywhere | 1,783 | Species whose Wikipedia picture is a range map and whose Wikidata item has no image. The real gap is a photograph on Commons. |
| Binomial filed under another genus | 164 | Mostly a renamed species whose old name's item is still live |
| Same animal as two items | 126 | Wikidata keeps one item per *name* on purpose; the fix is marking the old name a synonym |
| Rank contradicts the tree | 233 | |
| Taxon whose article is about another rank | 125 | Often an obsolete genus whose title redirects to its one species |

## Edits made

| Date | Lead | Diff | Stood a week later? |
|---|---|---|---|
| | | | |

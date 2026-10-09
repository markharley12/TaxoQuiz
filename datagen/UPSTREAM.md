# Fixing what we find, upstream

TaxoQuiz is built from Wikidata and Wikipedia, so reading 41,000 species through
a game turns up their mistakes. This file holds the rules for acting on them and
describes the loop that keeps track.

## Wikidata and Wikipedia are different things

They are easy to confuse, and which one a mistake lives in decides who fixes
it and how.

| | **Wikidata** (wikidata.org) | **Wikipedia** (en.wikipedia.org) |
|---|---|---|
| What it is | A database of facts, one *item* per thing, each with an ID like Q140 | An encyclopedia of articles, written as prose |
| One entry looks like | Q140: taxon name *Panthera leo*, rank species, parent taxon Q127960, English common name "lion", image "Lion waiting in Namibia.jpg" | The article "Lion": paragraphs, an infobox, references |
| Languages | One item serves every language | Each language is a separate wiki with separate articles |
| How they connect | An item lists its articles in each Wikipedia ("sitelinks") | An article belongs to one item |
| Edited by | Statements, one at a time, each optionally with a reference | Text, with talk pages and stricter norms |
| What TaxoQuiz takes | **The tree itself**: which species exist, their names, ranks, parents, common names, and the replacement photo (P18) | **The popup**: the summary text and the infobox picture |

So: a wrong name, a wrong parent, a species in the tree twice, or "Snake" as a
common name is **Wikidata**. A popup describing the wrong animal, or a range
map where a photo should be, is **Wikipedia**, though the wrong-animal case is
often a Wikidata *sitelink* pointing at the wrong article. Fixing an item on
Wikidata changes it for every language's Wikipedia at once, which is both why
it is worth doing and why it deserves care.

A third kind of source sits behind both: **taxonomic authorities**, the
databases specialists keep for one group. The Reptile Database for reptiles,
WoRMS for marine species, the Mammal Diversity Database, Amphibian Species of
the World, the bird lists. Wikidata often records each one's ID for an item.
The **Catalogue of Life** assembles them into one list and says which
authority each answer came from, which is how `datagen/authorities.py` asks
them. Where Wikidata is ambiguous, the authority for that group is the closest
thing to a source of truth. It can lag too (see below), so it is a second
opinion, never the only one.

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
| `genus-unlike-its-species` | A genus's taxon name differs from the word all its species start with, and its own label or article title is that word | *Sepia*, renamed "Sapia" by a temporary account in May 2026, over 34 cuttlefish; caught by its species, since "Sapia" looks like a fine Latin name |
| `disputed-synonym-link` (review) | Wikidata calls species B species A's synonym or original combination, and the group's authority holds them distinct | *Calomys lepidus*, a vesper mouse, claiming the woodrat *Neotoma lepida*; 31 in the game's species |

A `confirmed` kind must be provable from the item itself. A `review` kind may
rest on an outside authority's word, and says so in its evidence, with links to
that authority's own page for the species. If finding it needs taxonomic
judgement beyond that, it is an audit check and stays there.

## Patterns, not edits

**Group words as common names** (`group-noun-common-name` in the ledger). About
1,000 species in the Full dataset carry a bare group word ("Snake",
"Triggerfish", "Cichlid") among their English names. 774 cite the IUCN Red List
and 74 ARKive, both bulk imports, so the sources really do say it. Some are
genuine names (the British moths "Chestnut" and "Peacock" from the Belgian
Species List). The game no longer shows these where a better name exists (see
`scraper.display_names`). Upstream, the useful step is a note on WikiProject
Taxonomy with these counts, not removals.

## Cross-referencing: two sources before the game changes

Where Wikidata says one species item is another under an older name (taxon
synonym P1420, original combination P1403, basionym P566, replaced synonym
P694), the build asks the Catalogue of Life about both names. Measured Oct 2026
on the 83 such links between species in the Full dataset:

| Outcome | Links | What happens |
|---|---:|---|
| Both agree: one name is the other's synonym | 27 | The synonym leaves the game; its English names join the accepted species |
| The authority holds the two distinct, often in different families | 32 | Nothing in the game. Most are wrong links on Wikidata, e.g. *Calomys lepidus*, a vesper mouse, claiming the woodrat *Neotoma lepida* as its original combination |
| Unsettled: subgenus disputes, unknown names, the authority disagreeing with Wikidata | 24 | Nothing. Three are birds where COL's source (ITIS) is behind the bird lists, so the authority is the one that is out of date |

The rule is that the game changes only when two independent sources agree.
Neither is trusted alone: the GBIF backbone, tried first, still lists the
Nilgiri tahr under *Hemitragus*, two decades after the split.

Where we fall short of an authority's own answer, the specialist database is
the place to look. For a reptile, that is the Reptile Database itself, and its
ID on the Wikidata item (P5473) links straight to the entry.

## Other leads, not yet worked

From `audit_dataset.py` on the Full dataset, Oct 2026. Each needs taxonomic
judgement, so none is in the ledger.

| Lead | Hits | Note |
|---|---:|---|
| No photo anywhere | 1,783 | Species whose Wikipedia picture is a range map and whose Wikidata item has no image. The real gap is a photograph on Commons. |
| Binomial filed under another genus | 162 | The Catalogue of Life, Oct 2026: 44 are old names whose current name is in the genus they hang from (*Dasyatis americana* under *Hypanus*), 83 it accepts as named (often a genus Wikidata split that the authority has not), 29 point elsewhere again (the *Sepia* cuttlefish, now split into several genera). One item per name is Wikidata's convention, so these are taxonomic questions, not edits. The audit quotes the authority's answer |
| Same animal as two items | 126 | Wikidata keeps one item per *name* on purpose; the fix is marking the old name a synonym |
| Rank contradicts the tree | 233 | |
| Taxon whose article is about another rank | 125 | Often an obsolete genus whose title redirects to its one species |

Every account behind a confirmed vandal edit so far made that edit and nothing
else (checked Oct 2026 with `list=usercontribs`), so there was no spree to
follow.

## Edits made

| Date | Lead | Diff | Stood a week later? |
|---|---|---|---|
| | | | |

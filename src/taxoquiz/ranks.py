"""Taxonomic rank as a position on a 0..1 ladder, for colouring.

Why this exists
---------------
The colour scale used to divide an LCA's **depth** by a per-dataset anchor. That
is absolute, which is right, but depth is not comparable across lineages in a
Wikidata tree: a fish at 16 and a bird at 65 are each a whole species' worth of
history, so no single absolute depth can serve both. Measured on the 41,167
species scrape, a *winning* guess — which scores the secret's own depth — had a
median warmth of 0.49, olive. Over half of all games could never look warm
however well they were played, and only 27% could reach 0.9.

Rank is the fix, and it stays absolute. Sharing a genus means the same thing
everywhere in the tree, so the same guess quality gets the same colour whatever
lineage it is in — and a correct guess is always a species-level match, so every
game can now reach the top of the scale. There is no per-dataset anchor at all:
the example and a scrape colour identically, because Genus means Genus in both.

This is deliberately NOT normalised against the secret's own depth or rank,
however tidy that would look: it would leak where the secret sits, which the
`???` node exists to hide.

The ladder
----------
`LEVELS` places each rank on a Linnaean ladder with the majors on the integers,
kingdom at 0 and species at `SPECIES_LEVEL`, and the affixed variants nudged off
them (sub- below, super- above, infra- below sub-, and so on). The exact
fractions carry no information beyond ordering — what matters is that Genus
lands near the top, Family in the upper middle, Class low, and Kingdom at the
floor, in every dataset.

Ranks above kingdom (domain, life) sit below 0 and clamp there: everything in a
dataset rooted at Animalia shares the kingdom, so "you share a kingdom" is the
coldest thing that can be said, not a distinction worth gradient.

Ranks whose position depends on the nomenclatural code are **deliberately absent**
(Sep 2026): division, subdivision, section, subsection, series, subseries. Their
botanical meanings are what a Linnaean table usually lists — division as the
plant phylum, section and series just below genus — and in zoology the same
words are used for supra-ordinal groups. Measured on the Sep 2026 scrape:
`Ctenosquamata` is a *section* holding 4,482 nodes, `Acanthomorphata` a
*subsection* holding 4,399, `Acanthopterygii` a *division* holding 4,398 — all
of them fish groups below class. On the botanical readings they scored 0.90,
0.92 and 0.17. Guessing any two acanthomorph fish would have come out
near-perfect green, and the correct answer would have been *colder* than the
wrong ones.

There is no right constant for a word that means two things, so they are left
unranked and interpolated from the tree, which does know where they sit. This is
the same lesson as `RANK_LABELS` in the scraper (see CLAUDE.md): a hand-written
answer in front of the evidence wins even where it is wrong.

Unranked nodes
--------------
Modern taxonomy is full of unranked clades, and they are not a rounding error
here: they are 17-24% of the lowest common ancestors between two random species,
because the few that exist sit high in the tree where random lineages meet. So
they cannot simply be dropped or floored.

`rank_levels` interpolates them. A clade between a ranked ancestor and a ranked
descendant is placed proportionally along the gap by how many steps separate it
from each — so a chain of clades between a Class and an Order fans out evenly
between the two rather than piling up on either. The descendant side takes the
*broadest* rank found below, so a clade is never warmer than the coldest thing
beneath it.

A note on the source data
-------------------------
This only works because a dataset's ranks are trustworthy, and until Sep 2026
they were not: a hardcoded map in `datagen/scraper.py` mislabelled 15 of the 23
rank Q-IDs it covered, which put 355 beetle superfamilies in the tree as
"Subkingdom". Reading rank as a position in the hierarchy is exactly what such
errors break — the share of parent-to-child edges whose child rank is broader
than its parent's was 2.65% then and is 0.13% now. See CLAUDE.md.
"""

# Kingdom at 0, species at 6. Divided through by SPECIES_LEVEL to give the
# 0..1 warmth. Keys are lower-cased on lookup, since the example fixture stores
# ranks in title case and a scrape stores whatever Wikidata's label says.
LEVELS: dict[str, float] = {
    # above kingdom — clamped to 0 in practice, present so they are not
    # mistaken for unranked and interpolated
    "life": -1.0, "domain": -0.5, "realm": -0.5, "superkingdom": -0.2,
    # kingdom
    "kingdom": 0.0, "subkingdom": 0.3, "infrakingdom": 0.5,
    # phylum (and its botanical spelling)
    "superphylum": 0.8, "phylum": 1.0, "subphylum": 1.3, "infraphylum": 1.5,
    "microphylum": 1.6,
    # class
    "megaclass": 1.75, "superclass": 1.85, "class": 2.0, "subclass": 2.3,
    "infraclass": 2.5, "parvclass": 2.55, "subterclass": 2.6,
    # cohort — sits between class and order
    "megacohort": 2.62, "supercohort": 2.66, "cohort": 2.70,
    "subcohort": 2.75, "infracohort": 2.80,
    # order
    "magnorder": 2.85, "grandorder": 2.88, "mirorder": 2.90, "superorder": 2.95,
    "order": 3.0, "suborder": 3.3, "infraorder": 3.5, "parvorder": 3.6,
    "nanorder": 3.7, "hyporder": 3.75,
    # family
    "superfamily": 3.9, "epifamily": 3.95, "family": 4.0, "subfamily": 4.3,
    # tribe
    "supertribe": 4.45, "tribe": 4.5, "subtribe": 4.6,
    # genus
    "genus": 5.0, "subgenus": 5.3,
    # species
    "species group": 5.7, "species subgroup": 5.75, "species": 6.0,
    "subspecies": 6.0, "variety": 6.0, "form": 6.0,
}

SPECIES_LEVEL = 6.0


def level_of(rank: str | None) -> float | None:
    """The ladder level for a rank name, or None if it is unranked.

    None covers three cases that all want the same treatment: an explicit
    "clade", a rank this ladder has never heard of, and no rank at all. All
    three are things whose position must come from the tree instead.
    """
    if not rank:
        return None
    return LEVELS.get(rank.strip().lower())


def _to_warmth(level: float) -> float:
    """Ladder level to the 0..1 the colour scale wants."""
    return min(max(level / SPECIES_LEVEL, 0.0), 1.0)


def believed_levels(tree: dict) -> dict[int, float | None]:
    """Each node's ladder level, or None where its rank is not believed.

    A rank label is a *claim*, and the tree is the evidence it can be checked
    against: a suborder cannot contain a phylum, and a subsection cannot contain
    an order. Wikidata asserts both. So a level is used only where it is
    consistent with every ranked node above and below it, and every rejected
    claim falls through to the interpolation that already handles clades.

    **Strictly between, and both sides raw.** A node is believed when its level
    is strictly greater than every ranked *ancestor*'s and strictly less than
    every ranked *descendant*'s. Three deliberate choices in that:

    * **Both directions, against raw labels rather than surviving ones.** An
      earlier version believed the shallower claim and judged the deeper one
      against it, which blames the wrong node whenever the error is up the tree:
      Wikidata ranks `Tetrapodomorpha` a subclass, and it contains the class
      Mammalia, so trusting the ancestor rejected *Mammalia* and flattened
      everything from the tetrapods to the therians onto one value — human and
      lion scored exactly what human and chicken did. Distrusting both ends of a
      contradiction costs a label and keeps the ordering, which is the only
      thing the colour scale reads.
    * **Ties are rejected too.** Wikidata nests same-rank nodes freely —
      `Bilateria` is a subkingdom inside the subkingdom `Eumetazoa` — and equal
      levels would say a human and a wasp are exactly as related as a human and
      a coral. The tree says one contains the other, so interpolation is asked
      for a strictly warmer value.
    * **A leaf is always believed.** Leaves are the species, they must reach the
      top of the scale, and a species nested under a species (Wikidata has
      synonym pairs like `Ammodramus bairdii` under `Centronyx bairdii`) would
      otherwise reject the only rank that is certain.

    Measured: 0 claims rejected in the packaged example, 0.3% in the Sep 2026
    scrape, 6.5% in the scrape from before the `RANK_LABELS` repair — which is
    the number to watch. A dataset that rejects a lot has rotten ranks upstream,
    and `datagen/validate_dataset.py` reports the share for that reason.
    """
    par_max: dict[int, float | None] = {}
    min_desc: dict[int, float | None] = {}
    raw: dict[int, float | None] = {}

    def down(node: dict, best: float | None) -> None:
        raw[id(node)] = own = level_of(node.get("rank"))
        par_max[id(node)] = best
        deeper = best if own is None else (own if best is None else max(best, own))
        for child in node.get("children") or []:
            down(child, deeper)

    down(tree, None)

    def up(node: dict) -> float | None:
        best: float | None = None
        for child in node.get("children") or []:
            for cand in (up(child), raw[id(child)]):
                if cand is not None and (best is None or cand < best):
                    best = cand
        min_desc[id(node)] = best
        return best

    up(tree)

    believed: dict[int, float | None] = {}

    def judge(node: dict) -> None:
        own = raw[id(node)]
        keep = own
        if own is not None and (node.get("children") or []):
            above, below_ = par_max[id(node)], min_desc[id(node)]
            if (above is not None and own <= above) or (below_ is not None and own >= below_):
                keep = None
        believed[id(node)] = keep
        for child in node.get("children") or []:
            judge(child)

    judge(tree)
    return believed


def rank_levels(tree: dict) -> dict[str, float]:
    """Map every node name in `tree` to its warmth, 0..1.

    Believed ranks read straight off the ladder. Everything else — an explicit
    clade, an unknown rank, and now a rank the tree contradicts — is
    interpolated between the nearest ranked ancestor and the broadest ranked
    descendant, by how many steps they sit from each.
    """
    out: dict[str, float] = {}
    believed = believed_levels(tree)

    def level_of_node(node: dict) -> float | None:
        return believed[id(node)]

    # Pass 1, bottom-up: for each node, the broadest ranked level anywhere below
    # it, and how many steps down that is. Broadest rather than nearest, so a
    # clade is never placed warmer than the coldest thing beneath it.
    below: dict[int, tuple[float, int] | None] = {}

    def broadest_below(node: dict) -> tuple[float, int] | None:
        best: tuple[float, int] | None = None
        for child in node.get("children") or []:
            # Recurse first and unconditionally: every node needs an entry of
            # its own, including the ranked ones this loop could answer without
            # descending. Skipping them left an unranked node under a ranked
            # parent with no entry at all, so it silently took its ancestor's
            # level instead of interpolating.
            deeper = broadest_below(child)
            own = level_of_node(child)
            if own is not None:
                cand: tuple[float, int] | None = (own, 1)
            else:
                cand = None if deeper is None else (deeper[0], deeper[1] + 1)
            if cand is not None and (best is None or cand[0] < best[0]):
                best = cand
        below[id(node)] = best
        return best

    broadest_below(tree)

    # Pass 2, top-down: carry the nearest ranked ancestor's level and distance.
    def walk_down(node: dict, anc: float, steps: int, floor: float) -> None:
        own = level_of_node(node)
        if own is not None:
            value = _to_warmth(own)
            anc, steps = own, 0
        else:
            steps += 1
            found = below.get(id(node))
            if found is None:
                # Nothing ranked below either: keep it where its ancestor is.
                value = _to_warmth(anc)
            else:
                desc, down = found
                # Place it along the gap by how far it sits from each end.
                frac = steps / (steps + down)
                value = _to_warmth(anc + (desc - anc) * frac)
            # Never colder than the parent. Two interpolated nodes in a row can
            # otherwise cross by a hair — each is placed against the broadest
            # rank below *it*, and the child's is reached from a different
            # distance — which showed up as 8 inversions of ~0.003 on the Sep
            # 2026 scrape. This cannot paper over a bad rank: a believed rank is
            # already >= its nearest believed ancestor by the check above, and an
            # interpolated node always lands strictly below the broadest ranked
            # node beneath it, so it can never overtake a believed descendant.
            value = max(value, floor)
        out[node["name"]] = value
        for child in node.get("children") or []:
            walk_down(child, anc, steps, value)

    walk_down(tree, 0.0, 0, 0.0)
    return out

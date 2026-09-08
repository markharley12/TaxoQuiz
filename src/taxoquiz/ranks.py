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
    "superdivision": 0.8, "division": 1.0, "subdivision": 1.3,
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
    "genus": 5.0, "subgenus": 5.3, "section": 5.4, "subsection": 5.5,
    "series": 5.6, "subseries": 5.65,
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


def rank_levels(tree: dict) -> dict[str, float]:
    """Map every node name in `tree` to its warmth, 0..1.

    Ranked nodes read straight off the ladder. Unranked ones are interpolated
    between the nearest ranked ancestor and the broadest ranked descendant, by
    how many steps they sit from each.
    """
    out: dict[str, float] = {}

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
            own = level_of(child.get("rank"))
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
    def walk_down(node: dict, anc: float, steps: int) -> None:
        own = level_of(node.get("rank"))
        if own is not None:
            out[node["name"]] = _to_warmth(own)
            anc, steps = own, 0
        else:
            steps += 1
            found = below.get(id(node))
            if found is None:
                # Nothing ranked below either: keep it where its ancestor is.
                out[node["name"]] = _to_warmth(anc)
            else:
                desc, down = found
                # Place it along the gap by how far it sits from each end.
                frac = steps / (steps + down)
                out[node["name"]] = _to_warmth(anc + (desc - anc) * frac)
        for child in node.get("children") or []:
            walk_down(child, anc, steps)

    walk_down(tree, 0.0, 0)
    return out

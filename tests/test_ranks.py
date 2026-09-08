"""Tests for the rank ladder — what the trees are coloured by.

The property that matters is not "a number comes out" but that the *same
taxonomic fact gets the same colour everywhere*. That is the whole reason the
scale moved off depth: depth is not comparable across lineages, so on the
41,167-species scrape a same-family guess scored anywhere from 0.10 to 1.00
depending on which branch it sat in, and a winning guess had a median of 0.49 —
olive — with only 26% of games able to reach 0.9 at all.

Each test below names the failure it guards rather than restating the ladder.
"""
import pytest

from taxoquiz.ranks import LEVELS, SPECIES_LEVEL, level_of, rank_levels


def tree(rank, *children, name=None):
    """A node with a rank and children, named after its rank unless told."""
    node = {"name": name or rank, "rank": rank}
    if children:
        node["children"] = list(children)
    return node


# --------------------------------------------------------------------------
# The ladder
# --------------------------------------------------------------------------

def test_the_major_ranks_are_evenly_ordered_from_kingdom_to_species():
    """The reading a player is asked to do: closer rank, warmer colour.

    Every one of these is a rung someone can name, and they have to come out in
    the order a schoolchild would put them in.
    """
    ladder = ["kingdom", "phylum", "class", "order", "family", "genus", "species"]
    warmths = [level_of(r) / SPECIES_LEVEL for r in ladder]
    assert warmths == sorted(warmths)
    assert warmths[0] == 0.0
    assert warmths[-1] == 1.0
    # Evenly spaced, so no single step dominates the gradient.
    steps = [round(b - a, 6) for a, b in zip(warmths, warmths[1:])]
    assert len(set(steps)) == 1


@pytest.mark.parametrize("broad, narrow", [
    ("superfamily", "family"),
    ("family", "subfamily"),
    ("subfamily", "tribe"),
    ("class", "subclass"),
    ("suborder", "infraorder"),
    ("genus", "subgenus"),
    ("order", "family"),
])
def test_an_affixed_rank_sits_on_the_right_side_of_its_major(broad, narrow):
    """sub- is narrower than its major and super- is broader.

    Getting one of these backwards is invisible in a unit test of the majors
    and very visible on screen, where a subfamily would read colder than the
    family containing it.
    """
    assert level_of(broad) < level_of(narrow)


def test_an_unknown_rank_is_unranked_rather_than_zero():
    """Wikidata has a long tail, and new ranks will appear.

    Returning 0.0 for an unrecognised name would paint it kingdom-red and look
    deliberate. None means "ask the tree where this sits", which is what the
    interpolation is for.
    """
    assert level_of("hemidemisemiorder") is None
    assert level_of("clade") is None
    assert level_of(None) is None
    assert level_of("") is None


def test_rank_names_are_matched_case_insensitively():
    """The example fixture stores "Species" and a scrape stores "species".

    Both are on screen at once in a mixed dataset, and a case-sensitive lookup
    would silently treat one of them as unranked.
    """
    assert level_of("Species") == level_of("species") == SPECIES_LEVEL
    assert level_of("  Genus  ") == level_of("genus")


def test_ranks_above_kingdom_clamp_to_the_cold_end():
    """Everything in a dataset rooted at Animalia shares the kingdom.

    So "you share a kingdom" is the coldest thing that can be said, not a
    distinction worth spending gradient on. Domain and life are in the ladder
    as negatives so they are not mistaken for unranked and interpolated.
    """
    assert LEVELS["domain"] < LEVELS["kingdom"]
    levels = rank_levels(tree("life", tree("kingdom", tree("species"))))
    assert levels["life"] == 0.0
    assert levels["kingdom"] == 0.0


# --------------------------------------------------------------------------
# Unranked clades
# --------------------------------------------------------------------------

def test_a_clade_is_placed_between_the_ranks_around_it():
    """Unranked clades are 17-24% of the LCAs between two random species.

    Not a rounding error, because the few that exist sit high in the tree where
    random lineages meet. Flooring them at 0 or dropping them would mis-colour
    a quarter of all guesses.
    """
    levels = rank_levels(tree("class", tree("clade", tree("order"))))
    assert levels["class"] < levels["clade"] < levels["order"]


def test_a_chain_of_clades_fans_out_instead_of_piling_up():
    """Wikidata gives long unranked chains — 98 of 165 clades in the Sep 2026
    scrape have a clade for a parent. Placing each at its ancestor's level, or
    all of them at the midpoint, would render the chain as one flat colour.
    """
    levels = rank_levels(
        tree("class", tree("clade", tree("clade", tree("clade", tree("order")),
                                        name="c2"), name="c1"))
    )
    chain = [levels["class"], levels["c1"], levels["c2"], levels["clade"], levels["order"]]
    assert chain == sorted(chain)
    assert len(set(chain)) == len(chain)


def test_a_clade_under_a_ranked_parent_still_interpolates():
    """Regression: the bottom-up pass only recorded nodes it descended into.

    A ranked child was answered without recursing, so an unranked node beneath
    one had no entry at all and silently took its ancestor's level — reading as
    the same colour as its parent rather than as a step below it.
    """
    levels = rank_levels(tree("kingdom", tree("superclass", tree("clade", tree("class")))))
    assert levels["clade"] > levels["superclass"]


def test_a_clade_takes_the_broadest_rank_below_it_not_the_nearest():
    """A clade must never be warmer than the coldest thing beneath it.

    With a genus on one side and an order on the other, reading the nearest
    would place the clade below a genus and above the order it also contains.
    """
    levels = rank_levels(tree("class", tree("clade", tree("genus"), tree("order"))))
    assert levels["clade"] < levels["order"]


def test_a_clade_with_nothing_ranked_below_stays_where_its_ancestor_is():
    """No information to interpolate against, so it must not invent any."""
    levels = rank_levels(tree("family", tree("clade", tree("clade", name="deeper"))))
    assert levels["clade"] == levels["deeper"] == levels["family"]


# --------------------------------------------------------------------------
# Whole datasets
# --------------------------------------------------------------------------

def test_every_species_in_the_example_is_at_the_top_of_the_scale(example_tree):
    """The headline of the change: every game can now be won to full green.

    A correct guess has the secret itself as the LCA, so it is a species-level
    match and scores 1.0 whatever lineage it is in. Under the old depth scale a
    winning guess scored the secret's depth over a per-dataset anchor, which on
    the scrape was a median of 0.49.
    """
    levels = rank_levels(example_tree)

    def species(node):
        if not node.get("children"):
            yield node["name"]
        for child in node.get("children", []):
            yield from species(child)

    warmths = {levels[name] for name in species(example_tree)}
    assert warmths == {1.0}


def test_a_rank_gets_the_same_warmth_whatever_dataset_it_is_in(example_tree):
    """The property a depth scale could not have.

    The example is 18 deep and a scrape is 80, so the same clade sat at a
    different point on the gradient in each. A rank is a rank: Felidae is a
    family here and a family there, and both must paint the same colour.
    """
    levels = rank_levels(example_tree)
    tiny = rank_levels(tree("kingdom", tree("family", tree("species"))))
    assert levels["Felidae"] == tiny["family"]
    assert levels["Animalia"] == tiny["kingdom"]


def test_the_example_ladder_never_runs_backwards_down_a_lineage(example_tree):
    """A child must not be colder than its parent, or a closer guess renders
    further away — the exact reading the tree exists to support.

    The example fixture is hand-curated and clean. A Wikidata scrape is not
    quite: 0.13% of its edges invert, which is a data property rather than a
    bug here, and was 2.65% before the rank labels were fixed.
    """
    levels = rank_levels(example_tree)

    def walk(node):
        for child in node.get("children", []):
            assert levels[child["name"]] >= levels[node["name"]], (
                f"{child['name']} ({child.get('rank')}) is colder than "
                f"{node['name']} ({node.get('rank')})"
            )
            walk(child)

    walk(example_tree)

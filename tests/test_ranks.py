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

    This now holds for *any* tree, not only this clean one: a rank that
    contradicts the tree around it is not believed, and interpolation is floored
    at the parent. Measured on the Sep 2026 scrape, whose raw labels invert on
    0.16% of edges and inverted on 2.67% before the rank labels were repaired:
    zero inversions survive into warmth. `datagen/validate_dataset.py` is what
    checks that against a whole dataset.
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


# --------------------------------------------------------------------------
# Believing a rank — the tree as evidence against the label
# --------------------------------------------------------------------------
# Every case here is one that actually reached a screen. See `believed_levels`.

def test_a_rank_broader_than_what_it_contains_is_not_believed():
    """Wikidata files Deuterostomia as a *suborder*, and it contains a phylum.

    Taken at face value that is level 3.3 — a human-and-starfish guess coming
    out warmer than a shared family, and warmer than the phylum beneath it.

    What is pinned is the *ordering*, not a number: the contradiction costs both
    labels, so the phylum is interpolated too, and both land back in the order
    the tree says they nest in.
    """
    t = tree("kingdom", tree("suborder", tree("phylum", tree("class")),
                             name="Deuterostomia"))
    levels = rank_levels(t)
    assert (levels["kingdom"] < levels["Deuterostomia"] < levels["phylum"]
            < levels["class"])
    assert levels["Deuterostomia"] < level_of("suborder") / SPECIES_LEVEL


def test_a_contradiction_costs_both_ends_and_not_just_the_deeper_one():
    """The blame question, and the reason both directions are checked raw.

    Wikidata ranks Tetrapodomorpha a *subclass* and it contains the class
    Mammalia. Believing the ancestor and judging the descendant against it
    rejected Mammalia and flattened 26 nodes onto one value: a human and a lion
    scored exactly what a human and a chicken did. Distrusting both keeps the
    ordering, which is the only thing the colour scale reads.
    """
    t = tree("superclass",
             tree("subclass",
                  tree("clade", tree("class", tree("order")), name="amniote"),
                  name="stem"))
    levels = rank_levels(t)
    assert levels["superclass"] < levels["stem"] < levels["amniote"] < levels["class"]
    assert levels["class"] < levels["order"]


def test_nested_equal_ranks_are_separated_rather_than_tied():
    """Bilateria is a subkingdom inside the subkingdom Eumetazoa.

    Read literally they are the same warmth, so a human and a wasp come out
    exactly as related as a human and a coral. The tree says one contains the
    other, so the deeper one has to be warmer.
    """
    t = tree("kingdom",
             tree("subkingdom", tree("subkingdom", tree("phylum"), name="inner"),
                  name="outer"))
    levels = rank_levels(t)
    assert levels["outer"] < levels["inner"] < levels["phylum"]


def test_a_leaf_keeps_its_rank_even_under_an_identical_one():
    """Species are the top of the scale and must stay there.

    Wikidata carries synonym pairs nested as species under species
    (`Ammodramus bairdii` under `Centronyx bairdii`); the tie rule above would
    otherwise reject the one rank in the tree that is never in doubt.
    """
    t = tree("genus", tree("species", tree("species", name="leaf"), name="stem"))
    levels = rank_levels(t)
    assert levels["leaf"] == 1.0


def test_ranks_that_mean_two_things_are_left_off_the_ladder():
    """`division`, `section` and `series` are botanical ranks near phylum and
    genus, and zoological ranks for supra-ordinal groups.

    On the Sep 2026 scrape, `Acanthomorphata` is a *subsection* holding 4,399
    nodes and `Acanthopterygii` a *division* holding 4,398 — both fish groups
    below class. Placed by the botanical reading they scored 0.92 and 0.17, so
    two acanthomorph fish came out near-perfect green and the correct answer
    was colder than the wrong ones. There is no right constant for a word that
    means two things.
    """
    for ambiguous in ("division", "subdivision", "section", "subsection",
                      "series", "subseries"):
        assert level_of(ambiguous) is None, ambiguous

    # and the tree still places one, because it knows what it contains
    t = tree("class", tree("section", tree("order", tree("family")), name="big"))
    levels = rank_levels(t)
    assert levels["class"] < levels["big"] < levels["order"]


def test_deeper_is_strictly_warmer_even_down_a_long_unranked_chain():
    """Deeper must be strictly warmer, not merely no colder.

    The Sep 2026 rebuild put 20 clades in a row at exactly 0.312. A class one
    step down a sibling branch pulled each node's own estimate below its
    parent's, and clamping to the parent turned every one of them into a tie —
    so a crocodile and a frog scored the same against a bat, though Amniota sits
    inside Tetrapoda. This is that shape in miniature: `P` is placed against the
    class right below it, and every clade down the other branch sees its own
    class nine or ten steps away.
    """
    from taxoquiz.ranks import rank_levels

    chain = [f"C{i}" for i in range(8)]
    node = {"name": "K", "rank": "class", "children": [{"name": "K sp", "rank": "species"}]}
    for name in reversed(chain):
        node = {"name": name, "rank": "clade", "children": [node]}
    tree = {"name": "Chordata", "rank": "phylum", "children": [
        {"name": "P", "rank": "clade", "children": [
            {"name": "Near", "rank": "class", "children": [{"name": "Near sp", "rank": "species"}]},
            node,
        ]},
    ]}
    warmth = rank_levels(tree)
    values = [warmth[name] for name in ["Chordata", "P", *chain, "K"]]
    assert all(a < b for a, b in zip(values, values[1:])), values

"""Tests for `taxoquiz.game.game_state` — the annotated display tree.

This is the whole game: given a secret and some guesses, return a tree that says
how warm each guess is and hints at where the secret lives without saying how
deep it is. Three properties matter and none of them announce themselves when
broken:

- `lca_depth` is the score, and the frontend colours by it.
- The `???` node reveals the *branch* and not the depth.
- Guesses are addressed by common name but the tree is keyed by scientific
  name, and the two are not interchangeable.

Assertions run against both the tiny fixture (for exact numbers) and the bundled
example (for a real taxonomy's shape).
"""
import pytest

from taxoquiz.game.game_state import get_game_state

from conftest import TINY_TREE


def flatten(node, out=None):
    """Every node of a display tree, keyed by label."""
    out = {} if out is None else out
    out[node["label"]] = node
    for child in node["children"]:
        flatten(child, out)
    return out


def state(secret, *guesses, dataset=None):
    return get_game_state(secret, list(guesses), dataset=dataset)


# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------

def test_lca_depth_is_the_depth_of_the_shared_ancestor(tiny):
    """`one` and `two` share LeftA at depth 2; `one` and `four` share Root at 0."""
    nodes = flatten(state("one", "two", "four", dataset=tiny))
    assert nodes["two"]["lca_depth"] == 2
    assert nodes["four"]["lca_depth"] == 0


def test_a_closer_relative_scores_higher(tiny):
    """The ordering is the game. `three` shares Left (1), `two` shares LeftA (2)."""
    nodes = flatten(state("one", "two", "three", "four", dataset=tiny))
    assert nodes["two"]["lca_depth"] > nodes["three"]["lca_depth"] > nodes["four"]["lca_depth"]


def test_guessing_the_secret_scores_its_own_depth(tiny):
    """The LCA of a lineage with itself is the leaf, so the score maxes out."""
    nodes = flatten(state("one", "one", dataset=tiny))
    assert nodes["one"]["lca_depth"] == 3


def test_lca_depth_on_a_real_taxonomy(example_tree):
    """Cats, wolves and humans against a lion, on the bundled example.

    Panthera(15) › Carnivora(11) › Boreoeutheria(9) — the ordering a player
    would expect, and the numbers the colour scale divides by.
    """
    nodes = flatten(state("lion", "tiger", "grey wolf", "human"))
    assert nodes["tiger"]["lca_depth"] == 15, "same genus, Panthera"
    assert nodes["grey wolf"]["lca_depth"] == 11, "same order, Carnivora"
    assert nodes["human"]["lca_depth"] == 9, "Boreoeutheria and no closer"


def test_a_guess_score_does_not_depend_on_the_other_guesses(example_tree):
    """Each guess is scored against the secret alone.

    The colour scale is absolute for the same reason: a node must not change
    warmth because of something guessed later.
    """
    alone = flatten(state("lion", "human"))["human"]["lca_depth"]
    crowded = flatten(state("lion", "tiger", "human", "grey wolf"))["human"]["lca_depth"]
    assert alone == crowded


# --------------------------------------------------------------------------
# The ??? node
# --------------------------------------------------------------------------

def test_the_marker_is_the_child_of_the_deepest_lca_on_the_secret_path(tiny):
    """Secret `one`, guess `four`: they part at Root, so ??? is Root's child
    on the secret's side — Left, not the secret itself."""
    nodes = flatten(state("one", "four", dataset=tiny))
    assert "???" in nodes
    assert nodes["???"]["depth"] == 1, "one level below the LCA at Root"
    assert "Left" not in nodes, "the branch is shown *as* the marker, not beside it"


def test_the_marker_moves_down_as_guesses_get_warmer(tiny):
    """It tracks the deepest LCA reached so far, which is what makes it a hint."""
    assert flatten(state("one", "four", dataset=tiny))["???"]["depth"] == 1
    assert flatten(state("one", "three", dataset=tiny))["???"]["depth"] == 2
    assert flatten(state("one", "two", dataset=tiny))["???"]["depth"] == 3


def test_the_marker_reveals_the_branch_and_never_the_depth(example_tree):
    """The reason it exists. A shallow guess must not say how deep the secret is.

    Human sits at depth 18; guessing an aardvark parts from it at Eutheria(8),
    so the marker lands at 9 and says nothing about the other nine levels.
    """
    nodes = flatten(state("human", "aardvark"))
    assert nodes["???"]["depth"] == 9
    # The guess's own lineage runs deeper than that and is shown in full, which
    # gives nothing away — it is the player's own aardvark. What must not run
    # deeper is the *secret's* side: the marker is the last thing on it.
    on_path = [n for n in nodes.values() if n["on_secret_path"]]
    assert max(n["depth"] for n in on_path) == 9


def test_the_marker_carries_no_name_to_look_up(tiny):
    """`name` is None on the marker — which is also what makes it unclickable,
    and what stops the hover preview fetching a picture of the answer."""
    marker = flatten(state("one", "four", dataset=tiny))["???"]
    assert marker["name"] is None
    assert marker["node_type"] == "secret"


def test_a_game_with_no_guesses_yet_returns_null(tiny):
    """Pinning current behaviour, which is a rough edge rather than a decision.

    With no guesses the display tree is the union of no lineages, so `_prune`
    drops the root and the whole thing comes back None — `null` over HTTP. The
    frontend never asks: it renders nothing until the first guess and guards the
    session-restore call on `guesses.length > 0`. So this is unreachable in the
    app rather than handled, and a root-only tree or a 400 would both be more
    honest answers than `null`.
    """
    assert get_game_state("one", [], dataset=tiny) is None


def test_winning_removes_the_marker(tiny):
    """The secret's lineage has nothing below it left to reveal."""
    nodes = flatten(state("one", "four", "one", dataset=tiny))
    assert "???" not in nodes
    assert nodes["one"]["node_type"] == "guess"


def test_the_marker_survives_a_wrong_guess_made_after_a_close_one(tiny):
    """It is the deepest LCA over all guesses, not the most recent one."""
    assert flatten(state("one", "two", "four", dataset=tiny))["???"]["depth"] == 3


# --------------------------------------------------------------------------
# Shape of the display tree
# --------------------------------------------------------------------------

def test_the_tree_is_pruned_to_the_guessed_lineages(tiny):
    """Nothing the player has not reached is on screen."""
    nodes = flatten(state("one", "four", dataset=tiny))
    assert set(nodes) == {"Root", "Right", "four", "???"}


def test_every_guess_appears_exactly_once_however_many_times_it_is_guessed(tiny):
    nodes = flatten(state("one", "two", "two", "two", dataset=tiny))
    assert sum(1 for n in nodes.values() if n["node_type"] == "guess") == 1


def test_a_guess_is_labelled_by_common_name_and_named_by_the_scientific_one(tiny):
    """They differ, and the info popup is keyed on `name`.

    Looking up by `label` only ever worked because ancestors happen to have
    label == name; for a guess it fetches the article for the wrong thing, or
    nothing.
    """
    guess = flatten(state("one", "two", dataset=tiny))["two"]
    assert guess["label"] == "two"
    assert guess["name"] == "Alpha two"


def test_an_ancestor_is_labelled_and_named_by_its_scientific_name(tiny):
    root = state("one", "two", dataset=tiny)
    assert root["label"] == root["name"] == "Root"
    assert root["node_type"] == "ancestor"


def test_on_secret_path_marks_the_secrets_lineage_and_only_that(tiny):
    """Secret `one` lives under Root › Left › LeftA. A guess of `two` shares all
    three, so all three are on the path — and Right, reached by no guess, is
    not on screen at all."""
    nodes = flatten(state("one", "two", dataset=tiny))
    # The marker is on the path by definition — it *is* the secret's next node.
    assert [n for n, v in nodes.items() if v["on_secret_path"]] == [
        "Root", "Left", "LeftA", "???",
    ]
    assert not nodes["two"]["on_secret_path"], "a guess off the lineage is not on it"


def test_the_secret_itself_is_not_shown_until_it_is_guessed(tiny):
    nodes = flatten(state("one", "two", dataset=tiny))
    assert "one" not in nodes


def test_depth_is_the_nodes_depth_in_the_full_tree_not_in_the_pruned_one(tiny):
    """The pruned tree drops branches but never renumbers. The frontend spaces
    rows by this, so a collapsed chain still reads as the distance it covers."""
    nodes = flatten(state("one", "two", dataset=tiny))
    assert [nodes[n]["depth"] for n in ("Root", "Left", "LeftA", "two")] == [0, 1, 2, 3]


def test_only_guesses_carry_an_lca_depth(tiny):
    """Ancestors and the marker have no score — colouring one would be
    meaningless, and colouring the marker would leak."""
    nodes = flatten(state("one", "four", dataset=tiny))
    assert "lca_depth" in nodes["four"]
    assert all("lca_depth" not in n for lbl, n in nodes.items() if lbl != "four")


def test_a_guess_is_scored_by_its_lca_rank_not_its_own(tiny):
    """`warmth` colours the tree; for a guess it must be the LCA's, not its own.

    Every guess is a species, so its own rank is 1.0 — colouring by that would
    paint every guess full green whether it was close or hopeless, which is the
    one number on screen a player is actually asked to compare.
    """
    nodes = flatten(state("one", "two", "four", dataset=tiny))
    # `two` shares genus LeftA with `one`; `four` shares only the root.
    assert nodes["two"]["lca_warmth"] > nodes["four"]["lca_warmth"]
    assert nodes["four"]["lca_warmth"] == 0.0        # Root is a Kingdom
    assert all("lca_warmth" not in n for lbl, n in nodes.items()
               if lbl not in ("two", "four"))


def test_a_correct_guess_reaches_the_top_of_the_scale(tiny):
    """The point of colouring by rank: every game can be won to full green.

    A correct guess has the secret itself as the LCA, so the match is
    species-level in any lineage. The old depth scale divided the secret's own
    depth by a per-dataset anchor, so on the Sep 2026 scrape a *winning* guess
    had a median warmth of 0.49 — olive — and only 26% of games could reach 0.9
    at all, however well they were played.
    """
    nodes = flatten(state("one", "one", dataset=tiny))
    assert nodes["one"]["lca_warmth"] == 1.0


def test_the_marker_is_coloured_by_how_far_you_got_not_by_what_it_is(tiny):
    """The ??? node takes its parent's warmth rather than its own rank's.

    Its own rank is usually Species, i.e. 1.0, so it would render greener than
    the closest real guess — reading as a node you had *found*, which is the one
    thing it is not — and it would say "the answer is exactly one rung below
    this". Its parent's warmth is already on screen on the parent, so this
    reveals nothing the tree did not show. ??? exists to reveal the branch, not
    the depth.
    """
    nodes = flatten(state("one", "two", dataset=tiny))
    assert nodes["???"]["warmth"] == nodes["LeftA"]["warmth"]
    assert nodes["???"]["warmth"] < 1.0


# --------------------------------------------------------------------------
# Failure modes and dataset isolation
# --------------------------------------------------------------------------

@pytest.mark.parametrize("secret,guesses", [
    ("no such animal", []),
    ("one", ["no such animal"]),
    ("Alpha one", []),
])
def test_an_unknown_name_raises(tiny, secret, guesses):
    """Including a *scientific* name — guesses are addressed by common name,
    and accepting both would make the index ambiguous."""
    with pytest.raises(ValueError, match="Unknown animal"):
        get_game_state(secret, guesses, dataset=tiny)


def test_two_datasets_are_indexed_separately_in_one_process(write_dataset):
    """A server holds several datasets at once; they must not share an index."""
    write_dataset("a", TINY_TREE)
    write_dataset("b", {"name": "Other", "rank": "Kingdom", "children": [
        {"name": "Genus", "rank": "Genus", "children": [
            {"name": "Sci x", "rank": "Species", "common_name": "x"},
            {"name": "Sci y", "rank": "Species", "common_name": "y"},
        ]},
    ]})

    assert state("one", "two", dataset="a")["label"] == "Root"
    assert state("x", "y", dataset="b")["label"] == "Other"
    with pytest.raises(ValueError):
        get_game_state("one", [], dataset="b")


def test_the_display_tree_does_not_mutate_the_loaded_tree(example_tree):
    """`_prune` builds fresh dicts — which is the only reason one parsed copy
    can be shared by every module."""
    import json
    before = json.dumps(example_tree, sort_keys=True)
    state("lion", "tiger", "human", "aardvark")
    assert json.dumps(example_tree, sort_keys=True) == before

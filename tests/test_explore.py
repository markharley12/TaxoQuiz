"""Tests for `taxoquiz.explore` — browsing the tree with the game taken out.

Explore's data problem is not the game's. `game_state` returns the union of a
handful of lineages; explore can be pointed at a root with 27,000 descendants,
so it serves slices. Two things carry that and both are easy to break quietly:

- The budget is a **node count spent breadth-first**, not a depth. Depth is the
  wrong knob on a real taxonomy, where three levels can be nine nodes or nine
  hundred depending on where you are standing.
- `truncated` is the client's only signal that opening a node needs another
  request. Wrong in one direction it makes a dead end you cannot click out of;
  wrong in the other it fires a round trip for children already in hand.
"""
import pytest

from taxoquiz import explore

from conftest import TINY_TREE


def names(node, out=None):
    out = set() if out is None else out
    out.add(node["name"])
    for child in node["children"]:
        names(child, out)
    return out


# --------------------------------------------------------------------------
# Slicing
# --------------------------------------------------------------------------

def test_a_slice_carries_the_counts_that_make_a_label_readable(tiny):
    """"Aves" and "Onychophora" look identical as labels; one holds a thousand
    species and the other three."""
    root = explore.subtree(dataset=tiny)
    assert root["species_count"] == 4
    assert root["node_count"] == 9, "every descendant including itself"
    assert root["child_count"] == 2


def test_depth_limits_the_levels_returned(tiny):
    one = explore.subtree(depth=1, budget=None, dataset=tiny)
    assert names(one) == {"Root", "Left", "Right"}


def test_the_budget_is_spent_breadth_first_and_stops_before_it_is_exceeded(tiny):
    """A whole level is taken or none of it — a half-expanded level would render
    as though the missing siblings did not exist."""
    # Root + its 2 children = 3. The next level adds 3 more, which a budget of 5
    # cannot cover, so it stops rather than taking part of it.
    assert names(explore.subtree(budget=5, dataset=tiny)) == {"Root", "Left", "Right"}
    assert len(names(explore.subtree(budget=6, dataset=tiny))) == 6


def test_a_budget_of_one_still_returns_the_root(tiny):
    assert names(explore.subtree(budget=1, dataset=tiny)) == {"Root"}


def test_no_budget_and_no_depth_returns_the_whole_subtree(tiny):
    """Supported on purpose — it is the honest answer to "what if I render
    everything?" — but it is a value you have to ask for."""
    whole = explore.subtree(depth=None, budget=None, dataset=tiny)
    assert len(names(whole)) == 9
    assert whole["truncated"] is False


def test_truncated_marks_exactly_the_nodes_with_children_left_behind(tiny):
    root = explore.subtree(depth=1, budget=None, dataset=tiny)
    assert root["truncated"] is False, "both its children are here"
    by_name = {c["name"]: c for c in root["children"]}
    assert by_name["Left"]["truncated"] is True
    assert by_name["Right"]["truncated"] is True


def test_a_leaf_is_never_truncated(tiny):
    whole = explore.subtree(depth=None, budget=None, dataset=tiny)
    leaves = []

    def walk(n):
        if not n["children"] and n["child_count"] == 0:
            leaves.append(n)
        for c in n["children"]:
            walk(c)

    walk(whole)
    assert len(leaves) == 4
    assert all(leaf["truncated"] is False for leaf in leaves)


def test_a_species_carries_its_common_name_and_a_taxon_does_not(tiny):
    whole = explore.subtree(depth=None, budget=None, dataset=tiny)
    left_a = whole["children"][0]["children"][0]
    assert "common_name" not in left_a
    assert left_a["children"][0]["common_name"] == "one"


def test_depth_is_absolute_not_relative_to_the_requested_root(tiny):
    """So a slice fetched from a subtree still lines up with the whole tree."""
    assert explore.subtree(root="LeftA", dataset=tiny)["depth"] == 2


def test_an_unknown_root_raises_rather_than_falling_back_to_the_tree_root(tiny):
    """Silently showing all of Animalia when you asked for Aves is worse than an
    error, because it looks like it worked."""
    with pytest.raises(ValueError, match="Unknown taxon"):
        explore.subtree(root="Nope", dataset=tiny)


# --------------------------------------------------------------------------
# Jumping
# --------------------------------------------------------------------------

def test_path_to_runs_from_the_root_down_inclusive(tiny):
    assert explore.path_to("Alpha one", dataset=tiny) == ["Root", "Left", "LeftA", "Alpha one"]


def test_path_to_the_root_is_just_the_root(tiny):
    assert explore.path_to("Root", dataset=tiny) == ["Root"]


def test_lineage_returns_the_spine_with_siblings_at_every_level(tiny):
    """One request rather than seventeen — and the siblings are what stop the
    destination arriving unmoored."""
    body = explore.lineage("Alpha one", dataset=tiny)
    assert body["path"] == ["Root", "Left", "LeftA", "Alpha one"]

    root = body["tree"]
    assert {c["name"] for c in root["children"]} == {"Left", "Right"}, "sibling kept"
    left = next(c for c in root["children"] if c["name"] == "Left")
    assert {c["name"] for c in left["children"]} == {"LeftA", "LeftB"}


def test_nodes_off_the_spine_come_back_shallow_and_truncated(tiny):
    """Enough to show the label and the size, without dragging in the rest."""
    body = explore.lineage("Alpha one", dataset=tiny)
    right = next(c for c in body["tree"]["children"] if c["name"] == "Right")
    assert right["children"] == []
    assert right["truncated"] is True
    assert right["species_count"] == 1, "but it still says how big it is"


def test_the_spine_itself_is_not_marked_truncated(tiny):
    """Its children are all present, so the client must not re-fetch them."""
    body = explore.lineage("Alpha one", dataset=tiny)
    assert body["tree"]["truncated"] is False


def test_the_destination_gets_a_real_slice_not_a_bare_label(tiny):
    """Landing on something with children to read is the point of jumping."""
    body = explore.lineage("LeftA", dataset=tiny)
    target = body["tree"]["children"][0]["children"][0]
    assert target["name"] == "LeftA"
    assert {c["name"] for c in target["children"]} == {"Alpha one", "Alpha two"}


def test_lineage_of_an_unknown_name_raises(tiny):
    with pytest.raises(ValueError, match="Unknown taxon"):
        explore.lineage("Nope", dataset=tiny)


# --------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------

def test_search_matches_scientific_and_common_names(tiny):
    assert [h["name"] for h in explore.search("alpha", dataset=tiny)] == ["Alpha one", "Alpha two"]
    assert [h["name"] for h in explore.search("three", dataset=tiny)] == ["Beta three"]


def test_search_puts_prefix_matches_first_then_the_larger_group(example_tree):
    """Typing "cani" offers the clades before an arbitrary species inside them.

    Among equal prefix matches the larger group wins, so Caniformia — the
    suborder, which holds the bears and seals as well — sorts above Canidae
    above Canis. That ordering is the feature: a short prefix is far more likely
    to be someone reaching for the group than for one animal in it.
    """
    hits = [h["name"] for h in explore.search("cani")]
    assert hits[:3] == ["Caniformia", "Canidae", "Canis"]

    by_name = {h["name"]: h for h in explore.search("cani")}
    first_species = next(i for i, n in enumerate(hits) if by_name[n]["is_species"])
    assert first_species > 2, "every clade comes before the first species"


def test_search_marks_which_hits_are_species(tiny):
    hits = {h["name"]: h["is_species"] for h in explore.search("a", dataset=tiny)}
    assert hits["Alpha one"] is True
    assert hits["LeftA"] is False


def test_search_honours_its_limit(example_tree):
    assert len(explore.search("a", limit=5)) == 5


def test_an_empty_query_matches_nothing_rather_than_everything(tiny):
    assert explore.search("", dataset=tiny) == []
    assert explore.search("   ", dataset=tiny) == []


def test_search_is_case_insensitive(tiny):
    assert explore.search("ALPHA", dataset=tiny) == explore.search("alpha", dataset=tiny)


# --------------------------------------------------------------------------
# Stats and dataset isolation
# --------------------------------------------------------------------------

def test_stats_describe_the_tree_the_ui_is_about_to_render(tiny):
    assert explore.stats(dataset=tiny) == {
        "root": "Root", "nodes": 9, "species": 4, "max_depth": 3,
    }


def test_node_count_is_what_a_full_expand_would_cost_not_the_species_count(example_tree):
    """The internal nodes are most of the tree, so species_count cannot answer
    "how much am I about to render?" — which is what the expand-all warning
    is checked against."""
    s = explore.stats()
    assert s["nodes"] == 1615 and s["species"] == 530
    assert s["nodes"] > s["species"]


def test_each_dataset_gets_its_own_index(write_dataset):
    write_dataset("a", TINY_TREE)
    write_dataset("b", {"name": "Elsewhere", "rank": "Kingdom", "children": [
        {"name": "Sci z", "rank": "Species", "common_name": "z"},
    ]})
    assert explore.stats(dataset="a")["root"] == "Root"
    assert explore.stats(dataset="b")["root"] == "Elsewhere"
    with pytest.raises(ValueError):
        explore.subtree(root="Root", dataset="b")

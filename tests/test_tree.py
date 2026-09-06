"""Tests for `taxoquiz.game.tree` — loading, caching, and the derived lookups.

The lookups here (`get_ancestors`, `rank_of`, `common_name_of`) exist because
the same information used to be *stored* alongside the tree, in a
`taxon_list.json` per dataset and a `rank` field per `taxon_info.json` entry.
Deriving them is only an improvement while they actually agree with the tree,
so that agreement is what these check.
"""
import json

import pytest

from taxoquiz.game import tree as tree_mod
from taxoquiz.game.tree import (
    common_name_of, get_ancestors, get_species, load_tree, qid_of, rank_of,
)
from taxoquiz.paths import example_tree_path

from conftest import TINY_TREE


def test_load_tree_returns_one_shared_copy_per_path(tmp_path):
    """The cache is what stops a 51MB scrape being parsed once per module.

    Three game modules call `load_tree` independently. Identity, not equality,
    is the property: equal-but-separate copies would still be three parses and
    three times the memory.
    """
    path = tmp_path / "tree.json"
    path.write_text(json.dumps(TINY_TREE))

    first = load_tree(path)
    second = load_tree(path)
    assert first is second

    # Keyed on the *resolved* path, so the same file reached by a different
    # spelling is still one copy.
    assert load_tree(tmp_path / "." / "tree.json") is first


def test_load_tree_caches_different_datasets_separately(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    a.write_text(json.dumps({"name": "A"}))
    b.write_text(json.dumps({"name": "B"}))
    assert load_tree(a)["name"] == "A"
    assert load_tree(b)["name"] == "B"


def test_get_species_returns_the_leaves_in_tree_order():
    species = get_species(TINY_TREE)
    assert [s["common_name"] for s in species] == ["one", "two", "three", "four"]


def test_get_ancestors_returns_every_node_with_children_parents_first():
    """This is the set `scrape_taxon_info.py` fetches, derived rather than stored."""
    assert [n["name"] for n in get_ancestors(TINY_TREE)] == [
        "Root", "Left", "LeftA", "LeftB", "Right",
    ]


def test_get_ancestors_of_a_leaf_is_empty():
    assert get_ancestors({"name": "Alpha one"}) == []


def test_ancestors_and_species_partition_the_tree(example_tree):
    """Every node is either a leaf or has children — nothing is in both or neither."""
    ancestors = {n["name"] for n in get_ancestors(example_tree)}
    species = {s["name"] for s in get_species(example_tree)}
    assert not ancestors & species
    assert len(ancestors) + len(species) == 1609, "the example's node count"


def test_rank_of_covers_every_node_not_just_the_taxa():
    ranks = rank_of(TINY_TREE)
    assert ranks["Root"] == "Kingdom"
    assert ranks["LeftA"] == "Genus"
    assert ranks["Alpha one"] == "Species", "a leaf has a rank like any other node"


def test_rank_of_matches_the_tree_for_every_node_of_the_example(example_tree):
    """The derived map must agree with the tree it was derived from, everywhere.

    `rank` used to be stored in taxon_info.json as well, where a second copy was
    free to disagree with the tree. This is the check that made the copy safe to
    delete.
    """
    ranks = rank_of(example_tree)

    def walk(node):
        assert ranks[node["name"]] == node.get("rank", ""), node["name"]
        for child in node.get("children", []):
            walk(child)

    walk(example_tree)


def test_common_name_of_maps_scientific_name_to_common_name():
    assert common_name_of(TINY_TREE) == {
        "Alpha one": "one", "Alpha two": "two",
        "Beta three": "three", "Gamma four": "four",
    }


def test_qid_of_skips_nodes_without_one():
    """A hand-curated tree has no Q-IDs at all, which must not be an error."""
    assert qid_of(TINY_TREE) == {"LeftA": "Q100"}


def test_the_bundled_example_has_no_qids_and_that_is_fine(example_tree):
    """Q-ID coverage is all-or-nothing by dataset, and the example has none.

    Which is why `taxon_info.json` cannot be keyed on Q-ID and the by-name path
    is not legacy.
    """
    assert qid_of(example_tree) == {}


def test_the_example_tree_loads_from_the_package_not_from_data(monkeypatch):
    """The property that makes a clone or a `pip install` playable.

    $TAXOQUIZ_DATA_DIR is pointed at an empty tmp dir by the autouse fixture, so
    if this resolved through `data/` there would be nothing to load.
    """
    tree = load_tree(example_tree_path())
    assert tree["name"] == "Animalia"
    assert len(get_species(tree)) == 530


def test_nothing_in_the_load_path_mutates_the_tree(example_tree):
    """The shared copy is only safe because every consumer treats it as read-only."""
    before = json.dumps(example_tree, sort_keys=True)
    get_species(example_tree)
    get_ancestors(example_tree)
    rank_of(example_tree)
    common_name_of(example_tree)
    qid_of(example_tree)
    assert json.dumps(example_tree, sort_keys=True) == before


def test_a_missing_tree_raises_rather_than_returning_empty(tmp_path):
    with pytest.raises(OSError):
        load_tree(tmp_path / "absent.json")
    assert str(tmp_path / "absent.json") not in tree_mod._cache, "a failure must not be cached"

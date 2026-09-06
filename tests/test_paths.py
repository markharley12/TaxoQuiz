"""Tests for `taxoquiz.paths` — which dataset is played and where its files are.

Everything here is a guard against landing on the wrong data without noticing.
The layout exists because tree and taxon info were once selected independently,
which silently paired an 18k-species scrape with the 530-species example's text
and filled the tree with "No information available". So the rules under test are
all refusals:

- a named dataset with no `tree.json` **raises** rather than falling back;
- `$TAXOQUIZ_TREE` **raises** rather than being ignored;
- taxon info falls back to the packaged copy **only** for the example.
"""
import json

import pytest

from taxoquiz.paths import (
    DATASET_ENV, EXAMPLE_DATASET, available_datasets, current_dataset, data_dir,
    dataset_dir, example_taxon_info_path, example_tree_path, taxon_info_path,
    taxon_info_read_path, tree_path, using_example,
)

from conftest import TINY_TREE


# --------------------------------------------------------------------------
# Selection
# --------------------------------------------------------------------------

def test_nothing_set_means_the_packaged_example():
    assert current_dataset() == EXAMPLE_DATASET
    assert using_example() is True


def test_the_env_var_selects_a_dataset(monkeypatch, tiny):
    monkeypatch.setenv(DATASET_ENV, "tiny")
    assert current_dataset() == "tiny"
    assert using_example() is False


def test_the_removed_tree_env_var_raises_rather_than_being_ignored(monkeypatch):
    """Ignoring it would drop someone onto the example while they believed they
    were on their own scrape — which is the whole failure this layout prevents."""
    monkeypatch.setenv("TAXOQUIZ_TREE", "/some/old/animals_tree.json")
    with pytest.raises(RuntimeError, match="no longer used"):
        current_dataset()


def test_the_removed_var_error_names_its_replacement(monkeypatch):
    monkeypatch.setenv("TAXOQUIZ_TREE", "/x.json")
    with pytest.raises(RuntimeError, match=DATASET_ENV):
        current_dataset()


# --------------------------------------------------------------------------
# Locating a tree
# --------------------------------------------------------------------------

def test_the_example_tree_comes_from_the_package_not_the_data_dir():
    """Read through importlib.resources so it survives being installed, where
    `__file__` arithmetic does not."""
    path = tree_path(EXAMPLE_DATASET)
    assert path == example_tree_path()
    assert path.is_file()
    assert data_dir() not in path.parents


def test_a_named_dataset_resolves_inside_the_data_dir(tiny, isolated_data):
    assert tree_path("tiny") == isolated_data / "tiny" / "tree.json"


def test_a_dataset_without_a_tree_raises_rather_than_falling_back(isolated_data):
    """Being quietly dropped onto 530 species when you asked for your own scrape
    is the failure this whole layout exists to prevent."""
    (isolated_data / "empty").mkdir()
    with pytest.raises(FileNotFoundError, match="empty"):
        tree_path("empty")


def test_the_raise_lists_what_is_actually_available(tiny):
    with pytest.raises(FileNotFoundError) as e:
        tree_path("typo")
    assert "tiny" in str(e.value) and "example" in str(e.value)


def test_the_data_root_can_be_moved(isolated_data):
    """$TAXOQUIZ_DATA_DIR, which is what makes running from outside the repo
    workable — and what makes this suite hermetic."""
    assert data_dir() == isolated_data
    assert dataset_dir("x") == isolated_data / "x"


# --------------------------------------------------------------------------
# Locating taxon info — read and write paths differ, on purpose
# --------------------------------------------------------------------------

def test_the_example_falls_back_to_the_copy_bundled_in_the_package():
    """What makes a fresh clone's popups work with no scrape and no network."""
    assert taxon_info_read_path(EXAMPLE_DATASET) == example_taxon_info_path()
    assert example_taxon_info_path().is_file()


def test_a_datasets_own_file_wins_over_the_packaged_one(write_dataset, isolated_data):
    """Which is also why a leftover `data/example/` staging copy silently
    shadows what actually ships."""
    write_dataset(EXAMPLE_DATASET, TINY_TREE, {"Alpha one": {}})
    assert taxon_info_read_path(EXAMPLE_DATASET) == isolated_data / "example" / "taxon_info.json"


def test_a_custom_dataset_never_borrows_the_examples_info(tiny):
    """The fallback is deliberately limited to the example: the packaged file
    describes a different tree, and showing one tree's text against another's
    nodes is the exact mismatch datasets exist to prevent."""
    assert taxon_info_read_path("tiny") is None


def test_no_info_at_all_is_none_rather_than_an_error(tiny):
    """The popup is optional and degrades to 404s; the game must still start."""
    assert taxon_info_read_path("tiny") is None


def test_writes_always_go_to_the_dataset_directory_never_the_package(isolated_data):
    """An installed package lives in site-packages and must not be written to.

    So refreshing the shipped example info is a deliberate copy, not something
    the scraper can do on its own.
    """
    assert taxon_info_path(EXAMPLE_DATASET) == isolated_data / "example" / "taxon_info.json"
    assert taxon_info_path(EXAMPLE_DATASET) != example_taxon_info_path()


# --------------------------------------------------------------------------
# Listing what is available
# --------------------------------------------------------------------------

def test_the_example_is_always_available_even_with_no_data_dir_at_all(monkeypatch, tmp_path):
    monkeypatch.setenv("TAXOQUIZ_DATA_DIR", str(tmp_path / "does-not-exist"))
    assert available_datasets() == [EXAMPLE_DATASET]


def test_a_directory_with_a_tree_is_listed(tiny):
    assert available_datasets() == ["example", "tiny"]


def test_a_directory_without_a_tree_is_not_listed(isolated_data):
    """A scrape in progress must not be advertised — offering it would only set
    up the raise in `tree_path`."""
    (isolated_data / "in-progress").mkdir()
    assert available_datasets() == [EXAMPLE_DATASET]


def test_underscored_and_dotted_directories_are_skipped(isolated_data):
    """`_cache` holds the scrape's scratch space and is not a dataset — which is
    why it is underscored, so it cannot collide with a real name."""
    for name in ("_cache", ".hidden"):
        d = isolated_data / name
        d.mkdir()
        (d / "tree.json").write_text(json.dumps(TINY_TREE))
    assert available_datasets() == [EXAMPLE_DATASET]


def test_a_file_in_the_data_dir_is_not_mistaken_for_a_dataset(isolated_data):
    (isolated_data / "README.md").write_text("notes")
    assert available_datasets() == [EXAMPLE_DATASET]

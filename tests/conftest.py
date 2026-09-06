"""Shared fixtures for the game, API and explore tests.

Two things have to be arranged before any of these tests mean anything, and
both are easy to get silently wrong.

**The caches.** Six modules memoise per-dataset work in module-level dicts —
`tree._cache`, `game_state._indexes`, `pick_animal._species`,
`list_animals._species`, `explore._indexes` and `api.main._dataset_data_cache`.
They are keyed by dataset *name*, not by contents, so a test that writes a
`tmp` dataset and a later test that writes a different tree under the same name
would get the first one back. `clear_caches` is autouse, so no test can forget.

**The data root.** `data_dir()` is CWD-relative, so a suite run from the repo
root sees whatever scrapes the developer happens to have in `data/` — which
makes `available_datasets()`, `/datasets` and the dataset picker's contents
machine-dependent, passing here and failing in CI or vice versa. `isolated_data`
is autouse too and points $TAXOQUIZ_DATA_DIR at an empty tmp dir, so every test
starts from "the example and nothing else" and adds only what it asks for.

The example dataset survives that isolation because it is read out of the
package via `importlib.resources` rather than from `data/` — which is the
property that makes a fresh clone playable, so exercising it here is on point.
"""
import json
from pathlib import Path

import pytest

from taxoquiz import explore
from taxoquiz.api import main as api_main
from taxoquiz.game import game_state, list_animals, pick_animal, tree as tree_mod
from taxoquiz.paths import DATA_DIR_ENV, DATASET_ENV


@pytest.fixture(autouse=True)
def clear_caches():
    """Empty every per-dataset cache, before and after each test."""
    caches = (
        tree_mod._cache,
        game_state._indexes,
        pick_animal._species,
        list_animals._species,
        explore._indexes,
        api_main._dataset_data_cache,
    )
    for c in caches:
        c.clear()
    yield
    for c in caches:
        c.clear()


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    """Point the data root at an empty tmp dir and unset the dataset choice.

    Returns the root, so a test that wants a dataset on disk can write one —
    see `write_dataset`.
    """
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setenv(DATA_DIR_ENV, str(root))
    monkeypatch.delenv(DATASET_ENV, raising=False)
    return root


@pytest.fixture
def write_dataset(isolated_data):
    """Write a dataset directory and return its path.

    `taxon_info` is optional exactly as it is in a real dataset — the game plays
    without it and the popup 404s, which is a case worth being able to set up.
    """
    def _write(name: str, tree: dict, taxon_info: dict | None = None) -> Path:
        d = isolated_data / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "tree.json").write_text(json.dumps(tree))
        if taxon_info is not None:
            (d / "taxon_info.json").write_text(json.dumps(taxon_info))
        return d
    return _write


# ---------------------------------------------------------------------------
# A tiny tree with a known shape, for the assertions that want exact numbers.
#
#   Root(0)
#   ├── Left(1)
#   │   ├── LeftA(2) ── one(3)          a genus with two species
#   │   │            └─ two(3)
#   │   └── LeftB(2) ── three(3)        a genus with one
#   └── Right(1) ───── four(2)          a chain one level shorter
#
# Depths are in brackets and are what `depth_of` reports. Common names are
# distinct from scientific names throughout, because conflating the two is the
# bug class these tests exist to catch.
# ---------------------------------------------------------------------------
def leaf(sci: str, common: str) -> dict:
    return {"name": sci, "rank": "Species", "common_name": common}


TINY_TREE = {
    "name": "Root", "rank": "Kingdom", "children": [
        {"name": "Left", "rank": "Phylum", "children": [
            {"name": "LeftA", "rank": "Genus", "qid": "Q100", "children": [
                leaf("Alpha one", "one"),
                leaf("Alpha two", "two"),
            ]},
            {"name": "LeftB", "rank": "Genus", "children": [
                leaf("Beta three", "three"),
            ]},
        ]},
        {"name": "Right", "rank": "Phylum", "children": [
            leaf("Gamma four", "four"),
        ]},
    ],
}


@pytest.fixture
def tiny(write_dataset):
    """`TINY_TREE` as a dataset on disk, named `tiny`."""
    write_dataset("tiny", TINY_TREE)
    return "tiny"


@pytest.fixture
def client():
    """A TestClient over the API.

    Built per test rather than shared at module scope, so it picks up whatever
    the autouse fixtures have arranged rather than the first test's environment.
    """
    from fastapi.testclient import TestClient
    return TestClient(api_main.app)


@pytest.fixture
def example_tree():
    """The tree bundled in the package — the one a fresh clone plays."""
    from taxoquiz.paths import example_tree_path
    return tree_mod.load_tree(example_tree_path())

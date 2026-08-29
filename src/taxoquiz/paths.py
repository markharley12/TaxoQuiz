"""Which dataset the game plays on, and where its files live.

A **dataset** is a directory under `data/` holding a tree and, optionally, the
Wikipedia info for that tree's taxa:

    data/<name>/tree.json         the taxonomy to play on
    data/<name>/taxon_info.json   summaries and images for the popup, keyed by
                                  taxon name — optional, the game plays without it

They travel together on purpose. Previously the tree and the taxon info were
selected independently, so it was easy — and silent — to play an 18k-species
scrape while showing the 530-species example's info, which is exactly how you
get a tree full of "No information available".

Select one with `$TAXOQUIZ_DATASET`. Unset, the game plays the example dataset
bundled inside the package, so a plain `pip install` needs no scrape and no
network. The example's tree is read through `importlib.resources` (it survives
being installed as a zip, where `__file__` arithmetic does not); its taxon info,
being large and regenerable, is read from `data/example/` if present.

`$TAXOQUIZ_DATA_DIR` moves the `data/` root itself, which is mostly useful for
running from outside the repo.
"""

import os
from importlib import resources
from pathlib import Path

EXAMPLE_TREE = "example_tree.json"
EXAMPLE_DATASET = "example"

DATASET_ENV = "TAXOQUIZ_DATASET"
DATA_DIR_ENV = "TAXOQUIZ_DATA_DIR"
_REMOVED_TREE_ENV = "TAXOQUIZ_TREE"


def data_dir() -> Path:
    """The `data/` root. Override with $TAXOQUIZ_DATA_DIR."""
    return Path(os.environ.get(DATA_DIR_ENV, "data"))


def current_dataset() -> str:
    """Name of the selected dataset; `example` when nothing is set."""
    if os.environ.get(_REMOVED_TREE_ENV):
        raise RuntimeError(
            f"${_REMOVED_TREE_ENV} is no longer used and is being ignored, which "
            f"would silently drop you onto the wrong dataset. Datasets are now "
            f"directories under data/ — use ${DATASET_ENV}=<name> instead."
        )
    return os.environ.get(DATASET_ENV) or EXAMPLE_DATASET


def using_example() -> bool:
    return current_dataset() == EXAMPLE_DATASET


def dataset_dir(name: str | None = None) -> Path:
    return data_dir() / (name or current_dataset())


def cache_dir() -> Path:
    """Scratch space for the Wikidata scrape.

    Everything in here is rebuildable and nothing reads it at runtime, so it is
    always safe to delete — at worst you pay for the scrape again. Named `_cache`
    rather than `_scrape` so that is obvious from the directory listing, and
    underscored so it cannot collide with a dataset name.
    """
    return data_dir() / "_cache"


# Files in cache_dir(). The `wikidata-` prefix records where they came from, and
# `-raw` on the tree is load-bearing: it is NOT the tree the game plays. Its
# schema is inverted relative to a dataset's tree.json (it puts the common name
# in `name`), it is rooted at Life rather than a kingdom, and its node names are
# not unique — feeding it to the game raises KeyError. datagen/extract_game_tree.py
# converts it. Calling it `tree_of_life.json` next to `tree.json` implied the
# difference was scope; it is schema.
CACHE_SPECIES = "wikidata-species.json"
CACHE_ANCESTORS = "wikidata-ancestors.json"
CACHE_RAW_TREE = "wikidata-tree-raw.json"


def example_tree_path() -> Path:
    """The example tree bundled inside the package."""
    return Path(str(resources.files(__package__) / "data" / EXAMPLE_TREE))


def tree_path() -> Path:
    """The tree to play on.

    A named dataset with no `tree.json` raises rather than falling back to the
    example: being quietly dropped onto 530 species when you asked for your own
    scrape is the failure this whole layout exists to prevent.
    """
    if using_example():
        return example_tree_path()
    path = dataset_dir() / "tree.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"${DATASET_ENV}={current_dataset()!r} but {path} does not exist. "
            f"Available: {', '.join(available_datasets()) or 'none'}."
        )
    return path


def taxon_info_path() -> Path:
    """Where this dataset's taxon info lives. May not exist; the popup is optional."""
    return dataset_dir() / "taxon_info.json"


def available_datasets() -> list[str]:
    """Dataset names present on disk, plus the always-available example."""
    root = data_dir()
    found = set()
    if root.is_dir():
        found = {
            p.name for p in root.iterdir()
            if p.is_dir() and not p.name.startswith(("_", "."))
        }
    return sorted(found | {EXAMPLE_DATASET})

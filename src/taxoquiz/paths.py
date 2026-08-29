"""Which dataset the game plays on, and where generated data lives.

There are two kinds of data here and they are found in different ways.

The **taxonomy tree** is the dataset you play on. By default it is the example
that ships inside the package, so a plain `pip install` gives a playable game
with no scrape and no network. Point `$TAXOQUIZ_TREE` at a JSON file to play on
your own instead — see `datagen/`. It is read through `importlib.resources`,
which keeps working when the package is installed as a zip or from
site-packages, where `__file__` arithmetic does not.

**Generated data** (`data/`) is everything the datagen tools produce. Only the
optional taxon-info popup reads it. It is found relative to the current working
directory by default; set `$TAXOQUIZ_DATA_DIR` to point elsewhere.
"""

import os
from importlib import resources
from pathlib import Path

EXAMPLE_TREE = "example_tree.json"
TREE_ENV = "TAXOQUIZ_TREE"
DATA_DIR_ENV = "TAXOQUIZ_DATA_DIR"


def example_tree_path() -> Path:
    """Filesystem path to the example dataset bundled with the package."""
    return Path(str(resources.files(__package__) / "data" / EXAMPLE_TREE))


def tree_path() -> Path:
    """The tree to play on: $TAXOQUIZ_TREE if set, otherwise the bundled example.

    A missing override raises rather than silently falling back — being quietly
    dropped onto the 530-species example when you meant to play your own scrape
    is exactly the confusion this is here to prevent.
    """
    override = os.environ.get(TREE_ENV)
    if not override:
        return example_tree_path()
    path = Path(override).expanduser()
    if not path.is_file():
        raise FileNotFoundError(
            f"${TREE_ENV} is set to {override!r}, which is not a file. "
            f"Unset it to play on the bundled example dataset."
        )
    return path


def using_example_tree() -> bool:
    """True when playing the bundled example rather than a supplied dataset."""
    return not os.environ.get(TREE_ENV)


def data_dir() -> Path:
    """Directory holding generated data. Override with $TAXOQUIZ_DATA_DIR."""
    return Path(os.environ.get(DATA_DIR_ENV, "data"))

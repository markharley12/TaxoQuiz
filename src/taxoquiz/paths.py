"""Where the game's data lives.

Two different kinds of data, resolved differently:

- The **example dataset** ships inside the package, so a plain `pip install`
  gives a playable game with no scrape and no network. It is read through
  `importlib.resources`, which keeps working when the package is installed
  as a zip or from site-packages, where `__file__` arithmetic does not.

- **Generated data** (`data/`) is whatever you scraped yourself. It is not part
  of the package and is not installed, so it is found relative to the current
  working directory by default. Set `$TAXOQUIZ_DATA_DIR` to point elsewhere.
"""

import os
from importlib import resources
from pathlib import Path

EXAMPLE_TREE = "example_tree.json"


def example_tree_path() -> Path:
    """Filesystem path to the bundled example dataset."""
    return Path(str(resources.files(__package__) / "data" / EXAMPLE_TREE))


def data_dir() -> Path:
    """Directory holding generated data. Override with $TAXOQUIZ_DATA_DIR."""
    return Path(os.environ.get("TAXOQUIZ_DATA_DIR", "data"))

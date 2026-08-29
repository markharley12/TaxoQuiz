import json
from pathlib import Path

from ..paths import tree_path

# Parsed trees, keyed by resolved path. Every game module calls load_tree()
# independently, and without this the same file was parsed once per module —
# three times, into three separate copies. Harmless for the 530-species example,
# but a full scrape is ~44MB. Nothing mutates the tree (game_state builds fresh
# dicts when pruning), so one shared copy is safe.
_cache: dict[str, dict] = {}


def load_tree(path: Path | None = None) -> dict:
    """Load a taxonomy tree.

    Defaults to whatever `tree_path()` resolves to: the dataset named by
    $TAXOQUIZ_TREE, or the example bundled with the package.
    """
    resolved = Path(path) if path is not None else tree_path()
    key = str(resolved)
    if key not in _cache:
        with open(resolved) as f:
            _cache[key] = json.load(f)
    return _cache[key]


def get_species(node: dict) -> list[dict]:
    """Return all leaf nodes (species) from a tree node."""
    if not node.get("children"):
        return [node]
    species = []
    for child in node["children"]:
        species.extend(get_species(child))
    return species

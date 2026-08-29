import json
from pathlib import Path

from ..paths import example_tree_path


def load_tree(path: Path | None = None) -> dict:
    """Load a taxonomy tree. Defaults to the example dataset bundled with the package."""
    with open(path or example_tree_path()) as f:
        return json.load(f)


def get_species(node: dict) -> list[dict]:
    """Return all leaf nodes (species) from a tree node."""
    if not node.get("children"):
        return [node]
    species = []
    for child in node["children"]:
        species.extend(get_species(child))
    return species

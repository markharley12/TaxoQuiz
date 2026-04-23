import json
from pathlib import Path

_DEFAULT_TREE = Path(__file__).parent.parent / "animals_tree.json"


def load_tree(path: Path = _DEFAULT_TREE) -> dict:
    with open(path) as f:
        return json.load(f)


def get_species(node: dict) -> list[dict]:
    """Return all leaf nodes (species) from a tree node."""
    if not node.get("children"):
        return [node]
    species = []
    for child in node["children"]:
        species.extend(get_species(child))
    return species

from .tree import load_tree, get_species
from ..paths import current_dataset, tree_path

_species: dict[str, list[dict]] = {}

DEFAULT_LIMIT = 30


def _ensure_loaded(dataset: str | None) -> list[dict]:
    key = dataset or current_dataset()
    if key not in _species:
        _species[key] = get_species(load_tree(tree_path(key)))
    return _species[key]


def list_animals(
    substring: str,
    limit: int = DEFAULT_LIMIT,
    exclude: set[str] | None = None,
    dataset: str | None = None,
) -> list[str]:
    """Return up to `limit` animal common names containing `substring`."""
    species = _ensure_loaded(dataset)
    needle = substring.lower()
    matches = [
        s["common_name"] for s in species
        if needle in s["common_name"].lower() and (exclude is None or s["common_name"] not in exclude)
    ]
    return matches[:limit]


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    substr = args[0] if args else ""
    limit = int(args[1]) if len(args) > 1 else DEFAULT_LIMIT
    for name in list_animals(substr, limit):
        print(name)

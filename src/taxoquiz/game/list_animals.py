from .tree import load_tree, get_species

_species = None

DEFAULT_LIMIT = 30


def _ensure_loaded():
    global _species
    if _species is None:
        _species = get_species(load_tree())


def list_animals(substring: str, limit: int = DEFAULT_LIMIT, exclude: set[str] | None = None) -> list[str]:
    """Return up to `limit` animal common names containing `substring`."""
    _ensure_loaded()
    needle = substring.lower()
    matches = [
        s["common_name"] for s in _species
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

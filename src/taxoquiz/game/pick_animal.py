import random
from datetime import date
from .tree import load_tree, get_species

_tree = None
_species = None


def _ensure_loaded():
    global _tree, _species
    if _species is None:
        _tree = load_tree()
        _species = get_species(_tree)


def pick_random_animal(daily: bool = False) -> str:
    """Return the common name of a randomly chosen animal.

    If daily=True, seeds from today's date so everyone gets the same animal.
    """
    _ensure_loaded()
    rng = random.Random(date.today().isoformat() if daily else None)
    return rng.choice(_species)["common_name"]


if __name__ == "__main__":
    import sys
    daily = "--daily" in sys.argv
    print(pick_random_animal(daily=daily))

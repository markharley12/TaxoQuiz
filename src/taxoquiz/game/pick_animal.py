from datetime import date

from . import seed as seeds
from .tree import load_tree, get_species
from ..paths import current_dataset, tree_path

_species: dict[str, list[dict]] = {}


def _ensure_loaded(dataset: str | None) -> list[dict]:
    key = dataset or current_dataset()
    if key not in _species:
        _species[key] = get_species(load_tree(tree_path(key)))
    return _species[key]


def pick_animal(
    seed: str | None = None, daily: bool = False, dataset: str | None = None
) -> tuple[str, str]:
    """Choose the secret animal, and return it with the seed that names it.

    Every game has a seed, so any game can be handed to someone else to play.
    Daily is not a separate mechanism — it is this one with the seed derived from
    today's date, which is what makes today's game reproducible for everybody.

    Raises ValueError if `seed` is malformed or belongs to another dataset.
    """
    species = _ensure_loaded(dataset)
    if seed:
        chosen = seeds.resolve(seed, species)
        return chosen["common_name"], seeds.normalise(seed)
    full = seeds.make_seed(species, day=date.today() if daily else None)
    return seeds.resolve(full, species)["common_name"], full


def pick_random_animal(daily: bool = False, dataset: str | None = None) -> str:
    """Just the animal, for callers that don't care about the seed."""
    return pick_animal(daily=daily, dataset=dataset)[0]


if __name__ == "__main__":
    import sys

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    animal, s = pick_animal(seed=args[0] if args else None, daily="--daily" in sys.argv)
    print(f"{animal}\nseed: {s}")

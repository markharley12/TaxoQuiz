from datetime import date, datetime, timezone

from . import seed as seeds
from .tree import load_tree, get_species
from ..paths import current_dataset, tree_path

_species: dict[str, list[dict]] = {}


def _ensure_loaded(dataset: str | None) -> list[dict]:
    key = dataset or current_dataset()
    if key not in _species:
        _species[key] = get_species(load_tree(tree_path(key)))
    return _species[key]


def utc_today() -> date:
    """The daily's date, in UTC rather than wherever the server happens to be.

    The daily is now also computed on the client (`frontend/src/engine/seed.ts`),
    which cannot know the server's timezone. Both sides use UTC, so a daily is
    the same round at the same instant everywhere, and the frontend's saved
    session — stamped with the UTC date — expires when the round changes.
    """
    return datetime.now(timezone.utc).date()


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
    full = seeds.make_seed(species, day=utc_today() if daily else None)
    return seeds.resolve(full, species)["common_name"], full


def pick_random_animal(daily: bool = False, dataset: str | None = None) -> str:
    """Just the animal, for callers that don't care about the seed."""
    return pick_animal(daily=daily, dataset=dataset)[0]


if __name__ == "__main__":
    import sys

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    animal, s = pick_animal(seed=args[0] if args else None, daily="--daily" in sys.argv)
    print(f"{animal}\nseed: {s}")

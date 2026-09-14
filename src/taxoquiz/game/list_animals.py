import re

from .tree import load_tree, get_species
from ..paths import current_dataset, tree_path

_species: dict[str, list[dict]] = {}

DEFAULT_LIMIT = 50

_WORD = frozenset("abcdefghijklmnopqrstuvwxyz0123456789")
_DISAMBIGUATION = re.compile(r"[ ]*(\([^)]*\))?[ ]*(#[0-9]+)?$")


def match_tier(name: str, needle: str) -> int | None:
    """How well a common name matches a lower-cased query, or None for no match.

    0 exact; 1 the name's last word ("snail" in "garden snail"); 2 a whole word
    elsewhere ("snail eater"); 3 the start of a word ("crowned"); 4 anywhere.

    The last word gets its own tier because an English common name ends in what
    the animal *is*: a garden snail is a snail, a snail eater is a snake. Before
    it, "snail" offered snail eaters and snail kites level with snails. A trailing
    disambiguation — " (Binomial)" or " #2", added by extract_game_tree — does not
    count as a word.

    A word character is ASCII a-z or 0-9, spelled out rather than left to `\\b`,
    because the TypeScript port has to agree exactly and the two languages' `\\b`
    do not. An empty query matches everything at tier 4, keeping tree order.
    """
    low = name.lower()
    if low == needle:
        return 0
    if not needle:
        return 4
    # Where the name proper ends, before any disambiguation. count=1, the first
    # match only, to agree with JavaScript's non-global replace.
    core_end = len(_DISAMBIGUATION.sub("", low, count=1))
    best = None
    i = low.find(needle)
    while i != -1:
        j = i + len(needle)
        before = i == 0 or low[i - 1] not in _WORD
        after = j == len(low) or low[j] not in _WORD
        if before and after:
            tier = 1 if j == core_end else 2
        else:
            tier = 3 if before else 4
        best = tier if best is None else min(best, tier)
        i = low.find(needle, i + 1)
    return best


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
    """Up to `limit` common names containing `substring`, best matches first.

    Exact, then the name's last word, then a whole word elsewhere, then the start
    of a word, then anywhere (see match_tier); tree order within each, which keeps
    relatives together. They used to come back in tree order
    alone and stop at the limit, so on the 41k-species dataset "cat" put the
    domestic cat 128th, past any list anyone would scroll, and "crow" never
    reached a crow among 279 names containing the string.
    """
    species = _ensure_loaded(dataset)
    needle = substring.lower()
    tiers: list[list[str]] = [[], [], [], [], []]
    for s in species:
        name = s["common_name"]
        if exclude is not None and name in exclude:
            continue
        tier = match_tier(name, needle)
        if tier is not None:
            tiers[tier].append(name)
    return [name for tier in tiers for name in tier][:limit]


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    substr = args[0] if args else ""
    limit = int(args[1]) if len(args) > 1 else DEFAULT_LIMIT
    for name in list_animals(substr, limit):
        print(name)

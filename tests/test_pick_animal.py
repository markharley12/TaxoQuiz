"""Tests for `pick_animal` and `list_animals` — the layer the CLI and API share.

`pick_animal` is where "every game has a seed" is actually enforced: there is no
path through it that picks an animal without also returning the seed that names
it, which is what makes any round handable to someone else. Daily is not a
second path — it is this one with the body derived from the date.
"""


import pytest

from taxoquiz.game import seed as seeds
from taxoquiz.game.list_animals import DEFAULT_LIMIT, list_animals
from taxoquiz.game.pick_animal import pick_animal, pick_random_animal, utc_today
from taxoquiz.game.tree import get_species

from conftest import TINY_TREE


# --------------------------------------------------------------------------
# pick_animal
# --------------------------------------------------------------------------

def test_a_new_game_always_comes_with_the_seed_that_names_it(tiny):
    animal, seed = pick_animal(dataset=tiny)
    assert animal in {"one", "two", "three", "four"}
    assert pick_animal(seed=seed, dataset=tiny)[0] == animal


def test_the_animal_is_returned_by_common_name(tiny):
    """It is what the player types, and what the autocomplete offers."""
    assert pick_animal(dataset=tiny)[0] in {"one", "two", "three", "four"}


def test_replaying_a_seed_returns_it_normalised(tiny):
    """So the UI can display and share a canonical seed whatever was typed."""
    _, seed = pick_animal(dataset=tiny)
    assert pick_animal(seed=seed.replace("-", "").lower(), dataset=tiny)[1] == seed


def test_the_daily_is_derived_from_the_date_not_chosen_at_random(tiny):
    """What makes today's game the same for everybody who plays it.

    Rebuilt here from the date rather than compared against a hardcoded animal,
    which would need editing every day.
    """
    species = get_species(TINY_TREE)
    expected = seeds.resolve(seeds.make_seed(species, day=utc_today()), species)

    animal, seed = pick_animal(daily=True, dataset=tiny)
    assert animal == expected["common_name"]
    assert seed == seeds.make_seed(species, day=utc_today())
    assert (animal, seed) == pick_animal(daily=True, dataset=tiny), "stable all day"


def test_a_daily_game_carries_an_ordinary_seed(tiny):
    """Daily is the seed mechanism, not a parallel one — so a daily game can be
    shared and replayed like any other."""
    animal, seed = pick_animal(daily=True, dataset=tiny)
    assert pick_animal(seed=seed, dataset=tiny)[0] == animal


def test_an_explicit_seed_wins_over_daily(tiny):
    _, practice = pick_animal(dataset=tiny)
    assert pick_animal(seed=practice, daily=True, dataset=tiny)[1] == practice


def test_a_seed_for_another_dataset_raises(tiny, write_dataset):
    write_dataset("other", {"name": "R", "rank": "Kingdom", "children": [
        {"name": "S q", "rank": "Species", "common_name": "q"},
    ]})
    _, seed = pick_animal(dataset=tiny)
    with pytest.raises(ValueError, match="different dataset"):
        pick_animal(seed=seed, dataset="other")


def test_a_malformed_seed_raises(tiny):
    with pytest.raises(ValueError, match="is not a seed"):
        pick_animal(seed="nonsense", dataset=tiny)


def test_pick_random_animal_is_the_same_choice_without_the_seed(tiny):
    assert pick_random_animal(daily=True, dataset=tiny) == pick_animal(daily=True, dataset=tiny)[0]


def test_practice_games_are_not_all_the_same_animal(example_tree):
    """`secrets`, not `random` — and no per-process state that would pin it."""
    assert len({pick_animal()[0] for _ in range(60)}) > 30


# --------------------------------------------------------------------------
# list_animals
# --------------------------------------------------------------------------

def test_list_animals_matches_a_substring_anywhere_in_the_name(example_tree):
    assert "snow leopard" in list_animals("leopard")
    assert "snow leopard" in list_animals("snow")


def test_list_animals_is_case_insensitive(example_tree):
    assert list_animals("LEOPARD") == list_animals("leopard")


def test_list_animals_offers_species_only_by_common_name(example_tree):
    """Only a species can be guessed, so the scientific names are not offered —
    explore's search is the one that treats a clade as a destination."""
    assert list_animals("Panthera") == []
    assert list_animals("Felidae") == []


def test_list_animals_excludes_what_was_already_guessed(example_tree):
    assert "lion" not in list_animals("lion", exclude={"lion"})


def test_list_animals_caps_at_the_limit(example_tree):
    assert len(list_animals("a", limit=5)) == 5
    assert len(list_animals("a")) <= DEFAULT_LIMIT


def test_an_empty_query_matches_everything_up_to_the_limit(example_tree):
    """Which is what makes the autocomplete openable before anything is typed."""
    assert len(list_animals("")) == DEFAULT_LIMIT


def test_no_match_is_an_empty_list_not_an_error(example_tree):
    assert list_animals("griffin") == []


def test_results_come_back_in_tree_order(tiny):
    """Not sorted — tree order groups relatives together, so the suggestions
    under a partial name read as a family rather than an alphabet."""
    assert list_animals("", dataset=tiny) == ["one", "two", "three", "four"]


def test_each_dataset_lists_only_its_own_species(tiny, write_dataset):
    write_dataset("other", {"name": "R", "rank": "Kingdom", "children": [
        {"name": "S one", "rank": "Species", "common_name": "one elsewhere"},
    ]})
    assert list_animals("one", dataset=tiny) == ["one"]
    assert list_animals("one", dataset="other") == ["one elsewhere"]

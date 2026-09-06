"""Tests for `taxoquiz.game.seed` — the shareable-game mechanism.

A seed's whole job is that the same string means the same animal to two people.
Every failure mode here is silent by nature: a seed that resolves to a *different*
animal looks exactly like a seed that works, right up until the two players
compare notes. So the tests are mostly about the ways it must refuse.
"""
from datetime import date

import pytest

from taxoquiz.game import seed as seeds
from taxoquiz.game.tree import get_species

from conftest import TINY_TREE

SPECIES = get_species(TINY_TREE)


def test_a_seed_resolves_to_the_same_animal_every_time():
    s = seeds.make_seed(SPECIES)
    assert seeds.resolve(s, SPECIES) is seeds.resolve(s, SPECIES)


def test_make_seed_round_trips_through_resolve():
    """The property the whole feature rests on: hand someone your seed, they
    play your game."""
    for _ in range(50):
        s = seeds.make_seed(SPECIES)
        assert seeds.resolve(s, SPECIES) in SPECIES


def test_the_alphabet_excludes_the_characters_that_break_when_read_aloud():
    """No I, L, O or U — so 1/I and 0/O cannot be confused over a phone."""
    assert set("ILOU").isdisjoint(seeds.ALPHABET)
    body = "".join(seeds.new_body() for _ in range(200))
    assert set(body) <= set(seeds.ALPHABET)


def test_seed_shape_is_fingerprint_dash_body():
    s = seeds.make_seed(SPECIES)
    fp, body = s.split("-")
    assert len(fp) == seeds.FINGERPRINT_LEN
    assert len(body) == seeds.BODY_LEN


# --------------------------------------------------------------------------
# Normalising what a person actually types
# --------------------------------------------------------------------------

def test_normalise_accepts_any_case_spacing_and_a_missing_dash():
    canonical = seeds.normalise("ABCD-234567")
    for typed in ("abcd-234567", "ABCD234567", "abcd 234 567", " AbCd-234567 ", "abcd–234567"):
        assert seeds.normalise(typed) == canonical, typed


@pytest.mark.parametrize("bad", ["", "ABCD", "ABCD-2345678", "hello", "!!!!"])
def test_normalise_rejects_anything_of_the_wrong_length(bad):
    with pytest.raises(ValueError, match="is not a seed"):
        seeds.normalise(bad)


def test_length_is_the_only_thing_normalise_checks_and_the_tag_catches_the_rest():
    """Stripping is aggressive enough that prose can survive it.

    "not a seed at all" loses its O, L and spaces and comes out as exactly ten
    alphabet characters — a well-formed seed as far as `normalise` is concerned.
    That is not a hole, because it is the *fingerprint* that decides whether a
    seed belongs to this dataset, and arbitrary text will not carry the right
    tag. Worth pinning down so nobody tightens `normalise` believing it is the
    thing standing between a typo and a wrong animal.
    """
    assert seeds.normalise("not a seed at all") == "NTAS-EEDATA"
    with pytest.raises(ValueError, match="different dataset"):
        seeds.resolve("not a seed at all", SPECIES)


def test_characters_outside_the_alphabet_are_dropped_not_translated():
    """Stripping is deliberate — it is what lets the dash and spaces be optional.

    Note the consequence: a typo'd `I` is *removed* rather than read as `1`, so
    the seed comes out the wrong length and is rejected, rather than silently
    resolving to some other animal. Refusing is the right end of that trade.
    """
    with pytest.raises(ValueError):
        seeds.normalise("ABCD-2345I7")


# --------------------------------------------------------------------------
# The dataset fingerprint — the half that stops a seed meaning two things
# --------------------------------------------------------------------------

def test_fingerprint_is_stable_across_calls():
    assert seeds.fingerprint(SPECIES) == seeds.fingerprint(list(SPECIES))


def test_fingerprint_changes_when_the_species_list_does():
    """Any change to the dataset must invalidate old seeds rather than
    re-point them."""
    dropped = SPECIES[:-1]
    assert seeds.fingerprint(dropped) != seeds.fingerprint(SPECIES)

    renamed = [dict(s) for s in SPECIES]
    renamed[0]["common_name"] = "something else"
    assert seeds.fingerprint(renamed) != seeds.fingerprint(SPECIES)


def test_fingerprint_depends_on_order_so_a_reextraction_invalidates_seeds():
    reordered = list(reversed(SPECIES))
    assert seeds.fingerprint(reordered) != seeds.fingerprint(SPECIES)


def test_a_seed_from_another_dataset_is_rejected_not_silently_resolved():
    """The failure this exists to prevent: the same seed, two different animals.

    A 530-species example and an 18k scrape both happily index into their own
    list, so without the tag the sender and receiver would each get a perfectly
    plausible animal and no sign that they differed.
    """
    other = SPECIES[:-1]
    s = seeds.make_seed(SPECIES)
    with pytest.raises(ValueError, match="different dataset"):
        seeds.resolve(s, other)


def test_the_rejection_names_both_tags_so_it_can_be_diagnosed():
    other = SPECIES[:-1]
    with pytest.raises(ValueError) as e:
        seeds.resolve(seeds.make_seed(SPECIES), other)
    assert seeds.fingerprint(SPECIES) in str(e.value)
    assert seeds.fingerprint(other) in str(e.value)


def test_resolve_normalises_first_so_a_retyped_seed_still_works():
    s = seeds.make_seed(SPECIES)
    assert seeds.resolve(s.replace("-", "").lower(), SPECIES) == seeds.resolve(s, SPECIES)


# --------------------------------------------------------------------------
# Daily — the same mechanism, with the body derived from the date
# --------------------------------------------------------------------------

def test_the_daily_seed_is_a_function_of_the_date():
    """What makes today's game the same for everybody."""
    day = date(2026, 9, 6)
    assert seeds.make_seed(SPECIES, day=day) == seeds.make_seed(SPECIES, day=day)
    assert seeds.make_seed(SPECIES, day=day) != seeds.make_seed(SPECIES, day=date(2026, 9, 7))


def test_a_daily_seed_is_an_ordinary_seed():
    """Daily is not a separate path — it resolves through exactly the same code."""
    s = seeds.make_seed(SPECIES, day=date(2026, 9, 6))
    assert seeds.resolve(s, SPECIES) in SPECIES


def test_day_wins_over_an_explicitly_passed_body():
    explicit = seeds.make_seed(SPECIES, body="234567")
    daily = seeds.make_seed(SPECIES, body="234567", day=date(2026, 9, 6))
    assert explicit != daily


def test_a_known_body_rebuilds_a_known_seed():
    assert seeds.make_seed(SPECIES, body="234567").endswith("-234567")


def test_new_body_does_not_repeat_itself():
    """`secrets` rather than `random`, so two games started in one process
    cannot land on the same seed."""
    assert len({seeds.new_body() for _ in range(500)}) > 490


def test_resolve_spreads_across_the_species_list():
    """A seed is useless if it keeps naming the same handful of animals."""
    big = [{"common_name": f"animal {i}"} for i in range(200)]
    picked = {seeds.resolve(seeds.make_seed(big), big)["common_name"] for _ in range(300)}
    assert len(picked) > 100, "300 seeds over 200 species should touch most of them"

"""Tests of the shipped data itself, rather than of the code that reads it.

Every other test in this suite checks code against a fixture it built. Two bugs
got past that and reached a screen, because both were true of the *data*:

* the scraper's `RANK_LABELS` mislabelled 15 of 23 rank Q-IDs, filing 355 beetle
  superfamilies as `Subkingdom`;
* `example_tree.json` went Animalia -> Phylum with nothing between, so a human
  and a starfish scored exactly what a human and a sea sponge did.

Neither could fail a test that supplies its own tree. So these run
`datagen/validate_dataset.py` over the dataset the game actually ships with, and
then over deliberately broken trees to show the checks bite — the same mutation
argument the frontend suite uses. `validate_dataset` is the one place the rules
live; the CLI, `extract_game_tree.py` and this file all call it.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "datagen"))
import validate_dataset  # noqa: E402
from validate_dataset import check_biology, check_shape, check_warmth, validate  # noqa: E402


def node(name, rank, *children):
    n = {"name": name, "rank": rank}
    if children:
        n["children"] = list(children)
    return n


# --------------------------------------------------------------------------
# The dataset that ships
# --------------------------------------------------------------------------

def test_the_packaged_example_passes_every_check(example_tree):
    """The one that would have caught the flat tree, and the whole point of the
    file: it runs against what a fresh clone plays on."""
    report = validate(example_tree, "example")
    assert report.ok, report.failures


def test_the_example_rejects_no_rank_claim_at_all(example_tree):
    """The early-warning number.

    `believed_levels` can survive bad ranks, which means a dataset can rot
    quietly. The hand-curated fixture should never need that mercy — a rejection
    appearing here means an edit put a rank somewhere it does not belong.
    """
    report = validate(example_tree, "example", checks=(check_warmth,))
    assert report.ok
    assert any("0 of" in n for n in report.notes), report.notes


# --------------------------------------------------------------------------
# Mutations — each turns one check red
# --------------------------------------------------------------------------

def test_a_flat_tree_fails_the_biology_check():
    """The original bug, in miniature: two phyla hung straight off the kingdom.

    A human and a starfish then share only the kingdom, exactly as a human and a
    sponge do, and no ordering can tell them apart.
    """
    flat = node("Animalia", "Kingdom",
                node("Chordata", "Phylum", node("Homo sapiens", "Species")),
                node("Echinodermata", "Phylum", node("Asterias rubens", "Species")),
                node("Porifera", "Phylum", node("Spongia officinalis", "Species")))
    report = validate(flat, "flat", checks=(check_biology,))
    assert not report.ok
    assert any("Asterias rubens" in f for f in report.failures), report.failures


def test_the_same_tree_passes_once_the_clade_layer_is_there():
    """And the fix, so the test above is not merely hard to satisfy."""
    deep = node("Animalia", "Kingdom",
                node("Porifera", "Phylum", node("Spongia officinalis", "Species")),
                node("Bilateria", "Clade",
                     node("Deuterostomia", "Clade",
                          node("Chordata", "Phylum", node("Homo sapiens", "Species")),
                          node("Echinodermata", "Phylum", node("Asterias rubens", "Species")))))
    assert validate(deep, "deep", checks=(check_biology,)).ok


def test_a_duplicate_name_fails_the_shape_check():
    """The game keys its depth index on the name, so a duplicate corrupts play
    silently rather than raising anywhere."""
    dupe = node("Animalia", "Kingdom",
                node("Gnathostomata", "Clade", node("a", "Species")),
                node("Gnathostomata", "Superfamily", node("b", "Species")))
    report = validate(dupe, "dupe", checks=(check_shape,))
    assert not report.ok
    assert "duplicate" in report.failures[0]


def test_a_rank_rot_epidemic_fails_the_warmth_check():
    """One bad rank is survivable and is meant to be; a tree full of them is a
    broken source, and the share is what says which you have.

    Measured: the scrape from before the `RANK_LABELS` repair rejects 6.5% of
    its rank claims, the repaired one 0.3%, the example 0%. The check fails
    above 5%, so the first of those is a dataset to rebuild and the second is a
    dataset to play.
    """
    # every family here contains an order, so both claims in each pair go
    rotten = node("Animalia", "Kingdom", *[
        node(f"fam{i}", "Family",
             node(f"ord{i}", "Order", node(f"sp{i}", "Species")))
        for i in range(20)
    ])
    report = validate(rotten, "rotten", checks=(check_warmth,))
    assert not report.ok
    assert "rejected" in report.failures[0], report.failures

    # and a single bad pair in an otherwise sound tree is a note, not a failure
    mostly_fine = node("Animalia", "Kingdom", *[
        node(f"ord{i}", "Order",
             node(f"fam{i}", "Family", node(f"sp{i}", "Species")))
        for i in range(40)
    ])
    mostly_fine["children"][0]["rank"] = "Family"
    mostly_fine["children"][0]["children"][0]["rank"] = "Order"
    ok = validate(mostly_fine, "mostly-fine", checks=(check_warmth,))
    assert ok.ok, ok.failures


def test_warmth_never_runs_backwards_however_bad_the_ranks_are():
    """The invariant the colour scale needs, and the one thing that must hold
    even on a dataset the checks above would reject outright."""
    absurd = node("Animalia", "Kingdom",
                  node("Suborder-of-everything", "Suborder",
                       node("Chordata", "Phylum",
                            node("Mammalia", "Class",
                                 node("Homo sapiens", "Species")))))
    report = validate(absurd, "absurd", checks=(check_warmth,))
    assert not any("inversion" in f for f in report.failures), report.failures


@pytest.mark.parametrize("chain", [c for _, c in validate_dataset.GROUND_TRUTH])
def test_every_ground_truth_species_is_named_by_its_scientific_name(chain):
    """Vernacular names differ between datasets — the example's "common
    starfish" is the scrape's "Common sea star" — so a chain written in them
    would silently skip every pair on one of the two."""
    for name in chain:
        assert name[0].isupper() and " " in name, name


def test_a_leaf_that_is_not_a_species_fails_the_shape_check():
    """A leaf is a guessable animal, so a clade with nothing under it is a fake one.

    Regression: this was a note rather than a failure, and the Sep 2026 rebuild
    shipped 189 childless clades as species — Apo-Chiroptera, a bat photograph
    labelled "Species", sat beside the real bats as a dead end.
    """
    fake = node("Mammalia", "Class",
                node("Chiroptera", "Order", node("Desmodus rotundus", "Species")),
                node("Apo-Chiroptera", "Clade"))
    report = validate(fake, "fake", checks=(check_shape,))
    assert not report.ok
    assert any("not species" in failure for failure in report.failures)

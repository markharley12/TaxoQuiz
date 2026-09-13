"""Taxon text surviving a node's rename.

Entries in `taxon_info.json` are keyed by node name, and names are not stable
between extractions: `make_names_unique` qualifies a name only while it
collides. After the Sep 2026 re-extraction, "Lutrogale (Lutra)" became
"Lutrogale", and three nodes lost their popup text while the text sat in the
file under the old names.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "datagen"))
import scrape_taxon_info  # noqa: E402


def entry(qid, text="An otter genus."):
    return {"qid": qid, "description": text}


def rekey(results, tree_qids, extra_names=()):
    return scrape_taxon_info.rekey_by_qid(results, tree_qids, set(tree_qids) | set(extra_names))


def test_a_renamed_node_takes_its_entry_back_by_qid():
    results = {"Lutrogale (Lutra)": entry("Q756455")}
    assert rekey(results, {"Lutrogale": "Q756455"}) == 1
    assert results == {"Lutrogale": entry("Q756455")}


def test_an_entry_still_used_by_a_node_is_never_taken():
    results = {"Thunnus": entry("Q1", "the genus")}
    assert rekey(results, {"Thunnus": "Q1", "Thunnus #2": "Q1"}) == 0
    assert results == {"Thunnus": entry("Q1", "the genus")}


def test_an_entry_of_a_node_with_no_qid_is_still_in_use():
    """A node can be in the tree without a Q-ID — the synthetic root, or a
    hand-curated tree. Judging "still in use" by the Q-ID map alone would have
    handed its entry to whichever renamed node shares the recorded Q-ID."""
    results = {"Life": entry("Q2")}
    assert rekey(results, {"Biota": "Q2"}, extra_names={"Life"}) == 0
    assert "Life" in results


def test_entries_without_a_qid_are_left_to_the_ordinary_fetch():
    results = {"Old name": {"description": "no qid recorded"}}
    assert rekey(results, {"New name": "Q9"}) == 0
    assert "Old name" in results

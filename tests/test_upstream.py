"""The upstream loop: confirming leads, remembering them, pulling fixes back.

These guard the rules that make the ledger trustworthy: a human decision is
never overwritten, a lead is declared fixed only when Wikidata was actually
re-asked, and a fix made upstream can reach the caches the game is built from.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "datagen"))

import scraper            # noqa: E402
import upstream_check as uc  # noqa: E402

TODAY = "2026-10-08"
ENTITY = "http://www.wikidata.org/entity/"


def _lead(qid, kind="bad-species-name"):
    return uc.Lead(kind, qid, "subject", "edit", ["evidence"])


def test_a_new_lead_is_confirmed_and_dated():
    ledger = {"leads": {}}
    assert uc.merge(ledger, [_lead("Q1")], {"Q1"}, TODAY) == {"new": 1}
    assert ledger["leads"]["bad-species-name:Q1"]["status"] == "confirmed"
    assert ledger["leads"]["bad-species-name:Q1"]["first_seen"] == TODAY


def test_a_lead_that_no_longer_reproduces_is_resolved_only_if_rechecked():
    """Absent from a run is not fixed: our own data may simply have stopped
    raising it. Only a live re-check that comes back clean resolves it."""
    ledger = {"leads": {}}
    uc.merge(ledger, [_lead("Q1"), _lead("Q2")], {"Q1", "Q2"}, "2026-10-01")
    counts = uc.merge(ledger, [], {"Q1"}, TODAY)
    assert counts == {"resolved": 1}
    assert ledger["leads"]["bad-species-name:Q1"]["status"] == "resolved"
    assert ledger["leads"]["bad-species-name:Q1"]["resolved"] == TODAY
    assert ledger["leads"]["bad-species-name:Q2"]["status"] == "confirmed"


def test_human_decisions_survive_a_rerun():
    ledger = {"leads": {}}
    uc.merge(ledger, [_lead("Q1"), _lead("Q2")], {"Q1", "Q2"}, "2026-10-01")
    ledger["leads"]["bad-species-name:Q1"].update(status="edited", note="diff")
    ledger["leads"]["bad-species-name:Q2"].update(status="dismissed", note="real name")
    uc.merge(ledger, [_lead("Q1")], {"Q1", "Q2"}, TODAY)
    assert ledger["leads"]["bad-species-name:Q1"]["status"] == "edited"
    assert ledger["leads"]["bad-species-name:Q1"]["note"] == "diff"
    # Dismissed and absent: stays dismissed, never "resolved".
    assert ledger["leads"]["bad-species-name:Q2"]["status"] == "dismissed"


def test_a_resolved_lead_that_comes_back_is_reopened():
    """Vandalism gets reverted and then redone; the ledger must notice."""
    ledger = {"leads": {}}
    uc.merge(ledger, [_lead("Q1")], {"Q1"}, "2026-10-01")
    uc.merge(ledger, [], {"Q1"}, "2026-10-02")
    assert uc.merge(ledger, [_lead("Q1")], {"Q1"}, TODAY) == {"reopened": 1}
    assert ledger["leads"]["bad-species-name:Q1"]["status"] == "confirmed"


def _entity(qid, p225, label="", enwiki=""):
    return {"id": qid, "labels": {"en": {"value": label}} if label else {},
            "sitelinks": {"enwiki": {"title": enwiki}} if enwiki else {},
            "claims": {"P225": [{"rank": "normal", "mainsnak": {"datavalue": {"value": p225}}}]}}


def test_a_species_name_with_a_hidden_space_is_a_lead(monkeypatch):
    monkeypatch.setattr(uc, "name_history", lambda qid: None)
    lead = uc.check_species_name(_entity("Q1951353", "Tylototriton shanjing"))
    assert lead and "“Tylototriton shanjing”" in lead.edit


def test_a_nonsense_species_name_is_a_lead_only_with_a_witness(monkeypatch):
    """The right value must be on the item itself, never our guess."""
    monkeypatch.setattr(uc, "name_history", lambda qid: None)
    monkeypatch.setattr(uc, "qualifier_summary", lambda stmt: "")
    fixed = uc.check_species_name(_entity("Q1956228", "something about fish",
                                          label="Oreochromis lidole", enwiki="Oreochromis lidole"))
    assert fixed and "“Oreochromis lidole”" in fixed.edit
    assert uc.check_species_name(_entity("Q1", "something about fish")) is None
    assert uc.check_species_name(_entity("Q2", "Panthera leo")) is None


def test_refresh_pulls_a_fixed_name_back_and_drops_ancestors(monkeypatch):
    """Without this, a vandalised name scraped once stays in the game after
    Wikidata has been put right: the caches are never re-asked."""
    calls = []

    def fake(query, retries=3, strict=False):
        calls.append(strict)
        return [{"item": {"value": ENTITY + "QF"}, "sci": {"value": "Oreochromis lidole"},
                 "label": {"value": "Oreochromis lidole"}, "cn": {"value": "Lidole"},
                 "parent": {"value": ENTITY + "QG"}, "sl": {"value": "12"}}]

    monkeypatch.setattr(scraper, "sparql", fake)
    species = {"QF": {"common_name": "Cichlid", "common_names": ["Cichlid"],
                      "scientific_name": "something about fish", "sitelinks": 11,
                      "parent": "QG", "parents": ["QG"], "label": None}}
    ancestors = {"QA": {"sci": "Hippocamelus bisilcus"}, "QB": {"sci": "Cervidae"}}
    assert scraper.refresh_items(["QF", "QA", "QZ"], species, ancestors) == (1, 1)
    assert species["QF"]["scientific_name"] == "Oreochromis lidole"
    assert species["QF"]["common_names"] == ["Lidole"]
    assert "QA" not in ancestors and "QB" in ancestors
    assert calls == [True]


def test_the_ledger_names_only_items_whose_fix_should_be_pulled(tmp_path):
    path = tmp_path / "leads.json"
    path.write_text('{"leads": {'
                    '"a:Q1": {"qid": "Q1", "status": "edited"},'
                    '"a:Q2": {"qid": "Q2", "status": "resolved"},'
                    '"a:Q3": {"qid": "Q3", "status": "confirmed"},'
                    '"a:Q4": {"qid": "Q4", "status": "dismissed"}}}')
    assert scraper.ledger_qids(path) == ["Q1", "Q2"]
    assert scraper.ledger_qids(tmp_path / "missing.json") == []

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


# --------------------------------------------------------------------------
# Synonyms: one animal under two names, settled by two sources
# --------------------------------------------------------------------------
class FakeAuthority:
    def __init__(self, answers):
        self.answers = answers

    def lookup(self, name):
        return self.answers.get(name, {"status": "unknown", "accepted": None, "source": None})


def _species(sci, names, links=()):
    return {"scientific_name": sci, "common_name": names[0], "common_names": names,
            "sitelinks": 10, "parents": [], "synonym_links": [list(x) for x in links]}


ACCEPTED = {"status": "accepted", "source": "ITIS"}


def test_a_synonym_is_dropped_only_when_wikidata_and_the_authority_agree():
    """Regression: the Nilgiri tahr was in the tree twice, under Hemitragus and
    Nilgiritragus, so guessing one lost to the other."""
    species = {
        "QN": _species("Nilgiritragus hylocrius", ["Nilgiri tahr"], [("P1403", "QH")]),
        "QH": _species("Hemitragus hylocrius", ["Nilgiri Tahr", "Nilgiri-Tahr"]),
    }
    authority = FakeAuthority({
        "Nilgiritragus hylocrius": {**ACCEPTED, "accepted": "Nilgiritragus hylocrius"},
        "Hemitragus hylocrius": {"status": "synonym", "accepted": "Nilgiritragus hylocrius",
                                 "source": "ITIS"},
    })
    kept, report = scraper.drop_synonyms(species, authority)
    assert set(kept) == {"QN"}
    # Its own names only: the dropped item's must not win the name.
    assert kept["QN"]["common_names"] == ["Nilgiri tahr"]
    assert [r["verdict"] for r in report] == ["dropped"]


def test_a_link_the_authority_calls_two_species_changes_nothing():
    """Wikidata linked a vesper mouse to a woodrat as its "original
    combination"; the authority holds both accepted. A lead, not a drop."""
    species = {
        "QC": _species("Calomys lepidus", ["Andean vesper mouse"], [("P1403", "QW")]),
        "QW": _species("Neotoma lepida", ["Desert woodrat"]),
    }
    authority = FakeAuthority({
        "Calomys lepidus": {**ACCEPTED, "accepted": "Calomys lepidus"},
        "Neotoma lepida": {**ACCEPTED, "accepted": "Neotoma lepida"},
    })
    kept, report = scraper.drop_synonyms(species, authority)
    assert set(kept) == {"QC", "QW"}
    assert report[0]["verdict"] == "distinct"


def test_when_the_authority_disagrees_with_wikidata_nothing_is_dropped():
    """The authority itself can lag (ITIS on birds), so a reversed answer is
    unsettled, not a licence to drop the other one."""
    species = {
        "QP": _species("Pycnonotus melanoleucos", ["Black-and-white bulbul"], [("P1420", "QM")]),
        "QM": _species("Microtarsus melanoleucos", ["Black-and-white Bulbul"]),
    }
    authority = FakeAuthority({
        "Pycnonotus melanoleucos": {"status": "synonym", "accepted": "Microtarsus melanoleucos",
                                    "source": "ITIS"},
        "Microtarsus melanoleucos": {**ACCEPTED, "accepted": "Microtarsus melanoleucos"},
    })
    kept, report = scraper.drop_synonyms(species, authority)
    assert set(kept) == {"QP", "QM"}
    assert report[0]["verdict"] == "unsettled"


def test_synonym_links_are_fetched_once_and_strictly(monkeypatch):
    calls = []

    def fake(query, retries=3, strict=False):
        calls.append(strict)
        return [{"item": {"value": ENTITY + "QN"}, "p": {"value": "http://www.wikidata.org/prop/direct/P1403"},
                 "other": {"value": ENTITY + "QH"}}]

    monkeypatch.setattr(scraper, "sparql", fake)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    species = {"QN": _species("Nilgiritragus hylocrius", ["Nilgiri tahr"]),
               "QH": _species("Hemitragus hylocrius", ["Nilgiri Tahr"])}
    for s in species.values():
        del s["synonym_links"]
    assert scraper.repair_species_synonyms(species) == 2
    assert species["QN"]["synonym_links"] == [["P1403", "QH"]]
    assert species["QH"]["synonym_links"] == []          # asked, and none: a real answer
    assert scraper.repair_species_synonyms(species) == 0
    assert calls == [True]


def test_a_reopened_review_lead_comes_back_as_review_not_confirmed():
    ledger = {"leads": {}}
    lead = uc.Lead("disputed-synonym-link", "Q1", "s", "e", [], status="review", extra={"target": "Q2"})
    uc.merge(ledger, [lead], {"Q1"}, "2026-10-01")
    uc.merge(ledger, [], {"Q1"}, "2026-10-02")
    uc.merge(ledger, [lead], {"Q1"}, TODAY)
    assert ledger["leads"]["disputed-synonym-link:Q1>Q2"]["status"] == "review"


def test_a_disputed_link_is_a_lead_only_while_wikidata_still_makes_it():
    row = {"qid": "QC", "name": "Calomys lepidus", "links": "QW", "linked_name": "Neotoma lepida",
           "property": "P1403", "authority": "ITIS",
           "a": {"accepted": "Calomys lepidus"}, "b": {"accepted": "Neotoma lepida"}}
    linked = {"id": "QC", "claims": {"P1403": [
        {"rank": "normal", "mainsnak": {"datavalue": {"value": {"id": "QW"}}}}]}}
    lead = uc.check_synonym_link(linked, row)
    assert lead and lead.status == "review" and lead.key == "disputed-synonym-link:QC>QW"
    assert uc.check_synonym_link({"id": "QC", "claims": {}}, row) is None


def test_a_renamed_genus_is_a_lead_only_when_the_item_names_its_species_word(monkeypatch):
    """Sepia became "Sapia"; Hyelaphus is a new genus whose species items still
    say Axis. Only the first is provable from the genus item itself."""
    monkeypatch.setattr(uc, "name_history", lambda qid: None)
    monkeypatch.setattr(uc, "qualifier_summary", lambda stmt: "")
    monkeypatch.setattr(uc, "authority_links", lambda e: None)
    kids = ["Sepia apama", "Sepia officinalis"]
    lead = uc.check_genus_name(_entity("Q286026", "Sapia", label="Sepia",
                                       enwiki="Sepia (cephalopod)"), kids, "Sepia")
    assert lead and "from “Sapia” to “Sepia”" in lead.edit
    assert lead.extra["named"] == "Sepia"
    assert uc.check_genus_name(_entity("Q5955721", "Hyelaphus", label="Hyelaphus"),
                               ["Axis kuhlii", "Axis porcinus"], "Axis") is None
    # Fixed upstream: no lead, so the ledger resolves it.
    assert uc.check_genus_name(_entity("Q286026", "Sepia", label="Sepia"), kids, "Sepia") is None


def _rank_row(item, parent, rank):
    return {"item": {"value": ENTITY + item}, "parent": {"value": ENTITY + parent},
            "rank": {"value": "http://wikiba.se/ontology#" + rank}}


def test_a_preferred_parent_above_another_parent_is_a_review_lead(monkeypatch):
    """Diprotodontia prefers Mammalia over Marsupialia, which is inside it, so a
    truthy query files the kangaroos under the class. An unrelated normal
    parent (another classification) is not a skipped level."""
    rows = [_rank_row("QDIP", "QMAM", "PreferredRank"),
            _rank_row("QDIP", "QMAR", "NormalRank"),
            _rank_row("QOTH", "QMAM", "PreferredRank"),
            _rank_row("QOTH", "QELSE", "NormalRank")]
    monkeypatch.setattr(scraper, "sparql", lambda query, retries=3, strict=False: rows)
    monkeypatch.setattr(uc.time, "sleep", lambda *_: None)
    ancestors = {"QMAR": {"parents": ["QTHE"]}, "QTHE": {"parents": ["QMAM"]},
                 "QMAM": {"parents": []}, "QELSE": {"parents": ["QROOT"]}}
    hits = uc.preferred_skips(["QDIP", "QOTH"], ancestors)
    assert hits == {"QDIP": {"preferred": ["QMAM"], "beneath": ["QMAR"]}}

    monkeypatch.setattr(uc, "authority_links", lambda e: None)
    entity = {"id": "QDIP", "labels": {"en": {"value": "Diprotodontia"}}, "claims": {}}
    lead = uc.check_preferred_parent(entity, hits["QDIP"], {"QMAM": "Mammalia",
                                                            "QMAR": "Marsupialia"})
    assert lead.status == "review"
    assert "Mammalia (QMAM)" in lead.edit and "Marsupialia (QMAR)" in lead.edit

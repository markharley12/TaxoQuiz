"""Every parent a taxon has, and the most specific one chosen.

The bug these guard reached every scraped dataset: Wikidata gives many taxa
several P171 (parent taxon) statements, and the scraper kept whichever row came
back first. Chiroptera has eight, from Mammalia down to Scrotifera; the scrape
kept Mammalia, so a vampire bat scored exactly the same against a wolf, a human,
a kangaroo and a platypus. `validate_dataset.py` found it; 106 edges skipped a
whole rank tier the same way.

Offline, like the rest of the scraper tests: `scraper.sparql` is the one network
seam, and these replace it or the batch functions above it.
"""
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "datagen"))
import scraper  # noqa: E402

ENTITY = "http://www.wikidata.org/entity/"


def node(*parents: str, name: str | None = None) -> dict:
    """An ancestor as the fixed scraper caches it."""
    return {"label": name, "sci": name, "rank_qid": None,
            "parent": parents[0] if parents else None, "parents": sorted(parents)}


def leaf(*parents: str, name: str) -> dict:
    return {"common_name": name, "scientific_name": name, "sitelinks": 10,
            "parent": parents[0] if parents else None, "parents": sorted(parents)}


def path_to(tree: dict, name: str) -> list[str]:
    """Node names from the root down to `name`, or [] if it is not in the tree."""
    if tree["name"] == name:
        return [name]
    for child in tree.get("children", []):
        below = path_to(child, name)
        if below:
            return [tree["name"], *below]
    return []


# The bat lineage, with Chiroptera carrying both its broadest and its narrowest
# parent, as it does on Wikidata.
BAT_ANCESTORS = {
    "QMAM": node(name="Mammalia"),
    "QEUT": node("QMAM", name="Eutheria"),
    "QSCR": node("QEUT", name="Scrotifera"),
    "QCHI": node("QMAM", "QSCR", name="Chiroptera"),
    "QCAR": node("QSCR", name="Carnivora"),
}
BAT_SPECIES = {
    "QBAT": leaf("QCHI", name="vampire bat"),
    "QWOLF": leaf("QCAR", name="wolf"),
}


# --------------------------------------------------------------------------
# Fetching keeps every candidate
# --------------------------------------------------------------------------
def test_every_parent_row_of_a_taxon_is_kept_not_just_the_first(monkeypatch):
    def fake(query, retries=3):
        return [
            {"item": {"value": ENTITY + "QCHI"}, "sci": {"value": "Chiroptera"},
             "parent": {"value": ENTITY + "QMAM"}},
            {"item": {"value": ENTITY + "QCHI"}, "sci": {"value": "Chiroptera"},
             "parent": {"value": ENTITY + "QSCR"}},
            {"item": {"value": ENTITY + "QCHI"}, "sci": {"value": "Chiroptera"},
             "parent": {"value": ENTITY + "QMAM"}},   # a repeat, from another OPTIONAL
        ]

    monkeypatch.setattr(scraper, "sparql", fake)
    got = scraper.fetch_nodes_batch(["QCHI"])["QCHI"]
    assert got["parents"] == ["QMAM", "QSCR"]


def test_a_species_keeps_every_parent_even_when_its_rows_straddle_a_page(monkeypatch):
    rows = [("Q1", "QA"), ("Q2", "QG"), ("Q2", "QH")]   # page size 2 splits Q2

    def fake(query, retries=3):
        limit = int(re.search(r"LIMIT (\d+)", query).group(1))
        offset = int(re.search(r"OFFSET (\d+)", query).group(1))
        return [{
            "species": {"value": ENTITY + sid}, "commonName": {"value": f"n{sid}"},
            "scientificName": {"value": f"S {sid}"}, "sl": {"value": "10"},
            "parent": {"value": ENTITY + parent},
        } for sid, parent in rows[offset:offset + limit]]

    monkeypatch.setattr(scraper, "sparql", fake)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    got = scraper.fetch_species(10, page_size=2)
    assert got["Q2"]["parents"] == ["QG", "QH"]
    assert got["Q1"]["parents"] == ["QA"]


def test_the_ancestor_walk_fetches_every_candidate_not_only_the_first(monkeypatch):
    fetched = []

    def fake_batch(qids):
        fetched.extend(qids)
        return {q: BAT_ANCESTORS.get(q, node(name=q)) for q in qids}

    monkeypatch.setattr(scraper, "fetch_nodes_batch", fake_batch)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    scraper.fetch_all_ancestors({"QBAT": BAT_SPECIES["QBAT"]})
    # Scrotifera is reachable only through Chiroptera's second parent.
    assert "QSCR" in fetched


# --------------------------------------------------------------------------
# Building chooses the most specific
# --------------------------------------------------------------------------
def test_a_bat_hangs_from_its_most_specific_parent_not_from_mammalia():
    tree = scraper.build_tree(BAT_SPECIES, BAT_ANCESTORS)
    assert path_to(tree, "vampire bat") == [
        "Mammalia", "Eutheria", "Scrotifera", "Chiroptera", "vampire bat"]
    # And so a bat and a wolf meet at Scrotifera, not at the class.
    assert path_to(tree, "wolf")[:3] == ["Mammalia", "Eutheria", "Scrotifera"]


def test_the_order_candidates_arrive_in_does_not_change_the_choice():
    nodes = {k: {"parents": v["parents"]} for k, v in BAT_ANCESTORS.items()}
    forwards = scraper.choose_parents(nodes)
    nodes["QCHI"]["parents"] = list(reversed(nodes["QCHI"]["parents"]))
    assert scraper.choose_parents(nodes) == forwards
    assert forwards["QCHI"] == "QSCR"


def test_unrelated_placements_resolve_to_the_deeper_and_ties_reproducibly():
    nodes = {
        "QR": {"parents": []},
        "QA": {"parents": ["QR"]},                 # one step from the root
        "QB1": {"parents": ["QR"]},
        "QB": {"parents": ["QB1"]},                # two steps
        "QX": {"parents": ["QA", "QB"]},
        "QT1": {"parents": ["QR"]},
        "QT2": {"parents": ["QR"]},
        "QY": {"parents": ["QT2", "QT1"]},         # equally deep
    }
    chosen = scraper.choose_parents(nodes)
    assert chosen["QX"] == "QB"
    assert chosen["QY"] == "QT2"


def test_a_candidate_that_was_never_fetched_is_not_chosen():
    nodes = {"QMAM": {"parents": []}, "QCHI": {"parents": ["QMAM", "QNEVER"]}}
    assert scraper.choose_parents(nodes) == {"QMAM": None, "QCHI": "QMAM"}


def test_a_parent_cycle_in_wikidata_does_not_hang_the_build():
    ancestors = {
        "QROOT": node(name="Root"),
        "QA": node("QB", "QROOT", name="A"),
        "QB": node("QA", name="B"),
    }
    tree = scraper.build_tree({"QS": leaf("QA", name="leaf")}, ancestors)
    assert tree["name"] in {"Root", "Life"}


# --------------------------------------------------------------------------
# Repairing a cache from before the fix
# --------------------------------------------------------------------------
def test_cached_species_with_one_parent_are_repaired_and_only_once(monkeypatch):
    queries = []

    def fake(query, retries=3, **_):
        queries.append(query)
        return [{"item": {"value": ENTITY + "QBAT"}, "parent": {"value": ENTITY + p}}
                for p in ("QCHI", "QDESMO")]

    monkeypatch.setattr(scraper, "sparql", fake)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    species = {"QBAT": {"common_name": "vampire bat", "scientific_name": "D", "sitelinks": 10,
                        "parent": "QCHI"}}
    assert scraper.repair_species_parents(species) == 1
    assert species["QBAT"]["parents"] == ["QCHI", "QDESMO"]
    assert scraper.repair_species_parents(species) == 0
    assert len(queries) == 1


def test_a_species_wikidata_no_longer_parents_keeps_its_cached_parent(monkeypatch):
    monkeypatch.setattr(scraper, "sparql", lambda query, retries=3, **_: [])
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    species = {"Q1": {"common_name": "x", "scientific_name": "X", "sitelinks": 10, "parent": "QG"}}
    scraper.repair_species_parents(species)
    assert species["Q1"]["parents"] == ["QG"], "detaching a species would be worse"


def test_a_failed_parent_query_marks_nothing_repaired(monkeypatch):
    """Wikidata down must not be recorded as "these species have no more parents".

    `sparql` answers a query that has spent its retries with no rows, and for
    this query no rows means "keep the cached parent and mark it done" — so a
    502 at the wrong moment would have closed 400 species off from repair for
    good, in a run that looked successful.
    """
    def down(*args, **kwargs):
        raise scraper.requests.ConnectionError("Wikidata is down")

    monkeypatch.setattr(scraper.requests, "get", down)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    species = {"Q1": {"common_name": "x", "scientific_name": "X", "sitelinks": 10, "parent": "QG"}}
    with pytest.raises(RuntimeError):
        scraper.repair_species_parents(species)
    assert scraper.needs_parents(species["Q1"]), "left for the next run to repair"


def test_cached_ancestors_with_one_parent_are_refetched(monkeypatch):
    fetched = []

    def fake_batch(qids):
        fetched.extend(qids)
        return {q: BAT_ANCESTORS[q] for q in qids if q in BAT_ANCESTORS}

    monkeypatch.setattr(scraper, "fetch_nodes_batch", fake_batch)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    old = {k: {key: v[key] for key in ("label", "sci", "rank_qid", "parent")}
           for k, v in BAT_ANCESTORS.items()}
    out = scraper.fetch_all_ancestors({}, known=old)
    assert set(fetched) == set(BAT_ANCESTORS)
    assert out["QCHI"]["parents"] == ["QMAM", "QSCR"]



# --------------------------------------------------------------------------
# Common names: the same first-row-wins mistake, on names
# --------------------------------------------------------------------------
KOMODO = {"common_name": "Ora", "scientific_name": "Varanus komodoensis", "sitelinks": 99,
          "parent": "QVAR", "parents": ["QVAR"], "label": "Komodo dragon",
          "common_names": ["Komodo Dragon", "Komodo Monitor", "Komodo dragon", "Ora"]}


def test_the_komodo_dragon_is_named_by_its_label_not_by_the_first_row():
    """Regression: stage 1 kept the first English common name returned, which
    for the Komodo dragon was "Ora", so "Komodo" found only a rat."""
    assert scraper.common_name_of(KOMODO) == "Komodo dragon"


def test_a_label_that_is_not_one_of_the_common_names_does_not_win():
    """The label is a claim too: sometimes a binomial, sometimes another
    species' name. Without corroboration the choice is alphabetical, so it
    cannot flip between rebuilds."""
    s = {**KOMODO, "label": "Varanus komodoensis", "common_names": ["Ora", "Komodo monitor"]}
    assert scraper.common_name_of(s) == "Komodo monitor"
    assert scraper.common_name_of({**s, "common_names": ["Komodo monitor", "Ora"]}) == "Komodo monitor"


def test_a_cache_from_before_names_were_kept_still_names_its_species():
    assert scraper.common_name_of({"common_name": "Ora"}) == "Ora"


def test_every_english_common_name_row_is_kept(monkeypatch):
    rows = [("QK", "Ora"), ("QK", "Komodo dragon")]

    def fake(query, retries=3, **_):
        offset = int(re.search(r"OFFSET (\d+)", query).group(1))
        return [{
            "species": {"value": ENTITY + sid}, "commonName": {"value": name},
            "label": {"value": "Komodo dragon"}, "scientificName": {"value": "Varanus komodoensis"},
            "sl": {"value": "99"},
        } for sid, name in rows[offset:]]

    monkeypatch.setattr(scraper, "sparql", fake)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    got = scraper.fetch_species(10, page_size=5)["QK"]
    assert got["common_names"] == ["Komodo dragon", "Ora"]
    assert scraper.common_name_of(got) == "Komodo dragon"


def test_cached_species_names_are_repaired_and_only_once(monkeypatch):
    queries = []

    def fake(query, retries=3, **_):
        queries.append(query)
        return [{"item": {"value": ENTITY + "QK"}, "label": {"value": "Komodo dragon"},
                 "cn": {"value": name}} for name in ("Ora", "Komodo dragon")]

    monkeypatch.setattr(scraper, "sparql", fake)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    species = {"QK": {"common_name": "Ora", "scientific_name": "Varanus komodoensis", "sitelinks": 99}}
    assert scraper.repair_species_names(species) == 1
    assert scraper.common_name_of(species["QK"]) == "Komodo dragon"
    assert scraper.repair_species_names(species) == 0
    assert len(queries) == 1

"""Tests for incremental scraping — growing a dataset without refetching it.

The property under test is the one that makes a bigger scrape affordable: the
species set at a given sitelink threshold is a strict subset of the set at any
lower threshold, so lowering the threshold should only ever fetch the band in
between.

These tests are offline. `scraper.sparql` is the single network seam and every
test replaces it with a fake, so the suite runs in milliseconds and cannot be
broken by Wikidata being slow or down.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "datagen"))
import scraper  # noqa: E402


# --------------------------------------------------------------------------
# A fake Wikidata: species with sitelink counts, queried through the same
# FILTER clauses the real scraper emits.
# --------------------------------------------------------------------------
WORLD = {f"Q{i}": {"sl": sl} for i, sl in enumerate(
    # 6 species at each sitelink count from 3 to 12
    [sl for sl in range(3, 13) for _ in range(6)], start=1)}


def fake_sparql_factory(calls):
    """A `sparql` stand-in that honours >= / < FILTERs and LIMIT/OFFSET."""
    def fake(query, retries=3):
        calls.append(query)
        import re
        lo = int(re.search(r"\?sl >= (\d+)", query).group(1))
        hi = re.search(r"\?sl < (\d+)", query)
        hi = int(hi.group(1)) if hi else None
        limit = int(re.search(r"LIMIT (\d+)", query).group(1))
        offset = int(re.search(r"OFFSET (\d+)", query).group(1)) if "OFFSET" in query else 0
        hits = sorted(q for q, v in WORLD.items()
                      if v["sl"] >= lo and (hi is None or v["sl"] < hi))
        return [{
            "species": {"value": f"http://www.wikidata.org/entity/{q}"},
            "commonName": {"value": f"name-{q}"},
            "scientificName": {"value": f"Sci {q}"},
            "sl": {"value": str(WORLD[q]["sl"])},
        } for q in hits[offset:offset + limit]]
    return fake


@pytest.fixture
def calls(monkeypatch):
    seen = []
    monkeypatch.setattr(scraper, "sparql", fake_sparql_factory(seen))
    monkeypatch.setattr(scraper, "PAGE_SIZE", 25)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    return seen


# --------------------------------------------------------------------------
# cache_threshold — what threshold does an existing cache represent?
# --------------------------------------------------------------------------
def test_cache_threshold_reads_the_lowest_sitelink_count():
    cache = {"Q1": {"sitelinks": 10}, "Q2": {"sitelinks": 40}, "Q3": {"sitelinks": 12}}
    assert scraper.cache_threshold(cache) == 10


def test_cache_threshold_of_empty_cache_is_none():
    assert scraper.cache_threshold({}) is None


# --------------------------------------------------------------------------
# Band fetching
# --------------------------------------------------------------------------
def test_band_fetch_returns_only_the_band(calls):
    got = scraper.fetch_species(6, below=10)
    assert got, "band should not be empty"
    assert {v["sitelinks"] for v in got.values()} == {6, 7, 8, 9}


def test_band_plus_existing_equals_a_full_fetch(calls):
    """The subset property, end to end: fetching >=10 then the [6,10) band
    gives exactly the same set as fetching >=6 in one go."""
    incremental = scraper.fetch_species(10)
    incremental.update(scraper.fetch_species(6, below=10))
    full = scraper.fetch_species(6)
    assert set(incremental) == set(full)
    assert incremental == full


def test_band_fetch_is_cheaper_than_a_full_refetch(calls):
    """The whole point: the band must not re-request what we already hold."""
    band = scraper.fetch_species(6, below=10)
    full = scraper.fetch_species(6)
    cached = scraper.fetch_species(10)
    assert len(band) < len(full)
    # the band is exactly what a full fetch has that a warm >=10 cache lacks
    assert set(band) == set(full) - set(cached)


# --------------------------------------------------------------------------
# Deciding what to fetch — the bug this suite exists to prevent
# --------------------------------------------------------------------------
@pytest.mark.parametrize("have,want,expected", [
    (None, 6, (6, None)),   # cold cache -> full fetch
    (10,   6, (6, 10)),     # going bigger -> fetch only the gap
    (10,  10, None),        # unchanged -> fetch nothing
    (10,  20, None),        # going smaller -> cache is a superset, fetch nothing
])
def test_fetch_plan(have, want, expected):
    assert scraper.fetch_plan(have, want) == expected


def test_raising_the_threshold_actually_shrinks_the_result():
    """Regression: MIN_SITELINKS used to be ignored entirely when a cache
    existed, so a rebuild at any threshold returned the cached set unchanged."""
    cache = {f"Q{i}": {"sitelinks": sl, "common_name": f"n{i}",
                       "scientific_name": f"s{i}", "parent": None}
             for i, sl in enumerate([5, 10, 15, 20, 50])}
    assert len(scraper.at_threshold(cache, 10)) == 4
    assert len(scraper.at_threshold(cache, 20)) == 2
    assert len(scraper.at_threshold(cache, 5)) == 5


# --------------------------------------------------------------------------
# Ancestors must grow with the species set
# --------------------------------------------------------------------------
def test_ancestor_fetch_skips_what_is_already_known(monkeypatch):
    fetched = []

    def fake_batch(qids):
        fetched.extend(qids)
        return {q: {"label": f"L{q}", "rank_qid": None, "parent": None} for q in qids}

    monkeypatch.setattr(scraper, "fetch_nodes_batch", fake_batch)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)

    species = {"Q1": {"parent": "QA"}, "Q2": {"parent": "QB"}}
    known = {"QA": {"label": "A", "sci": "A", "rank_qid": None, "parent": None}}

    out = scraper.fetch_all_ancestors(species, known=known)
    assert "QB" in fetched, "the unknown parent must be fetched"
    assert "QA" not in fetched, "the known parent must NOT be refetched"
    assert "QA" in out and "QB" in out, "result must carry both"


def test_ancestor_walk_repairs_a_severed_lineage(monkeypatch):
    """A cached ancestor whose own parent is missing must be chased.

    Regression: the walk seeded `needed` from species parents only, so a batch
    that failed mid-lineage left a gap no later run could see — every species'
    parent was present, nothing looked missing, and the tree stayed severed.
    """
    fetched = []

    def fake_batch(qids):
        fetched.extend(qids)
        return {q: {"label": f"L{q}", "rank_qid": None,
                    "parent": "QROOT" if q == "QGAP" else None} for q in qids}

    monkeypatch.setattr(scraper, "fetch_nodes_batch", fake_batch)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)

    # Every species' parent (QGENUS) is cached, so a species-only seed sees
    # nothing to do — but QGENUS's own parent QGAP is absent.
    species = {"Q1": {"parent": "QGENUS"}}
    known = {"QGENUS": {"label": "G", "sci": "G", "rank_qid": None, "parent": "QGAP"}}

    out = scraper.fetch_all_ancestors(species, known=known)
    assert "QGAP" in fetched, "the missing mid-lineage node must be fetched"
    assert "QROOT" in out, "and the walk must continue past it to the root"


def test_node_with_no_english_label_falls_back_to_scientific_name(monkeypatch):
    """A taxon with no English label must still enter the tree.

    Regression: `rdfs:label` was a required clause, so Wikidata taxa that carry
    only a scientific name — Dinosauriformes (Q2740164) among them — returned no
    row and were dropped. Dropping one node detaches its whole subtree, which is
    how 10,625 species ended up outside Animalia with nothing reporting an error.
    """
    def fake(query, retries=3):
        return [
            {"item": {"value": "http://www.wikidata.org/entity/Q2740164"},
             "sci": {"value": "Dinosauriformes"},
             "parent": {"value": "http://www.wikidata.org/entity/Q616657"}},
            {"item": {"value": "http://www.wikidata.org/entity/Q1"},
             "label": {"value": "Animalia"}},
        ]

    monkeypatch.setattr(scraper, "sparql", fake)
    out = scraper.fetch_nodes_batch(["Q2740164", "Q1"])

    assert out["Q2740164"]["sci"] == "Dinosauriformes"
    assert out["Q2740164"]["label"] is None, "it genuinely has no English label"
    assert out["Q2740164"]["parent"] == "Q616657", "and its lineage must survive"
    assert out["Q1"]["label"] == "Animalia"


def test_both_names_are_kept_and_the_scientific_one_names_the_node(monkeypatch):
    """Wikidata's English label for a famous clade is the vernacular.

    Regression: label and scientific name were collapsed into one field with the
    label winning, so Q7377 entered the tree as "mammal" and "Mammalia" was
    fetched and discarded. 487 internal nodes in the current scrape, among them
    the five most recognisable clades in it. Both are stored now; the taxon name
    names the node and the label becomes its common name.
    """
    def fake(query, retries=3):
        return [
            {"item":  {"value": "http://www.wikidata.org/entity/Q7377"},
             "label": {"value": "mammal"},
             "sci":   {"value": "Mammalia"},
             "rank":  {"value": "http://www.wikidata.org/entity/Q37517"}},
        ]

    monkeypatch.setattr(scraper, "sparql", fake)
    ancestors = scraper.fetch_nodes_batch(["Q7377"])
    assert ancestors["Q7377"] == {
        "label": "mammal", "sci": "Mammalia", "rank_qid": "Q37517", "parent": None,
    }

    # The raw tree records both and inverts nothing — same shape as a species,
    # English name in `name`, taxon name in `scientific_name`. Choosing between
    # them is extract_game_tree.py's job.
    tree = scraper.build_tree({}, ancestors)
    assert tree["name"] == "mammal"
    assert tree["scientific_name"] == "Mammalia"
    assert tree["rank"] == "class"


def test_a_label_that_is_already_the_taxon_name_is_not_a_common_name(monkeypatch):
    """Most taxa label themselves in Latin, and have no vernacular to record."""
    def fake(query, retries=3):
        return [
            {"item":  {"value": "http://www.wikidata.org/entity/Q25306"},
             "label": {"value": "Carnivora"},
             "sci":   {"value": "Carnivora"}},
        ]

    monkeypatch.setattr(scraper, "sparql", fake)
    tree = scraper.build_tree({}, scraper.fetch_nodes_batch(["Q25306"]))
    assert tree["name"] == "Carnivora"
    assert tree["scientific_name"] == "Carnivora"


def test_ancestors_cached_without_a_scientific_name_are_refetched(monkeypatch):
    """The repair path for a cache built before both names were stored.

    Such an entry holds a label and no way to tell whether it is "Mammalia" or
    "mammal", so it has to be asked again — but only once. After the refetch the
    key is present even when Wikidata has no P225 for the node, so a later run
    leaves it alone.
    """
    fetched = []

    def fake_batch(qids):
        fetched.extend(qids)
        return {q: {"label": f"L{q}", "sci": None, "rank_qid": None, "parent": None}
                for q in qids}

    monkeypatch.setattr(scraper, "fetch_nodes_batch", fake_batch)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)

    old_cache = {"QA": {"label": "A", "rank_qid": None, "parent": None}}
    out = scraper.fetch_all_ancestors({}, known=old_cache)
    assert fetched == ["QA"], "the entry with no scientific name must be refetched"

    fetched.clear()
    scraper.fetch_all_ancestors({}, known=out)
    assert fetched == [], "and not again once it has been"

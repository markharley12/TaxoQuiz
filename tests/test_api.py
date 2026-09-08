"""Tests for `taxoquiz.api.main` — the HTTP surface over the game.

The API's own logic is thin; almost everything here is about the seams the
routes add on top of the game modules, and every one of them has a silent
failure mode:

- `resolve_dataset` must **reject** an unknown dataset rather than falling back
  to the default, for the same reason a wrong-dataset seed is rejected.
- `/taxon` merges `rank` and `common_name` in from the tree, because storing a
  second copy in taxon_info.json let it disagree with the tree it described.
- `/dataset` hands the frontend its colour anchor, which is a *percentile* of
  species depth and not the maximum — anchoring on the deepest lineage is the
  bug that made half of all games unable to look warm.

$TAXOQUIZ_DATA_DIR points at an empty tmp dir (see conftest), so "available"
means the example plus whatever the test wrote, on any machine.
"""
import pytest


from conftest import TINY_TREE


# --------------------------------------------------------------------------
# Dataset resolution — shared by every route
# --------------------------------------------------------------------------

def test_an_unknown_dataset_is_rejected_rather_than_defaulted(client):
    r = client.get("/dataset", params={"dataset": "nope"})
    assert r.status_code == 400
    assert "nope" in r.json()["detail"]
    assert "example" in r.json()["detail"], "and it says what there is instead"


@pytest.mark.parametrize("path,params", [
    ("/dataset", {}),
    ("/animal", {}),
    ("/animals", {"q": "a"}),
    ("/taxon/Animalia", {}),
    ("/explore", {}),
    ("/explore/lineage/Animalia", {}),
    ("/explore/search", {"q": "a"}),
    ("/explore/stats", {}),
])
def test_every_route_rejects_an_unknown_dataset(client, path, params):
    """The check is a shared dependency precisely so no route can forget it."""
    assert client.get(path, params={**params, "dataset": "nope"}).status_code == 400


def test_the_default_dataset_is_the_packaged_example(client):
    body = client.get("/dataset").json()
    assert body["dataset"] == "example"
    assert body["is_example"] is True
    assert body["species"] == 530


def test_a_dataset_on_disk_can_be_named_per_request(client, tiny):
    """One server holds every dataset at once — the choice is per request, not
    per process."""
    assert client.get("/dataset").json()["species"] == 530
    assert client.get("/dataset", params={"dataset": tiny}).json()["species"] == 4


# --------------------------------------------------------------------------
# /dataset and /datasets
# --------------------------------------------------------------------------

def test_dataset_carries_no_colour_anchor(client):
    """Colour comes from rank now, and a rank means the same thing everywhere.

    /dataset used to hand out `color_anchor_depth`, a per-dataset depth that the
    frontend divided into an LCA depth — 15 for the example, 68 for the scrape.
    Rank needs no such number: Genus is 0.83 in every dataset. The field is gone
    rather than left at a harmless default, so nothing can quietly go on scaling
    by it.
    """
    body = client.get("/dataset").json()
    assert "color_anchor_depth" not in body
    assert body["max_depth"] == 18       # still reported; it is descriptive


def test_dataset_reports_taxon_info_coverage(client):
    """Non-zero for the example without a scrape — the packaged copy is what
    makes a fresh clone's popups work."""
    assert client.get("/dataset").json()["taxon_info"] > 0


def test_datasets_lists_the_example_even_with_an_empty_data_dir(client):
    """It lives in the package, so there is always something to play."""
    names = [d["name"] for d in client.get("/datasets").json()]
    assert names == ["example"]


def test_datasets_is_sorted_smallest_first_as_a_difficulty_hint(client, write_dataset):
    write_dataset("small", TINY_TREE)
    write_dataset("smaller", {"name": "R", "rank": "Kingdom", "children": [
        {"name": "G", "rank": "Genus", "children": [
            {"name": "S a", "rank": "Species", "common_name": "a"},
        ]},
    ]})
    listed = client.get("/datasets").json()
    assert [d["name"] for d in listed] == ["smaller", "small", "example"]
    assert [d["species"] for d in listed] == [1, 4, 530]


def test_a_directory_without_a_tree_is_not_advertised(client, isolated_data):
    """A scrape still in progress must not be offered — picking it would only
    set up the raise in `tree_path`."""
    (isolated_data / "half-done").mkdir()
    assert [d["name"] for d in client.get("/datasets").json()] == ["example"]


# --------------------------------------------------------------------------
# /animal
# --------------------------------------------------------------------------

def test_starting_a_game_returns_an_animal_and_the_seed_that_names_it(client):
    body = client.get("/animal").json()
    assert body["daily"] is False
    replayed = client.get("/animal", params={"seed": body["seed"]}).json()
    assert replayed["animal"] == body["animal"]


def test_the_daily_is_flagged_and_repeats_within_the_day(client):
    first = client.get("/animal", params={"daily": True}).json()
    assert first["daily"] is True
    assert client.get("/animal", params={"daily": True}).json() == first


def test_replaying_a_seed_is_not_the_daily_even_when_daily_is_asked_for(client):
    """`seed` wins, and the flag must say so — the UI badges a daily game."""
    seed = client.get("/animal", params={"daily": True}).json()["seed"]
    assert client.get("/animal", params={"daily": True, "seed": seed}).json()["daily"] is False


@pytest.mark.parametrize("bad", ["nonsense", "ABCD", "ABCD-2345678"])
def test_a_malformed_seed_is_a_400_not_a_500(client, bad):
    r = client.get("/animal", params={"seed": bad})
    assert r.status_code == 400


def test_an_empty_seed_param_means_no_seed_rather_than_a_bad_one(client):
    """`?seed=` is falsy and starts a fresh game, which is the same thing
    omitting it does. Worth pinning: a UI that always sends the field would
    otherwise get a 400 on every new game."""
    assert client.get("/animal", params={"seed": ""}).status_code == 200


def test_a_seed_from_another_dataset_is_rejected(client, tiny):
    """The end-to-end version of the seed fingerprint: a 530-species seed must
    not resolve to something plausible on a 4-species dataset."""
    seed = client.get("/animal").json()["seed"]
    r = client.get("/animal", params={"seed": seed, "dataset": tiny})
    assert r.status_code == 400
    assert "different dataset" in r.json()["detail"]


def test_seed_defaults_to_none_not_to_a_query_object(client):
    """Regression: written as `= Query(None)` the default leaks through as a
    Query *object* whenever the handler is called directly rather than over
    HTTP, and fails with "'Query' object has no attribute 'upper'"."""
    from taxoquiz.api.main import new_game
    game = new_game(dataset="example")
    assert isinstance(game.animal, str) and isinstance(game.seed, str)


# --------------------------------------------------------------------------
# /animals — autocomplete
# --------------------------------------------------------------------------

def test_autocomplete_matches_a_substring_case_insensitively(client):
    assert "lion" in client.get("/animals", params={"q": "LIO"}).json()


def test_autocomplete_honours_the_limit(client):
    assert len(client.get("/animals", params={"q": "a", "limit": 3}).json()) == 3


def test_autocomplete_excludes_what_has_already_been_guessed(client):
    with_lion = client.get("/animals", params={"q": "lion"}).json()
    without = client.get("/animals", params={"q": "lion", "exclude": ["lion"]}).json()
    assert "lion" in with_lion and "lion" not in without


def test_autocomplete_searches_common_names_only(client):
    """Only a species can be guessed, so only common names are offered — unlike
    explore's search, where a clade is a destination."""
    assert client.get("/animals", params={"q": "Panthera"}).json() == []


@pytest.mark.parametrize("limit", [0, 201])
def test_an_out_of_range_limit_is_a_422(client, limit):
    assert client.get("/animals", params={"q": "a", "limit": limit}).status_code == 422


# --------------------------------------------------------------------------
# /game/state
# --------------------------------------------------------------------------

def test_game_state_returns_the_annotated_tree(client):
    r = client.post("/game/state", json={"secret": "lion", "guesses": ["tiger"]})
    assert r.status_code == 200
    body = r.json()
    assert body["label"] == "Animalia"
    assert {"name", "label", "node_type", "depth", "on_secret_path", "children"} <= set(body)


def test_game_state_rejects_an_unknown_name_with_400(client):
    r = client.post("/game/state", json={"secret": "lion", "guesses": ["griffin"]})
    assert r.status_code == 400
    assert "griffin" in r.json()["detail"]


def test_game_state_is_scoped_to_the_named_dataset(client, tiny):
    """A name valid in one dataset must not be honoured against another."""
    r = client.post("/game/state", params={"dataset": tiny},
                    json={"secret": "lion", "guesses": []})
    assert r.status_code == 400


# --------------------------------------------------------------------------
# /taxon
# --------------------------------------------------------------------------

def test_taxon_info_merges_rank_and_common_name_in_from_the_tree(client, write_dataset):
    """Neither is stored in taxon_info.json — a second copy is free to disagree
    with the tree it describes."""
    write_dataset("d", TINY_TREE, {"Alpha one": {"extract": "about it"}})
    body = client.get("/taxon/Alpha one", params={"dataset": "d"}).json()
    assert body["extract"] == "about it"
    assert body["rank"] == "Species"
    assert body["common_name"] == "one"


def test_common_name_is_empty_above_species(client, write_dataset):
    write_dataset("d", TINY_TREE, {"LeftA": {"extract": "a genus"}})
    body = client.get("/taxon/LeftA", params={"dataset": "d"}).json()
    assert body["rank"] == "Genus"
    assert body["common_name"] == ""


def test_taxon_info_works_for_species_as_well_as_taxa(client):
    """Species were excluded originally, which left the things you actually
    guess as the only nodes you could not read about."""
    assert client.get("/taxon/Panthera leo").status_code == 200
    assert client.get("/taxon/Carnivora").status_code == 200


def test_a_node_with_no_article_is_a_404(client):
    """~3% of nodes have none. The client caches this as firmly as a hit."""
    assert client.get("/taxon/Not A Taxon").status_code == 404


def test_a_dataset_without_taxon_info_degrades_to_404s_rather_than_failing(client, tiny):
    """The popup is the one optional feature; the game must still start."""
    assert client.get("/dataset", params={"dataset": tiny}).status_code == 200
    assert client.get("/taxon/Alpha one", params={"dataset": tiny}).status_code == 404


def test_a_custom_dataset_never_borrows_the_examples_taxon_info(client, tiny):
    """The fallback is limited to the example on purpose: showing one tree's
    text against another tree's nodes is the exact mismatch datasets prevent.

    `Carnivora` has an article in the packaged example and is absent from the
    tiny tree, so a leaking fallback would answer 200 here.
    """
    assert client.get("/taxon/Carnivora").status_code == 200
    assert client.get("/taxon/Carnivora", params={"dataset": tiny}).status_code == 404


# --------------------------------------------------------------------------
# Explore routes
# --------------------------------------------------------------------------

def test_explore_defaults_to_the_root_and_a_node_budget(client):
    body = client.get("/explore").json()
    assert body["name"] == "Animalia"
    assert body["species_count"] == 530


def test_explore_rejects_an_unknown_root_with_404(client):
    """Rather than falling back to the tree root — showing all of Animalia when
    you asked for Aves looks like it worked."""
    r = client.get("/explore", params={"root": "Nothing"})
    assert r.status_code == 404


def test_explore_no_limit_is_spelled_as_minus_one(client, tiny):
    """A sentinel rather than `int | None`: `?budget=` will not parse as an int,
    and omitting it already means "use the default"."""
    whole = client.get("/explore", params={"dataset": tiny, "budget": -1, "depth": -1}).json()
    assert whole["truncated"] is False
    assert whole["children"][0]["children"][0]["children"] != []


def test_explore_lineage_returns_the_path_and_the_spine_in_one_request(client):
    body = client.get("/explore/lineage/Panthera leo").json()
    assert body["path"][0] == "Animalia"
    assert body["path"][-1] == "Panthera leo"
    assert body["tree"]["name"] == "Animalia"


def test_explore_search_finds_clades_as_well_as_species(client):
    names = [h["name"] for h in client.get("/explore/search", params={"q": "panthera"}).json()]
    assert "Panthera" in names, "a genus is a destination in explore mode"
    assert "Panthera leo" in names


def test_explore_stats_describes_the_whole_tree(client):
    assert client.get("/explore/stats").json() == {
        "root": "Animalia", "nodes": 1609, "species": 530, "max_depth": 18,
    }

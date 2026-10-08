"""Range maps shown as a species' picture, and their replacement.

About 2,000 species of the Sep 2026 scrape wore a range map as their node
thumbnail, because Wikipedia's page image is whatever the infobox shows first.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "datagen"))

import scrape_taxon_info as sti  # noqa: E402

THUMB = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/{f}/330px-{f}"


def test_maps_are_recognised_by_whole_words():
    for f in ["Etheridgeum_pulchrum_distribution.png", "Greytail-skate-rangemap.png",
              "Hexanchus_nakamurai_vitulus_distmap.png", "Liberian_Mongoose_area.png",
              "Mapa_Barbus_haasi.png", "Distribution_of_Leimacomys_buettneri.tif.jpg"]:
        assert sti.is_map_image(THUMB.format(f=f)), f


def test_photographs_with_map_like_substrings_are_not_maps():
    """Each of these matched an earlier substring rule."""
    for f in ["Scartella_cristata_25-09-07_DSCF1035.jpg", "Cercartetus_nanus.jpg",
              "Orange_roughy.png", "Southern_ningaui_captured_in_the_Middleback_Ranges.jpg",
              "Dologale_Dybowskii_-_Chinko_Project_Area_-_20120516.jpg"]:
        assert not sti.is_map_image(THUMB.format(f=f)), f


def _entries():
    return {
        "Has photo": {"qid": "Q1", "image_url": THUMB.format(f="A_range.png")},
        "Only a map": {"qid": "Q2", "image_url": THUMB.format(f="B_range.png")},
        "No image": {"qid": "Q3", "image_url": THUMB.format(f="C_range.png")},
        "Not asked": {"qid": "Q4", "image_url": THUMB.format(f="D_range.png")},
        "Photo already": {"qid": "Q5", "image_url": THUMB.format(f="E.jpg")},
    }


def test_a_map_is_replaced_by_wikidatas_photo_and_marked(monkeypatch):
    # Q4's batch "failed": Wikidata never answered for it.
    monkeypatch.setattr(sti, "wikidata_images", lambda qids: (
        {"Q1": "A photo.jpg", "Q2": "B distribution.png"}, {"Q1", "Q2", "Q3"}))
    monkeypatch.setattr(sti, "commons_thumbs", lambda files: {
        f: "https://thumb/" + f for f in files})
    results = _entries()
    assert sti.replace_map_images(results) == (1, 2)
    assert results["Has photo"]["image_url"] == "https://thumb/A photo.jpg"
    assert results["Has photo"]["image_from"] == "wikidata"
    assert results["Only a map"]["image_from"] == "wikipedia-map"
    assert results["No image"]["image_from"] == "wikipedia-map"
    # Unanswered is not "no image": left as it was, to be asked again.
    assert "image_from" not in results["Not asked"]
    assert "image_from" not in results["Photo already"]


def test_a_rerun_asks_only_about_undecided_entries(monkeypatch):
    asked = []
    monkeypatch.setattr(sti, "wikidata_images", lambda qids: (asked.extend(qids), ({}, set(qids)))[1])
    monkeypatch.setattr(sti, "commons_thumbs", lambda files: {})
    results = _entries()
    results["Has photo"]["image_from"] = "wikidata"
    results["Only a map"]["image_from"] = "wikipedia-map"
    sti.replace_map_images(results)
    assert sorted(asked) == ["Q3", "Q4"]

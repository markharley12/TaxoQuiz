"""extract_game_tree.py: the raw scrape into a tree the game can load.

Every leaf of a game tree is a guessable animal and a possible secret, so what
matters here is that nothing becomes a leaf without being a species. The Sep 2026
rebuild broke that 189 times: taxa with nothing under them, stamped "Species" by
`convert`, among them Apo-Chiroptera, which showed up as a bat photograph and a
dead end beside the real bats.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "datagen"))
import extract_game_tree as extract  # noqa: E402
from validate_dataset import check_shape, validate  # noqa: E402


def raw(name, rank, *children, sci=None):
    """A node as the scraper writes it: English name in `name`."""
    out = {"name": name, "rank": rank, "scientific_name": sci or name}
    if children:
        out["children"] = list(children)
    return out


def bat():
    return raw("common vampire bat", "species", sci="Desmodus rotundus")


def leaf_names(tree):
    return [leaf["name"] for leaf in extract.iter_leaves(tree)]


def test_a_clade_whose_child_went_elsewhere_is_dropped_not_made_a_species():
    tree = raw("mammal", "class",
               raw("Pegasoferae", "clade", raw("Chiroptera", "order", bat())),
               raw("Apo-Chiroptera", "clade"),
               sci="Mammalia")
    kept, dropped = extract.drop_childless_taxa(tree)
    assert leaf_names(kept) == ["common vampire bat"]
    assert dropped == 1


def test_a_taxon_left_empty_by_dropping_is_dropped_too():
    tree = raw("mammal", "class",
               raw("Chiroptera", "order", bat()),
               raw("Emptied", "clade", raw("Lonely", "genus")),
               sci="Mammalia")
    kept, dropped = extract.drop_childless_taxa(tree)
    assert [child["name"] for child in kept["children"]] == ["Chiroptera"]
    assert dropped == 2


def test_a_tree_with_no_species_at_all_comes_back_empty():
    assert extract.drop_childless_taxa(raw("Nothing", "clade", raw("Lonely", "genus"))) == (None, 2)


def test_every_leaf_of_an_extracted_tree_is_a_species():
    tree = raw("mammal", "class",
               raw("Chiroptera", "order", bat()),
               raw("Apo-Chiroptera", "clade"),
               sci="Mammalia")
    kept, _ = extract.drop_childless_taxa(tree)
    game = extract.convert(kept, {id(leaf): leaf["name"] for leaf in extract.iter_leaves(kept)})
    assert validate(game, "extracted", checks=(check_shape,)).ok


def test_a_leaf_that_slips_through_keeps_its_rank_so_the_validator_refuses_it():
    """Defence in depth. `convert` used to stamp "Species" on every leaf, which is
    exactly what let the shape check wave 189 fake species through."""
    stray = raw("Apo-Chiroptera", "clade")
    species = bat()
    tree = raw("mammal", "class", raw("Chiroptera", "order", species), stray, sci="Mammalia")
    game = extract.convert(tree, {id(species): species["name"], id(stray): stray["name"]})
    assert not validate(game, "unpruned", checks=(check_shape,)).ok


def test_a_species_named_like_its_genus_is_kept():
    """Regression: collapse_nested_duplicates dropped a leaf repeating its
    parent's name, and the raw tree names a species in English — so a monotypic
    genus called what its only species is called lost the species. 63 of them,
    the hippopotamus among them."""
    hippo = raw("Hippopotamus", "species", sci="Hippopotamus amphibius")
    tree = raw("Hippopotamidae", "family", raw("Hippopotamus", "genus", hippo))
    kept, dropped = extract.drop_childless_taxa(extract.collapse_nested_duplicates(tree))
    assert leaf_names(kept) == ["Hippopotamus"]
    assert dropped == 0


def test_common_names_that_differ_only_in_case_are_told_apart():
    a = raw("Pacific Lamprey", "species", sci="Lampetra tridentata")
    b = raw("Pacific lamprey", "species", sci="Entosphenus tridentatus")
    names, collisions = extract.disambiguate_common_names([a, b])
    assert names[id(a)] == "Pacific Lamprey (Lampetra tridentata)"
    assert names[id(b)] == "Pacific lamprey (Entosphenus tridentatus)"
    assert collisions == 2


def test_one_taxon_filed_twice_still_gets_two_names():
    """Wikidata has two items for the Sooty Shrikethrush, with one binomial, so
    appending the binomial alone left the names identical."""
    a = raw("Sooty Shrikethrush", "species", sci="Colluricincla tenebrosa")
    b = raw("Sooty Shrikethrush", "species", sci="Colluricincla tenebrosa")
    names, _ = extract.disambiguate_common_names([a, b])
    assert len({names[id(a)].lower(), names[id(b)].lower()}) == 2

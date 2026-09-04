from collections import namedtuple
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel

from ..game.pick_animal import pick_animal
from ..game.list_animals import list_animals, DEFAULT_LIMIT
from ..game.game_state import get_game_state
from ..game.tree import common_name_of, load_tree, get_species, rank_of
from .. import explore
from ..jsonio import read_json
from ..paths import (
    EXAMPLE_DATASET, available_datasets, current_dataset, taxon_info_read_path, tree_path,
)

app = FastAPI(title="TaxoQuiz", description="TaxoQuiz game API")


def resolve_dataset(
    dataset: Annotated[str | None, Query(description="Dataset to play on; server default if unset")] = None,
) -> str:
    """Validate and default the `dataset` query param, shared by every route.

    Every route depends on this rather than reading `current_dataset()`
    directly, so a request can name any dataset on disk, not just the one
    picked by $TAXOQUIZ_DATASET at server startup — the server now holds all
    of them at once. An unknown name is rejected with 400 rather than quietly
    falling back to the default, the same way a seed for the wrong dataset is
    rejected rather than silently resolving to a different animal.
    """
    name = dataset or current_dataset()
    available = available_datasets()
    if name not in available:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown dataset {name!r}. Available: {', '.join(available)}.",
        )
    return name


# Per-dataset taxon info / rank / common-name lookups, built on first request
# for a given dataset and cached after. Used to be built once at import time
# for the single dataset $TAXOQUIZ_DATASET named — now any number of datasets
# can be requested in the lifetime of one server process.
_DatasetData = namedtuple("DatasetData", "taxon_info rank_by_name common_by_name")
_dataset_data_cache: dict[str, _DatasetData] = {}


def _dataset_data(dataset: str) -> _DatasetData:
    if dataset not in _dataset_data_cache:
        tree = load_tree(tree_path(dataset))
        # Optional: only the taxon-info popup needs this, and it is generated
        # by the datagen/ pipeline rather than shipped. A dataset starts fine
        # without it, and the popup reports "no information available".
        info_path = taxon_info_read_path(dataset)
        taxon_info = read_json(info_path) if info_path else {}
        # name -> rank / common name, from the tree. The tree is the single
        # source of truth for both; taxon_info.json stores neither, so they
        # cannot disagree.
        _dataset_data_cache[dataset] = _DatasetData(
            taxon_info, rank_of(tree), common_name_of(tree)
        )
    return _dataset_data_cache[dataset]


def _species_depths(node: dict, depth: int = 0, out: list | None = None) -> list:
    out = [] if out is None else out
    if not node.get("children"):
        out.append(depth)
    else:
        for child in node["children"]:
            _species_depths(child, depth + 1, out)
    return out


# Percentile of species depth used as the "fully green" end of the colour scale.
#
# Anchoring on the deepest lineage in the tree sounds right and plays badly: in
# the Wikidata scrape that is Human at 59 of a 64-deep tree, while the median
# species sits at 26. Scaled against 64, a median secret tops out yellow-orange
# even when you guess its own genus — so more than half of all games could never
# look warm however well they were played. A high percentile keeps the scale
# absolute (a given depth is always the same colour, and nothing about the
# secret leaks) while letting a typical game actually reach green. Depths past
# the anchor clamp.
COLOR_ANCHOR_PERCENTILE = 75


@app.get("/dataset", tags=["dataset"])
def dataset(dataset: Annotated[str, Depends(resolve_dataset)]):
    """Which dataset is loaded, how big it is, and how to colour it.

    Exists because "am I playing the example or my own scrape?" was otherwise
    unanswerable without reading the environment — and because the frontend
    needs the depth scale, which differs by a factor of three between datasets.
    """
    tree = load_tree(tree_path(dataset))
    depths = sorted(_species_depths(tree))
    anchor = depths[min(len(depths) - 1, len(depths) * COLOR_ANCHOR_PERCENTILE // 100)]
    return {
        "dataset": dataset,
        "is_example": dataset == EXAMPLE_DATASET,
        "available": available_datasets(),
        "path": str(tree_path(dataset)),
        "root": tree["name"],
        "species": len(depths),
        "max_depth": depths[-1],
        "color_anchor_depth": anchor,
        "taxon_info": len(_dataset_data(dataset).taxon_info),
    }


@app.get("/datasets", tags=["dataset"])
def datasets():
    """Every dataset on disk, with enough to render a picker.

    Species count doubles as a difficulty hint in the UI — more species, more
    ways to be wrong — so it's sorted smallest (easiest) first.
    """
    out = []
    for name in available_datasets():
        tree = load_tree(tree_path(name))
        depths = _species_depths(tree)
        out.append({
            "name": name,
            "species": len(depths),
            "max_depth": max(depths),
            "is_example": name == EXAMPLE_DATASET,
        })
    out.sort(key=lambda d: d["species"])
    return out


class NewGame(BaseModel):
    animal: str
    seed: str
    daily: bool


@app.get("/animal", response_model=NewGame, tags=["animals"])
def new_game(
    dataset: Annotated[str, Depends(resolve_dataset)],
    daily: bool = False,
    # Annotated, so the default really is None. Written as `= Query(None, ...)`
    # the default is a Query *object*, which FastAPI substitutes over HTTP but
    # which leaks straight through when the handler is called directly — from a
    # test, or the CLI — and fails with "'Query' object has no attribute 'upper'".
    seed: Annotated[str | None, Query(description="Replay a shared seed")] = None,
):
    """Start a game, returning the secret animal and the seed that names it.

    Every game has a seed so it can be handed to someone else; `daily=true` uses
    the seed derived from today's date, which is what makes the daily the same
    for everyone. Passing `seed` replays that exact game and ignores `daily`.

    400 if the seed is malformed or was made for a different dataset — a seed
    must never quietly resolve to a different animal than the sender got.
    """
    try:
        animal, resolved = pick_animal(seed=seed, daily=daily, dataset=dataset)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return NewGame(animal=animal, seed=resolved, daily=daily and not seed)


@app.get("/animals", response_model=list[str], tags=["animals"])
def autocomplete(
    dataset: Annotated[str, Depends(resolve_dataset)],
    q: str = Query(..., description="Substring to search for"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=200),
    exclude: list[str] = Query(default=[], description="Animal names to exclude from results"),
):
    """Return up to `limit` animal common names containing `q`."""
    return list_animals(q, limit, set(exclude) or None, dataset=dataset)


class GameStateRequest(BaseModel):
    secret: str
    guesses: list[str]


@app.post("/game/state", tags=["game"])
def game_state(body: GameStateRequest, dataset: Annotated[str, Depends(resolve_dataset)]):
    """
    Return the annotated tree for the current game state.

    Each node carries `label`, `node_type`, `depth`, `on_secret_path`, and `children`.
    Returns 400 if any name (secret or guess) is not in the dataset.
    """
    try:
        return get_game_state(body.secret, body.guesses, dataset=dataset)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/taxon/{name}", tags=["taxon"])
def taxon_info(name: str, dataset: Annotated[str, Depends(resolve_dataset)]):
    """Return Wikipedia summary and image for a taxon node.

    Works for species as well as internal taxa: a leaf is a node like any other
    and `name` is its scientific name, which is unique across the tree.

    `rank` and `common_name` are merged in from the tree rather than read from
    taxon_info.json. They used to be stored there too, which made them a second
    copy of something the tree already defines and free to disagree with it.
    `common_name` is empty for everything above species.
    """
    data = _dataset_data(dataset)
    info = data.taxon_info.get(name)
    if info is None:
        raise HTTPException(status_code=404, detail=f"No info for '{name}'")
    return {
        **info,
        "rank": data.rank_by_name.get(name, ""),
        "common_name": data.common_by_name.get(name, ""),
    }


# ---------------------------------------------------------------- explore mode

# How many nodes one browse request returns. Enough to see where a group divides
# and to give the next click somewhere to go, without shipping a subtree nobody
# asked to look at.
#
# A node budget rather than a depth limit because depth is the wrong knob on a
# real taxonomy: the Wikidata tree opens with a single-child chain, so three
# levels from the root is nine nodes, while three levels from a bushy genus is
# hundreds. See explore._select.
EXPLORE_DEFAULT_BUDGET = 200

# `depth` and `budget` value meaning "no limit". Both unlimited is the full
# tree: 27k nodes and ~5MB on a Wikidata scrape. Supported on purpose — it is
# what "expand everything" asks for — but it is a value you have to ask for,
# and the client warns first.
#
# A sentinel rather than `int | None`: with a non-None default, the only way to
# send None over a query string is to omit the parameter, which already means
# "use the default". `?depth=` fails to parse as an int.
EXPLORE_NO_LIMIT = -1


def _limit(value: int) -> int | None:
    return None if value == EXPLORE_NO_LIMIT else value


@app.get("/explore", tags=["explore"])
def explore_subtree(
    dataset: Annotated[str, Depends(resolve_dataset)],
    root: Annotated[str | None, Query(description="Taxon to start from; the tree root if unset")] = None,
    depth: Annotated[int, Query(ge=EXPLORE_NO_LIMIT, le=100, description="Levels to include; -1 for no limit")] = EXPLORE_NO_LIMIT,
    budget: Annotated[int, Query(ge=EXPLORE_NO_LIMIT, le=100_000, description="Max nodes; -1 for no limit")] = EXPLORE_DEFAULT_BUDGET,
):
    """Return a slice of the tree for browsing, with no game state attached."""
    try:
        return explore.subtree(root=root, depth=_limit(depth), budget=_limit(budget), dataset=dataset)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/explore/lineage/{name}", tags=["explore"])
def explore_lineage(name: str, dataset: Annotated[str, Depends(resolve_dataset)]):
    """Jump to `name`: the root-down spine with siblings, plus the name chain.

    Returned as one response rather than leaving the client to walk `path` and
    fetch each ancestor, which was seventeen round trips for a deep species.
    """
    try:
        return explore.lineage(name, dataset=dataset)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/explore/search", tags=["explore"])
def explore_search(
    dataset: Annotated[str, Depends(resolve_dataset)],
    q: Annotated[str, Query(description="Substring of a scientific or common name")],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
):
    """Search every node, not just species — in explore mode a clade is a destination."""
    return explore.search(q, limit, dataset=dataset)


@app.get("/explore/stats", tags=["explore"])
def explore_stats(dataset: Annotated[str, Depends(resolve_dataset)]):
    """Node and species totals, so the UI can say what a full expand would cost."""
    return explore.stats(dataset=dataset)

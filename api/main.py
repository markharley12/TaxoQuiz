from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

from game.pick_animal import pick_random_animal
from game.list_animals import list_animals, DEFAULT_LIMIT
from game.game_state import get_game_state

app = FastAPI(title="TaxoQuiz", description="TaxoQuiz game API")


@app.get("/animal/random", response_model=str, tags=["animals"])
def random_animal(daily: bool = False):
    """Pick a random animal. Pass `daily=true` for today's seeded daily animal."""
    return pick_random_animal(daily=daily)


@app.get("/animals", response_model=list[str], tags=["animals"])
def autocomplete(
    q: str = Query(..., description="Substring to search for"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=200),
):
    """Return up to `limit` animal common names containing `q`."""
    return list_animals(q, limit)


class GameStateRequest(BaseModel):
    secret: str
    guesses: list[str]


@app.post("/game/state", tags=["game"])
def game_state(body: GameStateRequest):
    """
    Return the annotated tree for the current game state.

    Each node carries `label`, `node_type`, `depth`, `on_secret_path`, and `children`.
    Returns 400 if any name (secret or guess) is not in the dataset.
    """
    try:
        return get_game_state(body.secret, body.guesses)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

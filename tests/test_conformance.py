"""The TypeScript engine's golden file must be what Python says today.

See `conformance.py`. This is the half of the check that belongs to Python: the
frontend suite proves TypeScript agrees with `conformance.json`, and this proves
`conformance.json` agrees with the game — without both, a rule changed here
would leave the phone quietly playing the old one.
"""
import json

from conformance import GOLDEN, build, render


def test_the_typescript_engine_is_checked_against_what_python_answers_now():
    current = json.loads(render(build()))
    committed = json.loads(GOLDEN.read_text(encoding="utf-8"))
    # A bare boolean: pytest's diff of two ~300KB structures is slower to render
    # than it is useful, and the fix is the same whatever differs.
    up_to_date = committed == current
    assert up_to_date, (
        f"{GOLDEN.name} is stale. Regenerate it with "
        f"`.venv/bin/python tests/conformance.py`, then make "
        f"`npm test` in frontend/ pass against it."
    )

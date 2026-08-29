"""Shareable game seeds.

A seed identifies one game: the same seed always gives the same secret animal,
so two people can play the same round independently. Daily mode is the same
mechanism with the seed derived from the date rather than chosen at random.

Format is `FFFF-BBBBBB`, e.g. `3KQ7-2M9XPT`:

- `FFFF` fingerprints the **dataset**. The example ships 530 species and a full
  scrape has 18,421, so the same body would otherwise mean a different animal
  depending on who you sent it to — and silently, which is the worst version.
  A mismatch is rejected with a message saying so.
- `BBBBBB` is the body: random for practice, derived from the date for daily.

The alphabet excludes I, L, O and U, so a seed can be read aloud or retyped
without 1/I or 0/O confusion.

Seeds are deliberately *not* secret. The mapping is a plain hash of a public
species list, so someone who wants to work out their own seed's answer from the
source can. That is a fair trade for seeds being short, offline-checkable and
requiring no server state; there is nothing to protect here beyond making the
answer non-obvious at a glance.
"""

import hashlib
import secrets
from datetime import date

# Crockford-style: no I, L, O, U.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
FINGERPRINT_LEN = 4
BODY_LEN = 6


def _encode(digest: bytes, length: int) -> str:
    n = int.from_bytes(digest, "big")
    out = []
    for _ in range(length):
        n, rem = divmod(n, len(ALPHABET))
        out.append(ALPHABET[rem])
    return "".join(reversed(out))


def fingerprint(species: list[dict]) -> str:
    """A short, stable tag for the dataset's species list.

    Derived from the names in tree order, so any change to the dataset — a
    different scrape, a different `MIN_SITELINKS`, a re-extraction that drops
    species — produces a different tag and old seeds stop resolving instead of
    quietly pointing at something else.
    """
    h = hashlib.sha256()
    for s in species:
        h.update(s["common_name"].encode())
        h.update(b"\n")
    return _encode(h.digest(), FINGERPRINT_LEN)


def _body_for_date(day: date) -> str:
    return _encode(hashlib.sha256(f"taxoquiz-daily:{day.isoformat()}".encode()).digest(), BODY_LEN)


def new_body() -> str:
    """A random seed body. `secrets` rather than `random` so concurrent games
    on the same process cannot land on the same seed."""
    return "".join(secrets.choice(ALPHABET) for _ in range(BODY_LEN))


def make_seed(species: list[dict], body: str | None = None, *, day: date | None = None) -> str:
    """Build a full seed. Pass `day` for the daily seed, `body` to rebuild a known one."""
    if day is not None:
        body = _body_for_date(day)
    return f"{fingerprint(species)}-{body or new_body()}"


def normalise(seed: str) -> str:
    """Accept what a person actually types: any case, spaces, missing dash."""
    cleaned = "".join(c for c in seed.upper() if c in ALPHABET)
    if len(cleaned) != FINGERPRINT_LEN + BODY_LEN:
        raise ValueError(
            f"'{seed}' is not a seed — expected {FINGERPRINT_LEN + BODY_LEN} "
            f"characters like ABCD-234567."
        )
    return f"{cleaned[:FINGERPRINT_LEN]}-{cleaned[FINGERPRINT_LEN:]}"


def resolve(seed: str, species: list[dict]) -> dict:
    """Return the species a seed names, for this dataset.

    Raises ValueError if the seed was made for a different dataset, rather than
    returning a different animal for the same seed.
    """
    seed = normalise(seed)
    fp, body = seed.split("-")
    expected = fingerprint(species)
    if fp != expected:
        raise ValueError(
            f"Seed '{seed}' is for a different dataset (its tag is {fp}, "
            f"this one is {expected}). Both players need the same dataset."
        )
    index = int.from_bytes(hashlib.sha256(f"taxoquiz-seed:{body}".encode()).digest(), "big")
    return species[index % len(species)]

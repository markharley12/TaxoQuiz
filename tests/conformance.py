"""Cases the TypeScript engine must answer exactly as Python does.

The game logic exists twice: here, and in `frontend/src/engine/`, which is what
lets the app run with no server — on a phone, or as a static website. Two
implementations of the same rules drift unless something holds them together,
and the cost of drift is specific: a seed shared from one opens a different
animal on the other, or a guess is painted a different colour.

So this module writes Python's answers to a fixed set of questions into
`frontend/src/engine/conformance.json`, and both suites check against it:

- `tests/test_conformance.py` fails while the file is stale, so a change to the
  Python cannot land without regenerating it;
- `frontend/src/engine/conformance.test.ts` fails while TypeScript disagrees
  with it, so the regenerated file cannot land without the matching port.

Regenerate after changing any game, explore, rank or seed logic:

    .venv/bin/python tests/conformance.py

Numbers are compared exactly, not to a tolerance. Both sides do the same IEEE
arithmetic in the same order, so any difference at all is a real divergence.
"""
import hashlib
import json
import random
from datetime import date
from pathlib import Path

from taxoquiz import explore
from taxoquiz.game import seed as seeds
from taxoquiz.game.game_state import get_game_state
from taxoquiz.game.list_animals import list_animals
from taxoquiz.game.tree import common_name_of, get_species, load_tree, rank_of
from taxoquiz.jsonio import read_json
from taxoquiz.paths import example_taxon_info_path, tree_path
from taxoquiz.ranks import believed_levels, rank_levels

GOLDEN = Path(__file__).resolve().parents[1] / "frontend" / "src" / "engine" / "conformance.json"
EXAMPLE = "example"


def attempt(fn, *args, **kwargs) -> dict:
    """The answer, or the error message: both are behaviour the port must match."""
    try:
        return {"result": fn(*args, **kwargs)}
    except ValueError as e:
        return {"error": str(e)}


def node(name, rank=None, *children, **extra) -> dict:
    out = {"name": name, **extra}
    if rank is not None:
        out["rank"] = rank
    if children:
        out["children"] = list(children)
    return out


# Small trees for the rank logic's edge cases, which the clean example cannot
# reach: it rejects no rank claims at all.
SYNTHETIC_TREES = [
    # A contradiction up the tree: a "subclass" containing a class. Both ends
    # must be distrusted, not just the deeper one.
    node("Animalia", "kingdom",
         node("Chordata", "phylum",
              node("Tetrapodomorpha", "subclass",
                   node("Mammalia", "class",
                        node("Theria", None,
                             node("Carnivora", "order",
                                  node("Felidae", "family",
                                       node("Panthera", "genus",
                                            node("Panthera leo", "species"))))))),
              node("Aves", "class", node("Passer domesticus", "species")))),
    # Ties, and a species nested under an identical rank.
    node("Animalia", "Kingdom",
         node("Eumetazoa", "subkingdom",
              node("Bilateria", "subkingdom",
                   node("Centronyx bairdii", "species", node("Ammodramus bairdii", "species")),
                   node("Cnidaria", "phylum", node("Coral", "species"))))),
    # Off-ladder ranks, casing and whitespace, prototype-shaped names, a missing
    # rank, an empty rank, and an explicitly empty children list.
    node("Actinopterygii", "class",
         node("Acanthopterygii", "division",
              node("Acanthomorphata", "subsection",
                   node("Ctenosquamata", "section",
                        node("Perciformes", "order", node("Perca fluviatilis", "species"))))),
         node("Thing", " Genus ", node("Thing one", "SPECIES")),
         node("Weird", "constructor", node("Weird one", "toString")),
         node("Noranks", None, node("Leafless", "")),
         {"name": "Empty", "rank": "family", "children": []}),
    # Above the kingdom, a chain of clades, and a clade with nothing below it.
    node("Life", "life",
         node("Eukaryota", "domain",
              node("Animalia", "kingdom",
                   node("CladeA", "clade",
                        node("CladeB", None,
                             node("CladeC", "clade",
                                  node("Genus x", "genus", node("Genus x y", "species"))))),
                   node("Unplaced", "clade")))),
    # Interpolated siblings that would cross without the floor at the parent.
    # A is placed against the subclass one step below it; B, beneath A, only
    # sees a subclass five steps away, so on its own it would land colder than
    # the node above it.
    node("Mammalia", "class",
         node("A", "clade",
              node("Near", "subclass", node("Near sp", "species")),
              node("B", "clade",
                   node("B1", "clade",
                        node("B2", "clade",
                             node("B3", "clade",
                                  node("Far", "subclass", node("Far sp", "species")))))))),
]


def _named(tree: dict, by_id: dict) -> dict:
    out = {}

    def walk(n):
        out[n["name"]] = by_id[id(n)]
        for c in n.get("children") or []:
            walk(c)

    walk(tree)
    return out


def sha256_cases() -> list:
    inputs = ["", "a", "abc", *("a" * n for n in (55, 56, 63, 64, 65, 119, 120)),
              "The quick brown fox " * 50, "é μ 🦁"]
    return [{"input": s, "digest": hashlib.sha256(s.encode()).hexdigest()} for s in inputs]


def seed_cases(species: list) -> dict:
    fp = seeds.fingerprint(species)
    bodies = [seeds._encode(hashlib.sha256(f"case{i}".encode()).digest(), seeds.BODY_LEN)
              for i in range(48)]
    to_resolve = [f"{fp}-{b}" for b in bodies] + [
        f" {fp.lower()} {bodies[0].lower()} ", f"{fp}{bodies[1]}",
        "0000-000000", "ABCD-2345", "not a seed at all", "",
    ]
    return {
        "fingerprint": fp,
        "fingerprints": [
            {"names": names, "fingerprint": seeds.fingerprint([{"common_name": n} for n in names])}
            for names in ([], ["a"], ["lion", "tiger"], ["é🦁"])
        ],
        "resolve": [
            {"seed": s, **attempt(lambda s=s: seeds.resolve(s, species)["common_name"])}
            for s in to_resolve
        ],
        "daily": [
            {"date": d, "body": seeds._body_for_date(date.fromisoformat(d))}
            for d in ("2026-09-13", "2026-01-01", "2024-02-29", "1999-12-31", "2100-06-15")
        ],
        "normalise": [
            {"input": s, **attempt(seeds.normalise, s)}
            for s in ("abcd234567", " ab cd-23 4567 ", "ABCD-234567", "not a seed at all",
                      "ABCD-2345", "", "iloU-abcdefgh", "abcd-2345678")
        ],
    }


def game_cases(names: list) -> list:
    cases = [
        ("human", ["aardvark"]),
        ("lion", ["tiger", "grey wolf", "human"]),
        ("human", ["common starfish", "common wasp", "sea sponge"]),
        ("lion", ["lion"]),
        ("human", []),
        ("unicorn", ["lion"]),
        ("lion", ["unicorn"]),
        ("lion", ["tiger", "o'brien"]),
    ]
    rng = random.Random(2026)
    for i in range(24):
        secret = rng.choice(names)
        guesses = rng.sample(names, rng.randint(1, 6))
        if i % 4 == 0 and secret not in guesses:
            guesses.append(secret)
        cases.append((secret, guesses))
    return [{"secret": s, "guesses": g, **attempt(get_game_state, s, g, dataset=EXAMPLE)}
            for s, g in cases]


def build() -> dict:
    tree = load_tree(tree_path(EXAMPLE))
    species = get_species(tree)
    names = [s["common_name"] for s in species]
    human = next(s["name"] for s in species if s["common_name"] == "human")

    info = read_json(example_taxon_info_path())
    ranks, commons = rank_of(tree), common_name_of(tree)

    def taxon(name):
        found = info.get(name)
        return None if found is None else {
            **found, "rank": ranks.get(name, ""), "common_name": commons.get(name, ""),
        }

    return {
        "sha256": sha256_cases(),
        "ranks": {
            "example": rank_levels(tree),
            "synthetic": [
                {"tree": t, "believed": _named(t, believed_levels(t)), "levels": rank_levels(t)}
                for t in SYNTHETIC_TREES
            ],
        },
        "seeds": seed_cases(species),
        "game": game_cases(names),
        "animals": [
            {"q": q, "limit": limit, "exclude": exclude,
             "result": list_animals(q, limit, set(exclude) or None, dataset=EXAMPLE)}
            for q, limit, exclude in (
                ("", 30, []), ("li", 30, []), ("LI", 5, []), (" lion", 30, []),
                ("bear", 200, ["polar bear", "brown bear"]), ("zzzz", 30, []),
            )
        ],
        "explore": {
            "subtree": [
                {"root": r, "depth": d, "budget": b,
                 **attempt(explore.subtree, root=r, depth=d, budget=b, dataset=EXAMPLE)}
                for r, d, b in (
                    (None, None, 200), (None, None, 40), (None, None, 1), (None, 1, None),
                    # Exactly the root and its children: the budget is spent to
                    # the last node, which is where `>` and `>=` part ways.
                    (None, None, 1 + len(tree["children"])),
                    ("Mammalia", None, 60), ("Carnivora", 2, None), ("Felidae", None, None),
                    (human, None, 200), ("Nope", None, 200),
                )
            ],
            "lineage": [
                {"name": n, **attempt(explore.lineage, n, dataset=EXAMPLE)}
                for n in ("Animalia", "Deuterostomia", human, "Felidae", "Nope")
            ],
            "search": [
                {"q": q, "limit": limit, "result": explore.search(q, limit, dataset=EXAMPLE)}
                for q, limit in (("cani", 25), ("A", 10), ("  felis  ", 25), ("", 25),
                                 ("zzzz", 25), ("dae", 100), ("HUMAN", 5))
            ],
            "stats": explore.stats(dataset=EXAMPLE),
        },
        "taxon": [{"name": n, "result": taxon(n)} for n in ("Animalia", "Deuterostomia", human, "Nope")],
    }


def render(cases: dict) -> str:
    # Compact: nobody reads this file, and indenting it more than doubled it
    # (669KB against 291KB), almost all of it whitespace in the game states.
    return json.dumps(cases, ensure_ascii=False, separators=(",", ":")) + "\n"


if __name__ == "__main__":
    GOLDEN.write_text(render(build()), encoding="utf-8")
    print(f"Wrote {GOLDEN} ({GOLDEN.stat().st_size // 1024} KB)")

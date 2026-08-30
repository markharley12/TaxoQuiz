"""Free browsing of the tree, with no game attached.

Explore mode has no secret and no guesses: you start anywhere and walk the tree.
That makes it a different data problem from the game. `game_state` returns the
union of a handful of lineages — tens of nodes — whereas explore can be pointed
at a root with 27,000 descendants.

So the tree is served in **slices**: a request names a root and a depth, and
nodes with children beyond that depth come back marked `truncated`, for the
client to fetch when the user opens them. `depth=None` returns everything, which
is supported deliberately (it is the honest answer to "what if I just render the
whole thing?") but is not what the UI asks for by default — see the note on
node counts in the API.

Every node carries `species_count`, the number of leaves beneath it. Browsing a
taxonomy without it is guesswork: "Aves" and "Onychophora" look identical as
labels, and one holds a thousand species while the other holds three.
"""

from .game.tree import load_tree

_tree: dict | None = None
_by_name: dict[str, dict] = {}
_parent: dict[str, str] = {}
_depth: dict[str, int] = {}
_species_count: dict[str, int] = {}
_node_count: dict[str, int] = {}


def _ensure_index() -> None:
    """Build the name-keyed indexes once.

    Names are unique across the tree — `datagen/extract_game_tree.py` enforces
    that with `make_names_unique` and refuses to write a tree where it fails —
    so a name is a usable key here. If that ever stopped holding, this index
    would silently collapse distinct taxa onto one entry, which is why the
    guarantee lives in the converter rather than being assumed here.
    """
    global _tree
    if _tree is not None:
        return
    _tree = load_tree()

    def walk(node: dict, parent: str | None, depth: int) -> int:
        name = node["name"]
        _by_name[name] = node
        _depth[name] = depth
        if parent is not None:
            _parent[name] = parent
        children = node.get("children") or []
        if not children:
            _species_count[name] = 1
            _node_count[name] = 1
            return 1, 1
        species = nodes = 0
        for child in children:
            s, n = walk(child, name, depth + 1)
            species += s
            nodes += n
        _species_count[name] = species
        _node_count[name] = nodes + 1
        return species, nodes + 1

    walk(_tree, None, 0)


def _select(node: dict, depth: int | None, budget: int | None) -> set[str]:
    """Names to include, grown breadth-first until a limit bites.

    A **node budget** rather than a depth limit, because depth is the wrong knob
    on a real taxonomy. The Wikidata tree opens with a single-child chain —
    Animalia › Eumetazoa › ParaHoxozoa › Bilateria › Nephrozoa › … — so three
    levels down from the root is nine nodes and five clicks from anything
    interesting, while three levels down from a bushy genus is hundreds.

    Growing level by level and stopping before the budget is exceeded adapts to
    whichever shape is actually there: it runs deep through a chain, where each
    level costs one node, and stops early in a bush. `depth` is still honoured
    when given, so a caller that genuinely wants N levels can ask for them.
    """
    included = {node["name"]}
    frontier = [node]
    level = 0
    while frontier and (depth is None or level < depth):
        nxt = [c for n in frontier for c in (n.get("children") or [])]
        if not nxt:
            break
        if budget is not None and len(included) + len(nxt) > budget:
            break
        included.update(n["name"] for n in nxt)
        frontier = nxt
        level += 1
    return included


def _node_dict(node: dict, included: set[str] | None) -> dict:
    """Serialise `node`, recursing into children present in `included`.

    `included is None` means "this node only" — a stub, marked `truncated` if it
    has children. That is what nodes off a lineage spine get: enough to show the
    label and the size, nothing more.

    `truncated` says "this node has children that are not in this response",
    which is what tells the client whether opening it needs another request or
    is purely a local expand.
    """
    name = node["name"]
    children = node.get("children") or []
    kept = [c for c in children if included is not None and c["name"] in included]

    out = {
        "name": name,
        "rank": node.get("rank", ""),
        "depth": _depth[name],
        "child_count": len(children),
        "species_count": _species_count[name],
        # Total descendants including this node. The UI needs it to say what a
        # full expand would actually render before it commits to rendering it;
        # species_count cannot answer that, since the internal nodes are most of
        # the tree (27k nodes for 18k species).
        "node_count": _node_count[name],
        "truncated": len(kept) < len(children),
        "children": [_node_dict(c, included) for c in kept],
    }
    # Only leaves have these, and only leaves are things you can guess in a game.
    if node.get("common_name"):
        out["common_name"] = node["common_name"]
    if node.get("scientific_name"):
        out["scientific_name"] = node["scientific_name"]
    return out


def subtree(root: str | None = None, depth: int | None = None, budget: int | None = 200) -> dict:
    """Return the subtree at `root`, limited by `depth`, `budget`, or both.

    Raises ValueError for an unknown root, rather than falling back to the tree
    root — silently showing all of Animalia when you asked for Aves is worse
    than an error, because it looks like it worked.
    """
    _ensure_index()
    if root is None:
        node = _tree
    else:
        node = _by_name.get(root)
        if node is None:
            raise ValueError(f"Unknown taxon: {root!r}")
    return _node_dict(node, _select(node, depth, budget))


def path_to(name: str) -> list[str]:
    """Ancestor names from the tree root down to `name`, inclusive.

    Used to jump: the client expands each name in turn, so arriving at a search
    result leaves the whole lineage above it open and readable, rather than
    dropping you into an unmoored subtree.
    """
    _ensure_index()
    if name not in _by_name:
        raise ValueError(f"Unknown taxon: {name!r}")
    chain = [name]
    while chain[-1] in _parent:
        chain.append(_parent[chain[-1]])
    return list(reversed(chain))


# How much of the destination to open when jumping to it. Smaller than a normal
# slice: the spine above already costs nodes, and the point of a jump is to land
# somewhere legible rather than to dump the subtree.
LINEAGE_TARGET_BUDGET = 60


def lineage(name: str) -> dict:
    """The tree from the root down to `name`, with siblings at every level.

    One request rather than one per ancestor. Jumping to a search result by
    fetching each ancestor separately worked but took seventeen round trips for
    a deep species, and left the UI assembling a spine it had no reason to know
    the shape of.

    Nodes off the path come back shallow and `truncated`, so the surrounding
    context is visible without dragging in the rest of the tree. The target
    itself gets a normal slice, so you land on something with children to read
    rather than on a bare label.
    """
    _ensure_index()
    chain = path_to(name)

    def build(node: dict, idx: int) -> dict:
        if idx + 1 >= len(chain):
            return _node_dict(node, _select(node, None, LINEAGE_TARGET_BUDGET))
        nxt = chain[idx + 1]
        out = _node_dict(node, None)
        out["children"] = [
            build(c, idx + 1) if c["name"] == nxt else _node_dict(c, None)
            for c in (node.get("children") or [])
        ]
        out["truncated"] = False
        return out

    return {"path": chain, "tree": build(_tree, 0)}


def search(query: str, limit: int = 25) -> list[dict]:
    """Find taxa and species matching `query`.

    Searches scientific names *and* leaf common names, because in explore mode
    both are things you would reasonably type — the game's `/animals` only
    searches common names, since only a species can be guessed.

    Ordering puts prefix matches first and then larger groups first, so typing
    "cani" offers Canidae before an arbitrary species inside it.
    """
    _ensure_index()
    needle = query.strip().lower()
    if not needle:
        return []

    hits = []
    for name, node in _by_name.items():
        common = node.get("common_name", "")
        hay_sci = name.lower()
        hay_common = common.lower()
        if needle in hay_sci:
            matched = hay_sci
        elif common and needle in hay_common:
            matched = hay_common
        else:
            continue
        hits.append((0 if matched.startswith(needle) else 1, -_species_count[name], name, node, common))

    hits.sort(key=lambda h: (h[0], h[1], h[2]))
    return [
        {
            "name": name,
            "common_name": common,
            "rank": node.get("rank", ""),
            "depth": _depth[name],
            "species_count": _species_count[name],
            "is_species": not (node.get("children") or []),
        }
        for _, _, name, node, common in hits[:limit]
    ]


def stats() -> dict:
    """Size of the loaded tree, so the client can warn before a full expand."""
    _ensure_index()
    return {
        "root": _tree["name"],
        "nodes": _node_count[_tree["name"]],
        "species": _species_count[_tree["name"]],
        "max_depth": max(_depth.values()),
    }

from collections import namedtuple

from .tree import load_tree
from ..paths import current_dataset, tree_path
from ..ranks import rank_levels

# One bundle per dataset, keyed by dataset name — a game server can have
# several datasets loaded at once, so this can no longer be a single set of
# module globals the way it was when only one dataset ever existed per process.
_Index = namedtuple("_Index", "tree name_to_node lineage_of depth_of warmth")
_indexes: dict[str, _Index] = {}


def _ensure_loaded(dataset: str | None) -> _Index:
    key = dataset or current_dataset()
    if key not in _indexes:
        tree = load_tree(tree_path(key))
        name_to_node, lineage_of, depth_of = _build_index(tree)
        _indexes[key] = _Index(tree, name_to_node, lineage_of, depth_of, rank_levels(tree))
    return _indexes[key]


def _build_index(tree):
    name_to_node = {}
    lineage_of = {}
    depth_of = {}

    def walk(node, path, depth):
        depth_of[node["name"]] = depth
        if not node.get("children"):
            common = node["common_name"]
            name_to_node[common] = node
            lineage_of[common] = path + [node]
        else:
            for child in node["children"]:
                walk(child, path + [node], depth + 1)

    walk(tree, [], 0)
    return name_to_node, lineage_of, depth_of


def _lca(lin_a, lin_b):
    """Return the deepest node shared by both lineages."""
    result = lin_a[0]
    for a, b in zip(lin_a, lin_b):
        if a["name"] == b["name"]:
            result = a
        else:
            break
    return result


def _prune(node, show_names, secret_marker, guess_sci_names, secret_lineage_names,
           guess_lca_depths, depth_of, guess_lca_warmths, warmth_of, parent_warmth=0.0,
           can_hint=False):
    """Recursively build the pruned, annotated display tree."""
    if node["name"] not in show_names:
        return None

    sci_name = node["name"]

    if sci_name == secret_marker:
        node_type = "secret"
        label = "???"
    elif sci_name in guess_sci_names:
        node_type = "guess"
        label = node["common_name"]
    else:
        node_type = "ancestor"
        label = node["name"]

    # The ??? node takes its parent's warmth rather than its own rank's.
    #
    # Its own rank would usually be Species, i.e. 1.0 — so it would render as
    # the greenest thing on screen, greener than the closest real guess, and it
    # would say "the answer is exactly one step below this". Colouring it with
    # the deepest LCA actually reached says "this is how far you have got",
    # which is a number already on screen on the node above it, so it reveals
    # nothing the tree did not already show. The ??? node exists to reveal the
    # branch, not the depth, and this keeps it to that.
    own_warmth = parent_warmth if node_type == "secret" else warmth_of[sci_name]

    # Recursed after the node classifies itself, because a child needs this
    # node's warmth: that is what the ??? node is coloured with.
    children = []
    for child in node.get("children", []):
        pruned = _prune(
            child, show_names, secret_marker, guess_sci_names,
            secret_lineage_names, guess_lca_depths, depth_of,
            guess_lca_warmths, warmth_of, own_warmth, can_hint,
        )
        if pruned is not None:
            children.append(pruned)

    result = {
        # The tree's own name, alongside whatever is being displayed. They
        # differ for guesses, which are shown by common name while taxon info
        # is keyed by the scientific one. Ancestors happen to have
        # label == name, so looking up by label worked by coincidence.
        #
        # None on the ??? node simply because there is nothing there to look
        # up, which is also what keeps it unclickable. It is not a secrecy
        # measure and should not be mistaken for one: the answer is already on
        # the client, returned by /animal and kept in localStorage so the win
        # can be checked without a round trip.
        "name": None if node_type == "secret" else sci_name,
        "label": label,
        # So the end of a round can name the group a guess shared ("the family
        # Felidae"). Blank on the ??? node for the same reason as its name, and
        # more so: its rank would say how far below the reached group the
        # answer sits, which is exactly what the marker exists to hide.
        "rank": "" if node_type == "secret" else node.get("rank", ""),
        "node_type": node_type,
        "depth": depth_of[sci_name],
        # Where this node's rank sits on the 0..1 ladder — what the tree is
        # coloured by, in place of depth. See taxoquiz/ranks.py for why rank
        # and not depth: depth is not comparable across lineages, so the same
        # taxonomic fact rendered a different colour in different branches.
        "warmth": own_warmth,
        "on_secret_path": sci_name in secret_lineage_names,
        "children": children,
    }
    if node_type == "guess":
        result["lca_depth"] = guess_lca_depths.get(sci_name, 0)
        # A guess is coloured by how close its LCA with the secret is, not by
        # where the guess itself sits — that is the whole score. A correct
        # guess has itself as the LCA, so it lands at 1.0 in every game, which
        # a depth-based scale could not do: see taxoquiz/ranks.py.
        result["lca_warmth"] = guess_lca_warmths.get(sci_name, 0.0)
    if node_type == "secret":
        # Whether a hint has anything left to reveal: false once the node below
        # the marker would be the answer itself. That says the answer sits
        # directly under the last revealed group, which the group's own rank
        # (a genus, nearly always) has already said; the button needs to know.
        result["can_hint"] = can_hint
    return result


def get_game_state(
    secret: str, guesses: list[str], dataset: str | None = None, hints: int = 0,
) -> dict:
    """
    Return the annotated display tree for the current game state.

    `hints` is how many hints the player has bought. Each shows one more node of
    the secret's lineage past the deepest group any guess reached, and the ???
    marker moves down with it — one *node*, not one rank, so near the top of the
    tree a hint can be an unranked clade. A hint never reveals the secret itself:
    the marker stops at it, and `can_hint` on the marker goes false. Hints with
    no guesses start from the root, which every lineage shares.

    Raises ValueError for any name (secret or guess) not found in the dataset.
    """
    idx = _ensure_loaded(dataset)

    for name in [secret] + guesses:
        if name not in idx.name_to_node:
            raise ValueError(f"Unknown animal: {name!r}")

    secret_lineage = idx.lineage_of[secret]
    secret_lineage_names = {n["name"] for n in secret_lineage}

    guess_lineages = [idx.lineage_of[g] for g in guesses]
    guess_sci_names = {idx.name_to_node[g]["name"] for g in guesses}

    # Compute LCA depth for each guess (used for colour gradient on frontend).
    guess_lca_depths = {}    # sci_name → depth of LCA with secret
    guess_lca_warmths = {}   # sci_name → that LCA's rank position, 0..1
    for g, lin in zip(guesses, guess_lineages):
        lca = _lca(secret_lineage, lin)
        guess_lca_depths[idx.name_to_node[g]["name"]] = idx.depth_of[lca["name"]]
        guess_lca_warmths[idx.name_to_node[g]["name"]] = idx.warmth[lca["name"]]

    # Display tree = union of guess lineages only.
    show_names = set()
    for lin in guess_lineages:
        for node in lin:
            show_names.add(node["name"])

    # Find the "???" node: the direct child of the deepest LCA between the secret
    # and any guess on the secret's lineage. This shows the branch point without
    # revealing how deep the secret is within that branch.
    secret_marker = None
    can_hint = False
    if guess_lineages or hints > 0:
        # The root is on every lineage, so it is where hints start with no guess.
        deepest_lca_depth = 0
        deepest_lca_idx = 0
        for guess_lin in guess_lineages:
            lca = _lca(secret_lineage, guess_lin)
            d = idx.depth_of[lca["name"]]
            if d > deepest_lca_depth:
                deepest_lca_depth = d
                for i, n in enumerate(secret_lineage):
                    if n["name"] == lca["name"]:
                        deepest_lca_idx = i
                        break

        last = len(secret_lineage) - 1   # the secret itself
        if deepest_lca_idx < last:
            # Each hint reveals one more node, stopping short of the secret.
            known_idx = min(deepest_lca_idx + max(hints, 0), last - 1)
            for node in secret_lineage[:known_idx + 1]:
                show_names.add(node["name"])
            secret_marker = secret_lineage[known_idx + 1]["name"]
            show_names.add(secret_marker)
            can_hint = known_idx + 1 < last

    return _prune(
        idx.tree,
        show_names,
        secret_marker,
        guess_sci_names,
        secret_lineage_names,
        guess_lca_depths,
        idx.depth_of,
        guess_lca_warmths,
        idx.warmth,
        can_hint=can_hint,
    )


if __name__ == "__main__":
    import json
    import sys

    args = sys.argv[1:]
    if len(args) < 1:
        print("usage: python -m taxoquiz.game.game_state <secret> [guess ...]", file=sys.stderr)
        sys.exit(1)

    secret, *guesses = args
    try:
        state = get_game_state(secret, guesses)
        print(json.dumps(state, indent=2))
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)

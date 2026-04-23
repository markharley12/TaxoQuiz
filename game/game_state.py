from .tree import load_tree

_tree = None
_name_to_node = {}  # common_name → leaf node
_lineage_of = {}    # common_name → [node, ...] ordered root→leaf
_depth_of = {}      # node["name"] → depth from root


def _ensure_loaded():
    global _tree, _name_to_node, _lineage_of, _depth_of
    if _tree is None:
        _tree = load_tree()
        _name_to_node, _lineage_of, _depth_of = _build_index(_tree)


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


def _prune(node, show_names, secret_marker, guess_sci_names, secret_lineage_names):
    """Recursively build the pruned, annotated display tree."""
    if node["name"] not in show_names:
        return None

    children = []
    for child in node.get("children", []):
        pruned = _prune(child, show_names, secret_marker, guess_sci_names, secret_lineage_names)
        if pruned is not None:
            children.append(pruned)

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

    return {
        "label": label,
        "node_type": node_type,
        "depth": _depth_of[sci_name],
        "on_secret_path": sci_name in secret_lineage_names,
        "children": children,
    }


def get_game_state(secret: str, guesses: list[str]) -> dict:
    """
    Return the annotated display tree for the current game state.

    Raises ValueError for any name (secret or guess) not found in the dataset.
    """
    _ensure_loaded()

    for name in [secret] + guesses:
        if name not in _name_to_node:
            raise ValueError(f"Unknown animal: {name!r}")

    secret_lineage = _lineage_of[secret]
    secret_lineage_names = {n["name"] for n in secret_lineage}

    guess_lineages = [_lineage_of[g] for g in guesses]
    guess_sci_names = {_name_to_node[g]["name"] for g in guesses}

    # Display tree = union of guess lineages only.
    show_names = set()
    for lin in guess_lineages:
        for node in lin:
            show_names.add(node["name"])

    # Find the "???" node: the direct child of the deepest LCA between the secret
    # and any guess on the secret's lineage. This shows the branch point without
    # revealing how deep the secret is within that branch.
    secret_marker = None
    if guess_lineages:
        deepest_lca_depth = -1
        deepest_lca_idx = -1
        for guess_lin in guess_lineages:
            lca = _lca(secret_lineage, guess_lin)
            d = _depth_of[lca["name"]]
            if d > deepest_lca_depth:
                deepest_lca_depth = d
                for i, n in enumerate(secret_lineage):
                    if n["name"] == lca["name"]:
                        deepest_lca_idx = i
                        break

        reveal_idx = deepest_lca_idx + 1
        if reveal_idx < len(secret_lineage):
            secret_marker = secret_lineage[reveal_idx]["name"]
            show_names.add(secret_marker)

    return _prune(
        _tree,
        show_names,
        secret_marker,
        guess_sci_names,
        secret_lineage_names,
    )


if __name__ == "__main__":
    import json
    import sys

    args = sys.argv[1:]
    if len(args) < 1:
        print("usage: python -m game.game_state <secret> [guess ...]", file=sys.stderr)
        sys.exit(1)

    secret, *guesses = args
    try:
        state = get_game_state(secret, guesses)
        print(json.dumps(state, indent=2))
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)

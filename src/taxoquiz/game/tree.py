import json
from pathlib import Path

from ..paths import tree_path

# Parsed trees, keyed by resolved path. Every game module calls load_tree()
# independently, and without this the same file was parsed once per module —
# three times, into three separate copies. Harmless for the 530-species example,
# but a full scrape is ~44MB. Nothing mutates the tree (game_state builds fresh
# dicts when pruning), so one shared copy is safe.
_cache: dict[str, dict] = {}


def load_tree(path: Path | None = None) -> dict:
    """Load a taxonomy tree.

    Defaults to whatever `tree_path()` resolves to: the dataset named by
    $TAXOQUIZ_DATASET, or the example bundled with the package.
    """
    resolved = Path(path) if path is not None else tree_path()
    key = str(resolved)
    if key not in _cache:
        with open(resolved) as f:
            _cache[key] = json.load(f)
    return _cache[key]


def get_species(node: dict) -> list[dict]:
    """Return all leaf nodes (species) from a tree node."""
    if not node.get("children"):
        return [node]
    species = []
    for child in node["children"]:
        species.extend(get_species(child))
    return species


def get_ancestors(node: dict) -> list[dict]:
    """Return all non-leaf nodes (taxa), parents before their children.

    These are the nodes the info popup can be opened on, and therefore exactly
    the set `datagen/scrape_taxon_info.py` needs to fetch. It is derived from the
    tree rather than stored: a separate list file would be a second copy of
    something the tree already fully determines, and could fall out of step with
    it.
    """
    if not node.get("children"):
        return []
    out = [node]
    for child in node["children"]:
        out.extend(get_ancestors(child))
    return out


def qid_of(tree: dict) -> dict[str, str]:
    """Map node name to Wikidata Q-ID, for nodes that carry one.

    The Q-ID is a taxon's stable, language-independent identity (`Q140` is Lion).
    Nothing in the game uses it; it is there so the info scrape can fall back to
    "ask Wikidata which Wikipedia page this is" when a name does not resolve.
    Hand-curated trees have none, which is fine — the fallback is optional.
    """
    out: dict[str, str] = {}

    def walk(node):
        if node.get("qid"):
            out[node["name"]] = node["qid"]
        for child in node.get("children", []):
            walk(child)

    walk(tree)
    return out


def common_name_of(tree: dict) -> dict[str, str]:
    """Map node name to common name, for the leaves that have one.

    Only species carry one. It is kept here rather than copied into
    `taxon_info.json` for the same reason `rank` is: the tree already defines
    it, and a second copy is free to disagree with the tree it describes.
    """
    out: dict[str, str] = {}

    def walk(node):
        if node.get("common_name"):
            out[node["name"]] = node["common_name"]
        for child in node.get("children", []):
            walk(child)

    walk(tree)
    return out


def rank_of(tree: dict) -> dict[str, str]:
    """Map every node name to its rank, for callers that only have a name."""
    out: dict[str, str] = {}

    def walk(node):
        out[node["name"]] = node.get("rank", "")
        for child in node.get("children", []):
            walk(child)

    walk(tree)
    return out

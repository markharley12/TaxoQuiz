/**
 * Free browsing of the tree. Port of `taxoquiz/explore.py`, which explains the
 * node budget, `truncated`, and why a lineage comes back in one piece.
 */
import type { ExploreHit, ExploreNode, ExploreStats, Lineage } from '../api'
import { rankLevels } from './ranks'
import { childrenOf, perTree, pyRepr, type RawNode } from './taxonomy'

interface ExploreIndex {
  tree: RawNode
  byName: Map<string, RawNode>
  parent: Map<string, string>
  depth: Map<string, number>
  speciesCount: Map<string, number>
  nodeCount: Map<string, number>
  warmth: Map<string, number>
}

const exploreIndex = perTree((tree): ExploreIndex => {
  const byName = new Map<string, RawNode>()
  const parent = new Map<string, string>()
  const depth = new Map<string, number>()
  const speciesCount = new Map<string, number>()
  const nodeCount = new Map<string, number>()

  const walk = (node: RawNode, parentName: string | null, d: number): [number, number] => {
    const name = node.name
    byName.set(name, node)
    depth.set(name, d)
    if (parentName !== null) parent.set(name, parentName)
    const children = childrenOf(node)
    if (children.length === 0) {
      speciesCount.set(name, 1)
      nodeCount.set(name, 1)
      return [1, 1]
    }
    let species = 0, nodes = 0
    for (const child of children) {
      const [s, n] = walk(child, name, d + 1)
      species += s
      nodes += n
    }
    speciesCount.set(name, species)
    nodeCount.set(name, nodes + 1)
    return [species, nodes + 1]
  }
  walk(tree, null, 0)
  return { tree, byName, parent, depth, speciesCount, nodeCount, warmth: rankLevels(tree) }
})

/** Names to include, grown breadth-first until a limit bites. `null` is no limit. */
function select(node: RawNode, depth: number | null, budget: number | null): Set<string> {
  const included = new Set([node.name])
  let frontier = [node]
  let level = 0
  while (frontier.length > 0 && (depth === null || level < depth)) {
    const next = frontier.flatMap(childrenOf)
    if (next.length === 0) break
    if (budget !== null && included.size + next.length > budget) break
    for (const n of next) included.add(n.name)
    frontier = next
    level += 1
  }
  return included
}

/** `included === null` serialises the node alone, as a stub. */
function nodeDict(node: RawNode, included: Set<string> | null, idx: ExploreIndex): ExploreNode {
  const name = node.name
  const children = childrenOf(node)
  const kept = included === null ? [] : children.filter((c) => included.has(c.name))
  const out: ExploreNode = {
    name,
    rank: node.rank ?? '',
    depth: idx.depth.get(name)!,
    warmth: idx.warmth.get(name)!,
    child_count: children.length,
    species_count: idx.speciesCount.get(name)!,
    node_count: idx.nodeCount.get(name)!,
    truncated: kept.length < children.length,
    children: kept.map((c) => nodeDict(c, included, idx)),
  }
  if (node.common_name) out.common_name = node.common_name
  if (node.scientific_name) out.scientific_name = node.scientific_name
  return out
}

function unknown(name: string): Error {
  return new Error(`Unknown taxon: ${pyRepr(name)}`)
}

export function subtree(
  tree: RawNode,
  root: string | null = null,
  depth: number | null = null,
  budget: number | null = 200,
): ExploreNode {
  const idx = exploreIndex(tree)
  const node = root === null ? idx.tree : idx.byName.get(root)
  if (node === undefined) throw unknown(root!)
  return nodeDict(node, select(node, depth, budget), idx)
}

export function pathTo(tree: RawNode, name: string): string[] {
  const idx = exploreIndex(tree)
  if (!idx.byName.has(name)) throw unknown(name)
  const chain = [name]
  while (idx.parent.has(chain[chain.length - 1])) chain.push(idx.parent.get(chain[chain.length - 1])!)
  return chain.reverse()
}

export const LINEAGE_TARGET_BUDGET = 60

export function lineage(tree: RawNode, name: string): Lineage {
  const idx = exploreIndex(tree)
  const chain = pathTo(tree, name)
  const build = (node: RawNode, i: number): ExploreNode => {
    if (i + 1 >= chain.length) return nodeDict(node, select(node, null, LINEAGE_TARGET_BUDGET), idx)
    const next = chain[i + 1]
    const out = nodeDict(node, null, idx)
    out.children = childrenOf(node).map((c) => (c.name === next ? build(c, i + 1) : nodeDict(c, null, idx)))
    out.truncated = false
    return out
  }
  return { path: chain, tree: build(idx.tree, 0) }
}

/** Prefix matches first, then larger groups, then by name. */
export function search(tree: RawNode, query: string, limit = 25): ExploreHit[] {
  const idx = exploreIndex(tree)
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const hits: { prefix: number; size: number; node: RawNode; common: string }[] = []
  for (const [name, node] of idx.byName) {
    const common = node.common_name ?? ''
    const haySci = name.toLowerCase()
    const hayCommon = common.toLowerCase()
    let matched: string
    if (haySci.includes(needle)) matched = haySci
    else if (common && hayCommon.includes(needle)) matched = hayCommon
    else continue
    hits.push({ prefix: matched.startsWith(needle) ? 0 : 1, size: idx.speciesCount.get(name)!, node, common })
  }
  hits.sort((a, b) =>
    a.prefix - b.prefix || b.size - a.size || (a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0))

  return hits.slice(0, limit).map(({ node, common }) => ({
    name: node.name,
    common_name: common,
    rank: node.rank ?? '',
    depth: idx.depth.get(node.name)!,
    species_count: idx.speciesCount.get(node.name)!,
    is_species: childrenOf(node).length === 0,
  }))
}

export function stats(tree: RawNode): ExploreStats {
  const idx = exploreIndex(tree)
  let maxDepth = 0
  for (const d of idx.depth.values()) if (d > maxDepth) maxDepth = d
  return {
    root: idx.tree.name,
    nodes: idx.nodeCount.get(idx.tree.name)!,
    species: idx.speciesCount.get(idx.tree.name)!,
    max_depth: maxDepth,
  }
}

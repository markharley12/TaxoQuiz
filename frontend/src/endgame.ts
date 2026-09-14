/**
 * The end of a round: how close you got, and the bulk guess that unlocks once
 * you are close.
 *
 * Pure functions over the display tree the engine already returns, so there is
 * no second copy of a game rule here to keep in step with the Python (see "The
 * engine runs twice" in CLAUDE.md). The one rule borrowed is how a name matches
 * a word, `matchTier`, which the autocomplete ranks by and the conformance file
 * already checks.
 */
import type { TreeNode } from './api'
import { matchTier } from './engine/game'
import { displayName } from './names'

/** Bulk guessing unlocks once the closest guess shares at least a family with the
 *  secret. Warmth runs kingdom 0 to species 1 on a six-step ladder, and family is
 *  step four. Measured on the 41k-species dataset, a family holds a median of 3
 *  species and a 90th percentile of 54; an order would open lists in the
 *  hundreds, which is not an endgame. */
export const BULK_UNLOCK_WARMTH = 4 / 6

/** The most species one bulk guess may cover. "owl" matches 214 whole-word names
 *  in the big dataset: a bulk guess that size is not a shortcut but a skip. */
export const BULK_CAP = 25

export interface Closest {
  /** The closest guess, by its display label. */
  guess: string
  /** The group that guess shares with the secret: their lowest common ancestor. */
  clade: string
  rank: string
  /** How close, 0..1 — the LCA's place on the rank ladder, as the colours show. */
  warmth: number
}

/** Every node, parents before children. */
function allNodes(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
  out.push(node)
  for (const child of node.children) allNodes(child, out)
  return out
}

/** The guess that got closest, and the group it shared with the secret. Null
 *  before any guess. On a tie, the first guess found wins. */
export function closestGuess(tree: TreeNode | null): Closest | null {
  if (!tree) return null
  const nodes = allNodes(tree)
  let best: TreeNode | undefined
  for (const n of nodes) {
    if (n.node_type === 'guess' && (best === undefined || (n.lca_warmth ?? 0) > (best.lca_warmth ?? 0))) best = n
  }
  if (!best) return null
  // The LCA sits on the secret's lineage at the depth the guess recorded, and the
  // lineage has one node per depth. A correct guess is its own LCA.
  const depth = best.lca_depth
  const shared = nodes.find((n) => n.on_secret_path && n.node_type !== 'secret' && n.depth === depth)
  return {
    guess: best.label,
    clade: shared?.name ?? '',
    rank: shared?.rank ?? '',
    warmth: best.lca_warmth ?? 0,
  }
}

/** Where a bulk guess may reach, or null while it is locked.
 *
 *  Confined to the closest group reached, which always contains the answer, so
 *  the unlock reveals nothing the tree's colours have not already said. */
export function bulkScope(tree: TreeNode | null): { clade: string; rank: string } | null {
  const closest = closestGuess(tree)
  if (!closest || !closest.clade || closest.warmth < BULK_UNLOCK_WARMTH) return null
  return { clade: closest.clade, rank: closest.rank }
}

/** A query worth offering a bulk guess for: a word or words, not a fragment. */
export function isBulkQuery(query: string): boolean {
  const q = query.trim()
  return q.length >= 3 && /^[a-z][a-z' -]*[a-z]$/i.test(q)
}

/** The names a bulk guess on `query` covers: the query as a whole word anywhere
 *  in the name ("monitor" takes "Nile monitor" and "Panay monitor lizard"), never
 *  as part of one ("monitoring lizard"), and never a name already guessed. The
 *  autocomplete ranks a last word higher; a bulk guess needs no ranking, and is
 *  confined to one family, where a snail eater is not among the snails. */
export function bulkMatches(names: string[], query: string, exclude: string[]): string[] {
  const needle = query.trim().toLowerCase()
  const spent = new Set(exclude)
  return names.filter((name) => {
    if (spent.has(name)) return false
    const tier = matchTier(name, needle)
    return tier !== null && tier <= 2
  })
}

/** "Your closest guess, Savannah monitor, shared the genus Varanus — 83% of the way." */
export function describeClosest(closest: Closest): string {
  const pct = Math.round(closest.warmth * 100)
  const rank = closest.rank.trim().toLowerCase()
  const group = rank && rank !== 'clade' ? `the ${rank} ${closest.clade}` : closest.clade
  return `Your closest guess, ${displayName(closest.guess)}, shared ${group} — ${pct}% of the way.`
}

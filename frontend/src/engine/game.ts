/**
 * The guessing game. Port of `taxoquiz/game/game_state.py`, `pick_animal.py`
 * and `list_animals.py`; the reasoning behind the `???` marker and its warmth
 * lives in `game_state.py` and is not repeated here.
 */
import type { TreeNode } from '../api'
import { rankLevels } from './ranks'
import { makeSeed, normalise, resolve, utcToday } from './seed'
import { childrenOf, getSpecies, isLeaf, perTree, pyRepr, type RawNode } from './taxonomy'

interface GameIndex {
  species: RawNode[]
  /** Keyed by common name: that is what a player guesses. */
  nameToNode: Map<string, RawNode>
  lineageOf: Map<string, RawNode[]>
  depthOf: Map<string, number>
  warmth: Map<string, number>
}

const gameIndex = perTree((tree): GameIndex => {
  const nameToNode = new Map<string, RawNode>()
  const lineageOf = new Map<string, RawNode[]>()
  const depthOf = new Map<string, number>()
  const walk = (node: RawNode, path: RawNode[], depth: number) => {
    depthOf.set(node.name, depth)
    if (isLeaf(node)) {
      nameToNode.set(node.common_name!, node)
      lineageOf.set(node.common_name!, [...path, node])
    } else {
      for (const child of childrenOf(node)) walk(child, [...path, node], depth + 1)
    }
  }
  walk(tree, [], 0)
  return { species: getSpecies(tree), nameToNode, lineageOf, depthOf, warmth: rankLevels(tree) }
})

export function speciesOf(tree: RawNode): RawNode[] {
  return gameIndex(tree).species
}

/** The deepest node shared by both lineages. */
function lca(a: RawNode[], b: RawNode[]): RawNode {
  let result = a[0]
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].name !== b[i].name) break
    result = a[i]
  }
  return result
}

/** The annotated display tree for a round, or null when there are no guesses —
 *  the union of no lineages prunes the root away, as in Python. */
export function getGameState(tree: RawNode, secret: string, guesses: string[]): TreeNode | null {
  const idx = gameIndex(tree)
  for (const name of [secret, ...guesses]) {
    if (!idx.nameToNode.has(name)) throw new Error(`Unknown animal: ${pyRepr(name)}`)
  }

  const secretLineage = idx.lineageOf.get(secret)!
  const secretLineageNames = new Set(secretLineage.map((n) => n.name))
  const guessLineages = guesses.map((g) => idx.lineageOf.get(g)!)
  const guessSciNames = new Set(guesses.map((g) => idx.nameToNode.get(g)!.name))

  const lcaDepths = new Map<string, number>()
  const lcaWarmths = new Map<string, number>()
  guesses.forEach((g, i) => {
    const shared = lca(secretLineage, guessLineages[i])
    const sci = idx.nameToNode.get(g)!.name
    lcaDepths.set(sci, idx.depthOf.get(shared.name)!)
    lcaWarmths.set(sci, idx.warmth.get(shared.name)!)
  })

  const showNames = new Set<string>()
  for (const lin of guessLineages) for (const node of lin) showNames.add(node.name)

  let secretMarker: string | null = null
  if (guessLineages.length > 0) {
    let deepestDepth = -1
    let deepestIdx = -1
    for (const lin of guessLineages) {
      const shared = lca(secretLineage, lin)
      const d = idx.depthOf.get(shared.name)!
      if (d > deepestDepth) {
        deepestDepth = d
        deepestIdx = secretLineage.findIndex((n) => n.name === shared.name)
      }
    }
    const revealIdx = deepestIdx + 1
    if (revealIdx < secretLineage.length) {
      secretMarker = secretLineage[revealIdx].name
      showNames.add(secretMarker)
    }
  }

  const prune = (node: RawNode, parentWarmth: number): TreeNode | null => {
    if (!showNames.has(node.name)) return null
    const sci = node.name
    const nodeType = sci === secretMarker ? 'secret' : guessSciNames.has(sci) ? 'guess' : 'ancestor'
    const label = nodeType === 'secret' ? '???' : nodeType === 'guess' ? node.common_name! : node.name
    const ownWarmth = nodeType === 'secret' ? parentWarmth : idx.warmth.get(sci)!

    const children: TreeNode[] = []
    for (const child of childrenOf(node)) {
      const pruned = prune(child, ownWarmth)
      if (pruned !== null) children.push(pruned)
    }

    const result: TreeNode = {
      name: nodeType === 'secret' ? null : sci,
      label,
      node_type: nodeType,
      depth: idx.depthOf.get(sci)!,
      warmth: ownWarmth,
      on_secret_path: secretLineageNames.has(sci),
      children,
    }
    if (nodeType === 'guess') {
      result.lca_depth = lcaDepths.get(sci) ?? 0
      result.lca_warmth = lcaWarmths.get(sci) ?? 0.0
    }
    return result
  }
  return prune(tree, 0.0)
}

/** Choose the secret, and return it with the seed that names it. Throws if the
 *  seed is malformed or belongs to another dataset. */
export function pickAnimal(
  tree: RawNode,
  opts: { seed?: string; daily?: boolean; today?: string } = {},
): { animal: string; seed: string } {
  const species = speciesOf(tree)
  if (opts.seed) {
    return { animal: resolve(opts.seed, species).common_name!, seed: normalise(opts.seed) }
  }
  const full = makeSeed(species, opts.daily ? { day: opts.today ?? utcToday() } : {})
  return { animal: resolve(full, species).common_name!, seed: full }
}

/** Up to `limit` common names containing `substring`, in tree order. */
export function listAnimals(tree: RawNode, substring: string, limit = 30, exclude: string[] = []): string[] {
  const needle = substring.toLowerCase()
  const skip = new Set(exclude)
  const out: string[] = []
  for (const s of speciesOf(tree)) {
    if (out.length >= limit) break
    const name = s.common_name!
    if (name.toLowerCase().includes(needle) && !skip.has(name)) out.push(name)
  }
  return out
}

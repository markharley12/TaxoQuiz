/**
 * Taxonomic rank as a position on a 0..1 ladder. Port of `taxoquiz/ranks.py`,
 * which holds the reasoning — why rank and not depth, why the ambiguous ranks
 * are missing, why a rank is a claim to be checked against the tree. It is not
 * repeated here, so that there is one place to read it.
 *
 * What matters about the port is that it is exact: the colour of every node in
 * both trees comes from these numbers, and `conformance.test.ts` compares them
 * to Python's with `===`, not to a tolerance.
 */
import { childrenOf, type RawNode } from './taxonomy'

export const LEVELS: ReadonlyMap<string, number> = new Map(Object.entries({
  'life': -1.0, 'domain': -0.5, 'realm': -0.5, 'superkingdom': -0.2,
  'kingdom': 0.0, 'subkingdom': 0.3, 'infrakingdom': 0.5,
  'superphylum': 0.8, 'phylum': 1.0, 'subphylum': 1.3, 'infraphylum': 1.5,
  'microphylum': 1.6,
  'megaclass': 1.75, 'superclass': 1.85, 'class': 2.0, 'subclass': 2.3,
  'infraclass': 2.5, 'parvclass': 2.55, 'subterclass': 2.6,
  'megacohort': 2.62, 'supercohort': 2.66, 'cohort': 2.70,
  'subcohort': 2.75, 'infracohort': 2.80,
  'magnorder': 2.85, 'grandorder': 2.88, 'mirorder': 2.90, 'superorder': 2.95,
  'order': 3.0, 'suborder': 3.3, 'infraorder': 3.5, 'parvorder': 3.6,
  'nanorder': 3.7, 'hyporder': 3.75,
  'superfamily': 3.9, 'epifamily': 3.95, 'family': 4.0, 'subfamily': 4.3,
  'supertribe': 4.45, 'tribe': 4.5, 'subtribe': 4.6,
  'genus': 5.0, 'subgenus': 5.3,
  'species group': 5.7, 'species subgroup': 5.75, 'species': 6.0,
  'subspecies': 6.0, 'variety': 6.0, 'form': 6.0,
}))

export const SPECIES_LEVEL = 6.0

export function levelOf(rank: string | null | undefined): number | null {
  if (!rank) return null
  return LEVELS.get(rank.trim().toLowerCase()) ?? null
}

const toWarmth = (level: number) => Math.min(Math.max(level / SPECIES_LEVEL, 0.0), 1.0)

/** A value every node was given, where `null` is a real answer. `map.get(k)!`
 *  would strip the `null` from the type along with the `undefined`. */
const at = <T>(map: Map<RawNode, T>, node: RawNode) => map.get(node) as T

/** Each node's level, or null where the tree contradicts its rank. */
export function believedLevels(tree: RawNode): Map<RawNode, number | null> {
  const parMax = new Map<RawNode, number | null>()
  const minDesc = new Map<RawNode, number | null>()
  const raw = new Map<RawNode, number | null>()

  const down = (node: RawNode, best: number | null) => {
    const own = levelOf(node.rank)
    raw.set(node, own)
    parMax.set(node, best)
    const deeper = own === null ? best : best === null ? own : Math.max(best, own)
    for (const child of childrenOf(node)) down(child, deeper)
  }
  down(tree, null)

  const up = (node: RawNode): number | null => {
    let best: number | null = null
    for (const child of childrenOf(node)) {
      for (const cand of [up(child), at(raw, child)]) {
        if (cand !== null && (best === null || cand < best)) best = cand
      }
    }
    minDesc.set(node, best)
    return best
  }
  up(tree)

  const believed = new Map<RawNode, number | null>()
  const judge = (node: RawNode) => {
    const own = at(raw, node)
    let keep = own
    if (own !== null && childrenOf(node).length > 0) {
      const above = at(parMax, node), below = at(minDesc, node)
      if ((above !== null && own <= above) || (below !== null && own >= below)) keep = null
    }
    believed.set(node, keep)
    for (const child of childrenOf(node)) judge(child)
  }
  judge(tree)
  return believed
}

/** Every node name in `tree` mapped to its warmth, 0..1. */
export function rankLevels(tree: RawNode): Map<string, number> {
  const out = new Map<string, number>()
  const believed = believedLevels(tree)

  // Pass 1, bottom-up: the broadest believed level below each node, and how
  // many steps down it is.
  const below = new Map<RawNode, [number, number] | null>()
  const broadestBelow = (node: RawNode): [number, number] | null => {
    let best: [number, number] | null = null
    for (const child of childrenOf(node)) {
      const deeper = broadestBelow(child)
      const own = at(believed, child)
      const cand: [number, number] | null =
        own !== null ? [own, 1] : deeper === null ? null : [deeper[0], deeper[1] + 1]
      if (cand !== null && (best === null || cand[0] < best[0])) best = cand
    }
    below.set(node, best)
    return best
  }
  broadestBelow(tree)

  // Pass 2, top-down: the nearest believed ancestor, and the distance to it.
  const walkDown = (node: RawNode, anc: number, steps: number, floor: number) => {
    const own = at(believed, node)
    let value: number
    if (own !== null) {
      value = toWarmth(own)
      anc = own
      steps = 0
    } else {
      steps += 1
      const found = at(below, node)
      if (found === null) {
        value = toWarmth(anc)
      } else {
        const [desc, downSteps] = found
        value = toWarmth(anc + (desc - anc) * (steps / (steps + downSteps)))
        // Strictly warmer than the parent: see rank_levels in ranks.py.
        if (value <= floor) value = floor + (toWarmth(desc) - floor) / (downSteps + 1)
      }
      value = Math.max(value, floor)
    }
    out.set(node.name, value)
    for (const child of childrenOf(node)) walkDown(child, anc, steps, value)
  }
  walkDown(tree, 0.0, 0, 0.0)
  return out
}

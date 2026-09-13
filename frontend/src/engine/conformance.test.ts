// @vitest-environment node
/**
 * The TypeScript engine against Python's own answers.
 *
 * `conformance.json` is written by `tests/conformance.py` from the Python game,
 * and `tests/test_conformance.py` fails if it is stale — so this file passing
 * means the two implementations agree *today*, not when the port was written.
 * See that module for why the logic exists twice.
 *
 * Everything is compared exactly. Warmth is floating point, but both sides do
 * the same IEEE operations in the same order, so a difference in the last bit
 * is a real divergence and not noise to be tolerated.
 */
import { describe, expect, it } from 'vitest'
import goldenText from './conformance.json?raw'
import exampleText from '../../../src/taxoquiz/data/example_tree.json?raw'
import infoText from '../../../src/taxoquiz/data/example_taxon_info.json?raw'
import { sha256 } from './sha256'
import { believedLevels, rankLevels } from './ranks'
import { bodyForDate, fingerprint, normalise, resolve } from './seed'
import { getGameState, listAnimals, pickAnimal, speciesOf } from './game'
import { lineage, search, stats, subtree } from './explore'
import { taxonInfo, type StoredTaxonInfo } from './taxon'
import { childrenOf, type RawNode } from './taxonomy'

type Outcome = { result?: unknown; error?: string }

interface Golden {
  sha256: { input: string; digest: string }[]
  ranks: {
    example: Record<string, number>
    synthetic: { tree: RawNode; believed: Record<string, number | null>; levels: Record<string, number> }[]
  }
  seeds: {
    fingerprint: string
    fingerprints: { names: string[]; fingerprint: string }[]
    resolve: ({ seed: string } & Outcome)[]
    daily: { date: string; body: string }[]
    normalise: ({ input: string } & Outcome)[]
  }
  game: ({ secret: string; guesses: string[] } & Outcome)[]
  animals: { q: string; limit: number; exclude: string[]; result: string[] }[]
  explore: {
    subtree: ({ root: string | null; depth: number | null; budget: number | null } & Outcome)[]
    lineage: ({ name: string } & Outcome)[]
    search: { q: string; limit: number; result: unknown }[]
    stats: unknown
  }
  taxon: { name: string; result: unknown }[]
}

const golden: Golden = JSON.parse(goldenText)
const example: RawNode = JSON.parse(exampleText)
const info: Record<string, StoredTaxonInfo> = JSON.parse(infoText)

/** What Python recorded: the answer, or the error message it raised. */
const expected = (c: Outcome): Outcome => ('error' in c ? { error: c.error } : { result: c.result })

function outcome(fn: () => unknown): Outcome {
  try {
    return { result: fn() }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

describe('sha256', () => {
  it.each(golden.sha256.map((c) => [c.input.length, c]))(
    'matches hashlib on a %i-character input, across every padding boundary',
    (_, c) => {
      expect(hex(sha256(new TextEncoder().encode(c.input)))).toBe(c.digest)
    },
  )
})

describe('ranks', () => {
  it('gives every node of the example the warmth Python gives it, to the last bit', () => {
    expect(Object.fromEntries(rankLevels(example))).toStrictEqual(golden.ranks.example)
  })

  it.each(golden.ranks.synthetic.map((c, i) => [i, c]))(
    'agrees on which rank claims to believe, and what follows, in edge-case tree %i',
    (_, c) => {
      const believed = believedLevels(c.tree)
      const byName: Record<string, number | null> = {}
      const walk = (n: RawNode) => {
        byName[n.name] = believed.get(n)!
        childrenOf(n).forEach(walk)
      }
      walk(c.tree)
      expect(byName).toStrictEqual(c.believed)
      expect(Object.fromEntries(rankLevels(c.tree))).toStrictEqual(c.levels)
    },
  )
})

describe('seeds', () => {
  const species = speciesOf(example)

  it("fingerprints the example exactly as Python does, or no shared seed would open", () => {
    expect(fingerprint(species)).toBe(golden.seeds.fingerprint)
  })

  it.each(golden.seeds.fingerprints.map((c) => [JSON.stringify(c.names), c]))(
    'fingerprints %s the same, including empty and non-ASCII lists',
    (_, c) => {
      expect(fingerprint(c.names.map((name) => ({ name, common_name: name })))).toBe(c.fingerprint)
    },
  )

  it('resolves every seed to the same animal, and rejects the same ones with the same words', () => {
    for (const c of golden.seeds.resolve) {
      expect(outcome(() => resolve(c.seed, species).common_name), c.seed).toStrictEqual(expected(c))
    }
  })

  it('derives the same daily body for a date, so a daily round is the same round everywhere', () => {
    for (const c of golden.seeds.daily) expect(bodyForDate(c.date), c.date).toBe(c.body)
  })

  it('normalises what a person types exactly as Python does', () => {
    for (const c of golden.seeds.normalise) {
      expect(outcome(() => normalise(c.input)), c.input).toStrictEqual(expected(c))
    }
  })

  it("starts today's daily from the date's seed, and a shared seed from the seed itself", () => {
    const day = golden.seeds.daily[0]
    const daily = pickAnimal(example, { daily: true, today: day.date })
    expect(daily.seed).toBe(`${golden.seeds.fingerprint}-${day.body}`)
    expect(pickAnimal(example, { seed: daily.seed.toLowerCase() })).toStrictEqual(daily)
  })
})

describe('game', () => {
  it.each(golden.game.map((c) => [c.secret, c.guesses.join(', ') || 'no guesses', c]))(
    'builds the same display tree for %s after %s',
    (_, __, c) => {
      expect(outcome(() => getGameState(example, c.secret, c.guesses))).toStrictEqual(expected(c))
    },
  )

  it('autocompletes the same names in the same order', () => {
    for (const c of golden.animals) {
      expect(listAnimals(example, c.q, c.limit, c.exclude), JSON.stringify(c.q)).toStrictEqual(c.result)
    }
  })
})

describe('explore', () => {
  it.each(golden.explore.subtree.map((c) => [c.root ?? 'the root', c.depth, c.budget, c]))(
    'slices the tree at %s (depth %s, budget %s) the same way',
    (_, __, ___, c) => {
      expect(outcome(() => subtree(example, c.root, c.depth, c.budget))).toStrictEqual(expected(c))
    },
  )

  it.each(golden.explore.lineage.map((c) => [c.name, c]))('builds the same lineage to %s', (_, c) => {
    expect(outcome(() => lineage(example, c.name))).toStrictEqual(expected(c))
  })

  it('ranks search hits in the same order', () => {
    for (const c of golden.explore.search) {
      expect(search(example, c.q, c.limit), JSON.stringify(c.q)).toStrictEqual(c.result)
    }
  })

  it('reports the same totals', () => {
    expect(stats(example)).toStrictEqual(golden.explore.stats)
  })
})

describe('taxon info', () => {
  it.each(golden.taxon.map((c) => [c.name, c]))(
    'serves %s with rank and common name merged from the tree',
    (_, c) => {
      expect(taxonInfo(example, info, c.name)).toStrictEqual(c.result)
    },
  )
})

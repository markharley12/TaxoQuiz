/**
 * The end of a round: the closeness a give-up reports, and when bulk guessing
 * opens and what it may take.
 */
import { describe, expect, it } from 'vitest'
import type { TreeNode } from './api'
import {
  BULK_CAP, BULK_UNLOCK_WARMTH, bulkMatches, bulkScope, closestGuess, describeClosest, isBulkQuery,
} from './endgame'

function node(over: Partial<TreeNode> & { label: string }): TreeNode {
  return {
    name: over.label, node_type: 'ancestor', depth: 0, on_secret_path: false,
    warmth: 0, children: [], ...over,
  }
}

/** Lion is the secret. Tiger shares the genus, grey wolf the order. */
function tree(): TreeNode {
  return node({
    label: 'Animalia', rank: 'Kingdom', on_secret_path: true, children: [
      node({
        label: 'Carnivora', rank: 'Order', depth: 1, warmth: 0.5, on_secret_path: true, children: [
          node({ label: 'grey wolf', name: 'Canis lupus', node_type: 'guess', depth: 2, lca_depth: 1, lca_warmth: 0.5 }),
          node({
            label: 'Panthera', rank: 'Genus', depth: 2, warmth: 5 / 6, on_secret_path: true, children: [
              node({ label: 'tiger', name: 'Panthera tigris', node_type: 'guess', depth: 3, lca_depth: 2, lca_warmth: 5 / 6 }),
              node({ label: '???', name: null, rank: '', node_type: 'secret', depth: 3, on_secret_path: true }),
            ],
          }),
        ],
      }),
    ],
  })
}

describe('closestGuess', () => {
  it('names the best guess and the group it shares with the secret', () => {
    expect(closestGuess(tree())).toStrictEqual(
      { guess: 'tiger', clade: 'Panthera', rank: 'Genus', warmth: 5 / 6 })
  })

  it('is null before any guess, rather than claiming a closeness of zero', () => {
    expect(closestGuess(null)).toBeNull()
    expect(closestGuess(node({ label: 'Animalia' }))).toBeNull()
  })

  it('never takes the ??? node as the shared group, though it sits on the lineage', () => {
    const t = tree()
    // A guess recording the ??? node's own depth must still find no group there.
    const panthera = t.children[0].children[1]
    panthera.children[0].lca_depth = 3
    expect(closestGuess(t)?.clade).toBe('')
  })
})

describe('bulk guessing', () => {
  it('stays locked at order level, where lists run to hundreds', () => {
    const t = tree()
    t.children[0].children.splice(1, 1)          // keep only the grey wolf (order)
    expect(bulkScope(t)).toBeNull()
  })

  it('opens at exactly family level and is confined to the group reached', () => {
    const t = tree()
    const tiger = t.children[0].children[1].children[0]
    tiger.lca_warmth = BULK_UNLOCK_WARMTH
    expect(bulkScope(t)).toStrictEqual({ clade: 'Panthera', rank: 'Genus' })
    tiger.lca_warmth = BULK_UNLOCK_WARMTH - 0.01   // a superfamily is not enough
    expect(bulkScope(t)).toBeNull()
  })

  it('takes a whole word only, and never a name already guessed', () => {
    const names = ['Nile monitor', 'Panay Monitor Lizard', 'monitoring lizard', 'Komodo dragon', 'Crocodile monitor']
    expect(bulkMatches(names, 'monitor', ['Crocodile monitor'])).toEqual(['Nile monitor', 'Panay Monitor Lizard'])
  })

  it('is offered for words, not for fragments or codes', () => {
    expect(isBulkQuery('monitor')).toBe(true)
    expect(isBulkQuery('tree frog')).toBe(true)
    expect(isBulkQuery('mo')).toBe(false)
    expect(isBulkQuery('rat5')).toBe(false)
  })

  it('caps a bulk guess well below a whole family of owls', () => {
    expect(BULK_CAP).toBeLessThan(54)   // the 90th-percentile family size
  })
})

describe('describeClosest', () => {
  it('reads as a sentence with the rank, the group and a percentage', () => {
    expect(describeClosest({ guess: 'tiger', clade: 'Panthera', rank: 'Genus', warmth: 5 / 6 }))
      .toBe('Your closest guess, Tiger, shared the genus Panthera — 83% of the way.')
  })

  it('leaves out a rank that says nothing, like an unranked clade', () => {
    expect(describeClosest({ guess: 'Komodo dragon', clade: 'Toxicofera', rank: 'Clade', warmth: 0.4 }))
      .toBe('Your closest guess, Komodo dragon, shared Toxicofera — 40% of the way.')
  })
})

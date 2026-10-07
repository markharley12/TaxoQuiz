/**
 * The end of a round: the closeness a give-up reports, and when bulk guessing
 * opens and what it may take.
 */
import { describe, expect, it } from 'vitest'
import type { TreeNode } from './api'
import {
  BULK_CAP, BULK_UNLOCK_WARMTH, bulkMatches, bulkScope, closestGuess, describeClosest, hintAvailable,
  hintCost, isBulkQuery,
} from './endgame'

function node(over: Partial<TreeNode> & { label: string }): TreeNode {
  return {
    name: over.label, node_type: 'ancestor', depth: 0, on_secret_path: false,
    warmth: 0, children: [], ...over,
  }
}

function secretMarker(depth: number): TreeNode {
  return node({ label: '???', name: null, rank: '', node_type: 'secret', depth, on_secret_path: true })
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
  it('stays locked above an order, and opens at one', () => {
    const t = tree()
    const carnivora = t.children[0]
    // Only the grey wolf guessed: the ??? sits under Carnivora.
    carnivora.children = [carnivora.children[0], secretMarker(2)]
    expect(bulkScope(t)).toStrictEqual({ clade: 'Carnivora', rank: 'Order' })
    // Regression: at family level a player who had reached the stingray order
    // could not bulk-guess stingrays. A superorder is still too broad.
    carnivora.warmth = 0.49
    expect(bulkScope(t)).toBeNull()
  })

  it('opens at exactly order level and is confined to the group reached', () => {
    const t = tree()
    const panthera = t.children[0].children[1]
    panthera.warmth = BULK_UNLOCK_WARMTH
    expect(bulkScope(t)).toStrictEqual({ clade: 'Panthera', rank: 'Genus' })
    panthera.warmth = BULK_UNLOCK_WARMTH - 0.01   // a superorder is not enough
    expect(bulkScope(t)).toBeNull()
  })

  it('counts a group a hint revealed, with no guess inside it', () => {
    // Regression: the unlock read the closest *guess*, so a family bought with a
    // hint left bulk guessing locked though the tree plainly showed the family.
    const t = tree()
    const carnivora = t.children[0]
    carnivora.children = [carnivora.children[0], node({
      label: 'Felidae', rank: 'Family', depth: 2, warmth: 4 / 6, on_secret_path: true,
      children: [secretMarker(3)],
    })]
    expect(bulkScope(t)).toStrictEqual({ clade: 'Felidae', rank: 'Family' })
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

  it('caps a bulk guess above an order of stingrays and far below one of frogs', () => {
    expect(BULK_CAP).toBeGreaterThanOrEqual(59)   // "stingray" in Myliobatiformes
    expect(BULK_CAP).toBeLessThan(1001)           // "snake" in Squamata; "frog" in Anura is 2,088
    expect(BULK_UNLOCK_WARMTH).toBe(3 / 6)        // order
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

describe('hints', () => {
  it('cost the score again, and never less than 10', () => {
    expect(hintCost(0)).toBe(10)
    expect(hintCost(7)).toBe(10)
    expect(hintCost(12)).toBe(12)
  })

  it('double the total each time, because the score counts earlier hints', () => {
    let score = 12
    for (const after of [24, 48, 96]) {
      score += hintCost(score)
      expect(score).toBe(after)
    }
  })

  it('are available before the first guess, and follow the ??? node after it', () => {
    expect(hintAvailable(null)).toBe(true)
    const t = tree()
    const marker = t.children[0].children[1].children[1]
    expect(hintAvailable(t)).toBe(false)   // no can_hint: only the answer is left
    marker.can_hint = true
    expect(hintAvailable(t)).toBe(true)
  })

  it('are not available once the round is won and there is no ??? node', () => {
    const t = tree()
    t.children[0].children[1].children.splice(1, 1)
    expect(hintAvailable(t)).toBe(false)
  })
})

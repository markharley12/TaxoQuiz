import { describe, expect, it, vi } from 'vitest'
import type { ExploreNode } from './api'
import {
  AUTO_EXPAND_SPECIES, EDGE, EXPAND_ALL_WARN, MIN_COARSE_W, NODE_SIZES,
  SLICE_BUDGET, addLoadedNames, allNames, countRendered, countVisible, fitWidth,
  hasTruncated, seedExpanded, spacingFor, spliceIn, subtitle, toD3,
} from './exploreLayout'

vi.mock('./taxonCache', () => ({ cachedTaxonInfo: () => undefined }))

function node(name: string, partial: Partial<ExploreNode> = {}): ExploreNode {
  return {
    name,
    rank: 'genus',
    depth: 0,
    child_count: partial.children?.length ?? 0,
    species_count: 1,
    node_count: 1,
    truncated: false,
    children: [],
    ...partial,
  } as ExploreNode
}

/** A parent with `n` leaf children. */
function bush(name: string, n: number, partial: Partial<ExploreNode> = {}): ExploreNode {
  const children = Array.from({ length: n }, (_, i) => node(`${name}-${i}`, { depth: 1 }))
  return node(name, { children, child_count: n, species_count: n, ...partial })
}

describe('the two budgets', () => {
  it('fetches wider than it shows', () => {
    // Conflating them gets both wrong: opening the root with all 200 fetched
    // nodes expanded produced a ~7000px tree whose own root children were off
    // screen, and fetching only what is shown makes every click a round trip.
    // The display budget lives on the node size as `show`, since a phone shows
    // fewer than a desktop; the fetch budget is one number for both.
    for (const size of Object.values(NODE_SIZES)) {
      expect(SLICE_BUDGET).toBeGreaterThan(size.show)
    }
  })
})

describe('fitWidth', () => {
  const coarse = NODE_SIZES.coarse

  it('narrows the box until a parent and a whole child column fit', () => {
    // Or the "+" at the child's right edge is past the view and the node reads
    // as a dead end.
    const container = 364
    const fitted = fitWidth(coarse, container)
    expect(2 * fitted.w + coarse.hgap + 2 * EDGE).toBeLessThanOrEqual(container)
  })

  it('counts the root inset, which clipped the children after the first fix', () => {
    // Leaving EDGE out of the budget is what still pushed the child column off
    // the right edge while the arithmetic said it fit.
    const container = 364
    const withoutEdge = Math.floor((container - coarse.hgap) / 2)
    expect(fitWidth(coarse, container).w).toBeLessThan(withoutEdge)
  })

  it('measures the container, not the viewport', () => {
    // The app's own padding took a 390px phone down to 364. Same function, two
    // answers — which is the point of passing the measurement in.
    expect(fitWidth(coarse, 364).w).toBeLessThanOrEqual(fitWidth(coarse, 390).w)
  })

  it('never shrinks the box below the readable floor', () => {
    // Below it, panning is a better answer than an unreadable node.
    for (const container of [0.1, 100, 200, 250]) {
      expect(fitWidth(coarse, container).w).toBeGreaterThanOrEqual(MIN_COARSE_W)
    }
  })

  it('never widens a box that already fits', () => {
    expect(fitWidth(coarse, 4000).w).toBe(coarse.w)
  })

  it('returns the same object when nothing changed, so a re-fit is not a re-render', () => {
    expect(fitWidth(coarse, 4000)).toBe(coarse)
    expect(fitWidth(coarse, 0)).toBe(coarse)
  })

  it('keeps the box before the container has been measured', () => {
    // A ResizeObserver fires with 0 before layout; shrinking to the floor then
    // would be a visible jump.
    expect(fitWidth(coarse, 0)).toBe(coarse)
  })

  it('leaves everything but the width alone', () => {
    const fitted = fitWidth(coarse, 364)
    expect({ ...fitted, w: coarse.w }).toEqual(coarse)
  })
})

describe('spacingFor', () => {
  it('derives the pitch from the box, so a taller node cannot overlap its siblings', () => {
    for (const size of Object.values(NODE_SIZES)) {
      const spacing = spacingFor(size)
      expect(spacing.horizontal.y).toBeGreaterThan(size.h)
      expect(spacing.vertical.x).toBeGreaterThan(size.w)
      expect(spacing.horizontal.x).toBeGreaterThan(size.w)
    }
  })

  it('reproduces the fine numbers exactly', () => {
    const spacing = spacingFor(NODE_SIZES.fine)
    expect(spacing.horizontal).toEqual({ x: 210, y: 46 })
    expect(spacing.vertical).toEqual({ x: 180, y: 88 })
  })
})

describe('NODE_SIZES', () => {
  it('gives a finger a box and an info button it can hit', () => {
    // The bug: explore's 170x38 box at zoom 0.8 reached the screen as 136x30,
    // its info button as 12x12, and the "+" as 6x16 with its centre 12px from
    // the info button's. Against a ~44px fingertip those two were one target.
    const { h, zoom, info } = NODE_SIZES.coarse
    expect(h * zoom).toBeGreaterThanOrEqual(44)
    expect(info * zoom).toBeGreaterThanOrEqual(36)
    expect(info * zoom * h * zoom).toBeGreaterThanOrEqual(44 * 44 * 0.9)
  })

  it('keeps the two controls apart, since a miss must not do the other thing', () => {
    // Info sits at the far left and "+" at the far right, so most of the box
    // lies between them and every miss lands on "expand" — the commoner intent,
    // and the one a second tap undoes.
    const s = NODE_SIZES.coarse
    const apart = (s.w - s.info - s.plus) * s.zoom
    expect(apart).toBeGreaterThanOrEqual(100)
  })

  it('does not size "+" as a touch target, because the whole box toggles', () => {
    // It is a sign saying "there is more below", not something to aim at.
    // Keeping it narrow buys back label width.
    expect(NODE_SIZES.coarse.plus).toBeLessThan(NODE_SIZES.coarse.info)
  })

  it('opens fewer nodes on a phone than on a desktop', () => {
    expect(NODE_SIZES.coarse.show).toBeLessThan(NODE_SIZES.fine.show)
  })

  it('leaves the mouse layout exactly as it was', () => {
    expect(NODE_SIZES.fine).toEqual({
      w: 170, h: 38, zoom: 0.8, info: 15, plus: 14, thumb: 26,
      label: 12, sub: 9.5, pad: 6, gap: 4, hgap: 40, show: 40,
    })
  })
})

describe('seedExpanded', () => {
  it('opens breadth-first until the budget is spent', () => {
    const tree = node('root', {
      children: [bush('a', 3, { depth: 1 }), bush('b', 3, { depth: 1 })],
      child_count: 2,
    })
    const expanded = seedExpanded(tree, 100)
    expect(expanded.has('root')).toBe(true)
    expect(expanded.has('a')).toBe(true)
    expect(expanded.has('b')).toBe(true)
  })

  it('stops before overshooting the budget', () => {
    const tree = node('root', {
      children: [bush('a', 30, { depth: 1 }), bush('b', 30, { depth: 1 })],
      child_count: 2,
    })
    const expanded = seedExpanded(tree, 40)
    expect(countVisible(tree, expanded)).toBeLessThanOrEqual(40)
  })

  it('opens exactly one level when a phone caps it', () => {
    // A phone fits two columns, so a third generation is off the right edge —
    // and a node whose children are all off-screen renders with no "+" (it is
    // open) and nothing under it, which reads as a dead end rather than "pan".
    const tree = node('root', {
      children: [bush('a', 2, { depth: 1 }), bush('b', 2, { depth: 1 })],
      child_count: 2,
    })
    const expanded = seedExpanded(tree, 100, [], 1)
    expect(expanded.has('root')).toBe(true)
    // Its children stay closed, so each keeps the "+" that says to tap it.
    expect(expanded.has('a')).toBe(false)
    expect(expanded.has('b')).toBe(false)
  })

  it('opens more than one level when nothing caps it', () => {
    const tree = node('root', {
      children: [bush('a', 2, { depth: 1 }), bush('b', 2, { depth: 1 })],
      child_count: 2,
    })
    const expanded = seedExpanded(tree, 100)
    expect(expanded.has('a')).toBe(true)
  })

  it('keeps the jump spine open regardless of budget', () => {
    // After a jump the lineage must stay open, or the thing you jumped to is
    // not on screen — Homo sapiens is 59 levels from Animalia.
    const deep = node('root', {
      children: [bush('big', 500, { depth: 1 })],
      child_count: 1,
    })
    const expanded = seedExpanded(deep, 5, ['root', 'big'])
    expect(expanded.has('root')).toBe(true)
    expect(expanded.has('big')).toBe(true)
  })

  it('does not open a childless node', () => {
    const tree = node('root', { children: [node('leaf', { depth: 1 })], child_count: 1 })
    expect(seedExpanded(tree, 100).has('leaf')).toBe(false)
  })

  it('terminates on a single-child chain', () => {
    // The Wikidata tree opens with one, which is why depth is the wrong knob.
    let chain = node('n20', { depth: 20 })
    for (let i = 19; i >= 0; i--) chain = node(`n${i}`, { depth: i, children: [chain], child_count: 1 })
    expect(() => seedExpanded(chain, 100)).not.toThrow()
    expect(seedExpanded(chain, 100).size).toBeGreaterThan(1)
  })
})

describe('countVisible', () => {
  it('counts a closed node as one, whatever is under it', () => {
    const tree = node('root', { children: [bush('a', 50, { depth: 1 })], child_count: 1 })
    expect(countVisible(tree, new Set(['root']))).toBe(2)
  })

  it('counts through the open ones', () => {
    const tree = node('root', { children: [bush('a', 3, { depth: 1 })], child_count: 1 })
    expect(countVisible(tree, new Set(['root', 'a']))).toBe(5)
  })
})

describe('hasTruncated', () => {
  it('finds truncation anywhere below, not only at the top', () => {
    // A small clade with any truncation under it must be re-fetched whole, or
    // "expand all within" stops at the first gap.
    const deep = node('root', {
      children: [node('a', { depth: 1, children: [node('b', { depth: 2, truncated: true })], child_count: 1 })],
      child_count: 1,
    })
    expect(hasTruncated(deep)).toBe(true)
  })

  it('is false for a fully loaded clade', () => {
    expect(hasTruncated(bush('a', 3))).toBe(false)
  })
})

describe('addLoadedNames', () => {
  it('skips a truncated node rather than opening it', () => {
    // The trap: opening it renders no children — they were never sent — while
    // clearing the "+" that says there is more, leaving a dead end you cannot
    // click your way out of. Half the nodes in a root fetch are truncated.
    const tree = node('root', {
      children: [
        node('loaded', { depth: 1, children: [node('kid', { depth: 2 })], child_count: 1 }),
        node('cut', { depth: 1, truncated: true, child_count: 9 }),
      ],
      child_count: 2,
    })
    const into = new Set<string>()
    addLoadedNames(tree, into)

    expect(into.has('root')).toBe(true)
    expect(into.has('loaded')).toBe(true)
    expect(into.has('cut')).toBe(false)
  })

  it('skips everything under a truncated node too', () => {
    const tree = node('root', {
      children: [node('cut', {
        depth: 1, truncated: true,
        children: [node('under', { depth: 2 })], child_count: 5,
      })],
      child_count: 1,
    })
    const into = new Set<string>()
    addLoadedNames(tree, into)
    expect(into.has('under')).toBe(false)
  })
})

describe('spliceIn', () => {
  it('replaces the named node', () => {
    const tree = node('root', { children: [node('a', { depth: 1 })], child_count: 1 })
    const out = spliceIn(tree, 'a', bush('a', 2, { depth: 1 }))
    expect(out.children[0].children).toHaveLength(2)
  })

  it('shares the untouched branches, so React skips re-rendering them', () => {
    const untouched = bush('keep', 3, { depth: 1 })
    const tree = node('root', { children: [node('a', { depth: 1 }), untouched], child_count: 2 })
    const out = spliceIn(tree, 'a', node('a', { depth: 1, rank: 'family' }))
    expect(out.children[1]).toBe(untouched)
  })

  it('returns the very same tree when the name is not in it', () => {
    const tree = node('root', { children: [node('a', { depth: 1 })], child_count: 1 })
    expect(spliceIn(tree, 'absent', node('x'))).toBe(tree)
  })

  it('can replace the root itself', () => {
    const tree = node('root')
    const replacement = bush('root', 2)
    expect(spliceIn(tree, 'root', replacement)).toBe(replacement)
  })
})

describe('toD3', () => {
  it('renders no children for a closed node', () => {
    const tree = bush('a', 3)
    expect(toD3(tree, new Set(), 'example').children).toHaveLength(0)
    expect(toD3(tree, new Set(['a']), 'example').children).toHaveLength(3)
  })

  it('marks a closed branch as having something hidden, and a leaf as not', () => {
    // Both a server truncation and a folded-away branch get the same "+",
    // because from the reader's side they are the same thing.
    const closed = toD3(bush('a', 3), new Set(), 'example')
    expect(closed.attributes.hasHidden).toBe(true)
    expect(closed.attributes.isLeaf).toBe(false)

    const leaf = toD3(node('sp'), new Set(), 'example')
    expect(leaf.attributes.hasHidden).toBe(false)
    expect(leaf.attributes.isLeaf).toBe(true)
  })

  it('drops the "+" once a node is open', () => {
    expect(toD3(bush('a', 3), new Set(['a']), 'example').attributes.hasHidden).toBe(false)
  })

  it('prefers the common name for the label', () => {
    const named = node('Aves', { common_name: 'bird' })
    expect(toD3(named, new Set(), 'example').attributes.label).toBe('bird')
    expect(toD3(node('Aves'), new Set(), 'example').attributes.label).toBe('Aves')
  })

  it('keys the node on its taxon name, not its label', () => {
    // The label is what you read; the name is what info is looked up by.
    expect(toD3(node('Aves', { common_name: 'bird' }), new Set(), 'example').name).toBe('Aves')
  })
})

describe('subtitle', () => {
  it('gives a species its scientific name', () => {
    expect(subtitle(node('Lion', { scientific_name: 'Panthera leo', child_count: 0 })))
      .toBe('Panthera leo')
  })

  it('falls back to the rank when a leaf has no scientific name', () => {
    expect(subtitle(node('x', { rank: 'species', child_count: 0 }))).toBe('species')
  })

  it('gives a clade its rank and its species count', () => {
    expect(subtitle(bush('Aves', 3, { rank: 'class', species_count: 11000 })))
      .toBe('class · 11,000 species')
  })

  it('says "clade" for an unranked internal node', () => {
    expect(subtitle(bush('x', 2, { rank: '', species_count: 2 }))).toBe('clade · 2 species')
  })
})

describe('countRendered / allNames', () => {
  it('counts what is actually on screen, not what is in memory', () => {
    const tree = node('root', { children: [bush('a', 50, { depth: 1 })], child_count: 1 })
    expect(countRendered(toD3(tree, new Set(['root']), 'example'))).toBe(2)
    expect(allNames(tree).size).toBe(52)
  })
})

describe('thresholds', () => {
  it('warns about "expand all" just above the size measured to be usable', () => {
    // 1,996 nodes: 4.7 s to render, 120 ms a drag — janky but fine. 27,169:
    // ~180 s and 15.4 s a drag, with Chrome unable to screenshot the page.
    // A measurement, not a guess. Re-measure before changing it.
    expect(EXPAND_ALL_WARN).toBe(2000)
  })

  it('auto-opens a clade small enough that the dance is not worth it', () => {
    // Counted in species, not nodes, because that is what the box already says
    // is down there.
    expect(AUTO_EXPAND_SPECIES).toBe(25)
    expect(AUTO_EXPAND_SPECIES).toBeLessThan(SLICE_BUDGET)
  })
})

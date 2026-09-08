import { describe, expect, it } from 'vitest'
import type { TreeNode } from './api'
import {
  BOX_SIZES, SPACER, compress, countNodes, gameSpacing, nodeToD3, rowsForGap,
  type D3Data,
} from './gameLayout'

function node(partial: Partial<TreeNode> & { label: string; depth: number }): TreeNode {
  return {
    name: partial.label,
    node_type: 'ancestor',
    on_secret_path: false,
    warmth: 0,
    children: [],
    ...partial,
  } as TreeNode
}

/** Longest root-to-leaf path, in rendered rows — what react-d3-tree lays out. */
function renderedDepth(d3: D3Data): number {
  return 1 + Math.max(0, ...d3.children.map(renderedDepth))
}

function spacersOn(d3: D3Data, into: string[] = []): string[] {
  into.push(d3.name)
  for (const c of d3.children) spacersOn(c, into)
  return into
}

describe('compress', () => {
  it('collapses a single-child ancestor chain into one node', () => {
    const tree = node({
      label: 'Animalia', depth: 0,
      children: [node({
        label: 'Chordata', depth: 1,
        children: [node({ label: 'Mammalia', depth: 2, node_type: 'guess' })],
      })],
    })
    const out = compress(tree)
    expect(out.label).toBe('Chordata › Animalia')
    expect(out.children).toHaveLength(1)
    expect(out.children[0].label).toBe('Mammalia')
  })

  it('joins `name` the same way it joins `label`', () => {
    // The popup is keyed on `name`. Joined differently, it opens on one taxon
    // out of the several the collapsed node now stands for.
    const tree = node({
      label: 'Animalia', depth: 0,
      children: [node({ label: 'Chordata', depth: 1, children: [node({ label: 'X', depth: 2, node_type: 'guess' })] })],
    })
    const out = compress(tree)
    expect(out.name).toBe(out.label)
  })

  it('keeps the deepest taxon first, which is what the label leads with', () => {
    // The hover preview looks up the *first* name in a compressed node, so it
    // has to be the most specific one — the one the reader is looking at.
    const tree = node({
      label: 'Animalia', depth: 0,
      children: [node({
        label: 'Chordata', depth: 1,
        children: [node({
          label: 'Mammalia', depth: 2,
          children: [node({ label: 'Cat', depth: 3, node_type: 'guess' })],
        })],
      })],
    })
    expect(compress(tree).name?.split(' › ')[0]).toBe('Mammalia')
  })

  it('does not collapse a branch point', () => {
    const tree = node({
      label: 'Animalia', depth: 0,
      children: [
        node({ label: 'Chordata', depth: 1 }),
        node({ label: 'Arthropoda', depth: 1 }),
      ],
    })
    expect(compress(tree).label).toBe('Animalia')
    expect(compress(tree).children).toHaveLength(2)
  })

  it('never absorbs a guess, a secret or the ??? node into an ancestor', () => {
    // Only ancestor-into-ancestor collapses. A guess is a thing the player
    // named and must keep its own box.
    for (const type of ['guess', 'secret'] as const) {
      const tree = node({
        label: 'Animalia', depth: 0,
        children: [node({ label: 'Cat', depth: 1, node_type: type })],
      })
      expect(compress(tree).label).toBe('Animalia')
      expect(compress(tree).children[0].label).toBe('Cat')
    }
  })

  it('leaves a lone node alone', () => {
    expect(compress(node({ label: 'Animalia', depth: 0 })).label).toBe('Animalia')
  })
})

describe('rowsForGap', () => {
  it('spends more rows on a bigger taxonomic gap', () => {
    // The bug: with chains collapsed, every edge cost one row regardless of the
    // evolutionary distance it covered, so a comb jelly branching at rank 1 and
    // a chimp branching at rank 55 rendered one row apart.
    expect(rowsForGap(55)).toBeGreaterThan(rowsForGap(1))
    expect(rowsForGap(16)).toBeGreaterThan(rowsForGap(4))
  })

  it('is monotonic', () => {
    let previous = 0
    for (let gap = 1; gap <= 80; gap++) {
      const rows = rowsForGap(gap)
      expect(rows).toBeGreaterThanOrEqual(previous)
      previous = rows
    }
  })

  it('is sub-linear, so a 60-rank tree still fits on a screen', () => {
    // One row per rank is truthful and makes the tree ~5000px tall. The square
    // root keeps the ordering while the tree stays readable.
    expect(rowsForGap(64)).toBe(8)
    expect(rowsForGap(60)).toBeLessThan(60 / 4)
  })

  it('never returns less than one row', () => {
    for (const gap of [-10, 0, 1]) expect(rowsForGap(gap)).toBeGreaterThanOrEqual(1)
  })
})

describe('nodeToD3', () => {
  it('spends no spacer on an adjacent parent and child', () => {
    const tree = node({
      label: 'Animalia', depth: 0,
      children: [node({ label: 'Chordata', depth: 1 })],
    })
    expect(spacersOn(nodeToD3(tree))).not.toContain(SPACER)
    expect(renderedDepth(nodeToD3(tree))).toBe(2)
  })

  it('threads spacer rows onto an edge that skipped ranks', () => {
    // Vertical distance has to encode taxonomic depth, not tree level.
    const tree = node({
      label: 'Animalia', depth: 0,
      children: [node({ label: 'Deep', depth: 16, node_type: 'guess' })],
    })
    const d3 = nodeToD3(tree)
    // rowsForGap(16) = 4, so three spacers plus the node itself.
    expect(spacersOn(d3).filter((n) => n === SPACER)).toHaveLength(3)
    expect(renderedDepth(d3)).toBe(5)
  })

  it('puts a far branch further down the page than a near one', () => {
    // The whole point: the shape must agree with the colour about which guess
    // diverged more recently.
    const combJelly = nodeToD3(node({
      label: 'Animalia', depth: 0,
      children: [node({ label: 'Comb jelly', depth: 1, node_type: 'guess' })],
    }))
    const chimp = nodeToD3(node({
      label: 'Animalia', depth: 0,
      children: [node({ label: 'Chimp', depth: 55, node_type: 'guess' })],
    }))
    expect(renderedDepth(chimp)).toBeGreaterThan(renderedDepth(combJelly))
  })

  it('keeps the real node at the end of the spacer chain', () => {
    const tree = node({
      label: 'Animalia', depth: 0,
      children: [node({ label: 'Deep', depth: 9, node_type: 'guess' })],
    })
    let cursor = nodeToD3(tree).children[0]
    while (cursor.name === SPACER) cursor = cursor.children[0]
    expect(cursor.name).toBe('Deep')
    expect(cursor.attributes.type).toBe('guess')
  })

  it('carries the guess colour on its spacers, so the connector matches', () => {
    const tree = node({
      label: 'Animalia', depth: 0, warmth: 0,
      children: [node({
        label: 'Deep', depth: 9, warmth: 1, node_type: 'guess',
        lca_warmth: 0.5, on_secret_path: true,
      })],
    })
    const cursor = nodeToD3(tree).children[0]
    expect(cursor.name).toBe(SPACER)
    expect(cursor.attributes.warmth).toBe(0.5)
    expect(cursor.attributes.onPath).toBe(true)
  })

  it('colours a guess by its LCA rank and everything else by its own', () => {
    // lca_warmth is the score — how close the guess got — while the guess's own
    // rank is always Species and would paint every guess green. A plain
    // ancestor has no LCA and uses its own rank.
    const guess = nodeToD3(node({
      label: 'Cat', depth: 30, warmth: 1, node_type: 'guess', lca_warmth: 0.5,
    }))
    expect(guess.attributes.warmth).toBe(0.5)
    const ancestor = nodeToD3(node({ label: 'Animalia', depth: 3, warmth: 0 }))
    expect(ancestor.attributes.warmth).toBe(0)
  })

  it('gives the ??? node no taxa to look up', () => {
    // That is what stops it leaking the answer through a picture, and it is the
    // same property that makes it unclickable.
    const unknown = nodeToD3({ ...node({ label: '???', depth: 5 }), name: null } as TreeNode)
    expect(unknown.attributes.taxa).toBe('')
  })

  it('never spaces the root, which has no parent', () => {
    expect(nodeToD3(node({ label: 'Animalia', depth: 40 })).name).toBe('Animalia')
  })
})

describe('countNodes', () => {
  it('counts the whole subtree including the root', () => {
    const tree = node({
      label: 'a', depth: 0,
      children: [node({ label: 'b', depth: 1, children: [node({ label: 'c', depth: 2 })] }), node({ label: 'd', depth: 1 })],
    })
    expect(countNodes(tree)).toBe(4)
  })
})

describe('gameSpacing', () => {
  it('derives the pitch from the box, so a node cannot overlap its siblings', () => {
    // Written out rather than derived, a taller coarse box kept the old row
    // pitch and overlapped itself.
    for (const box of Object.values(BOX_SIZES)) {
      const spacing = gameSpacing(box)
      expect(spacing.horizontal.y).toBeGreaterThan(box.h)
      expect(spacing.vertical.x).toBeGreaterThan(box.w)
    }
  })

  it('pins the pitch, which is what decides how much tree fits on a screen', () => {
    // Across, x is the cost of one more generation; Down, it is the gap between
    // side-by-side siblings. Both came down in Sep 2026 — a generation used to
    // cost 240px, so a phone could not show a parent and child in full.
    const spacing = gameSpacing(BOX_SIZES.fine)
    expect(spacing.horizontal).toEqual({ x: 196, y: 52 })
    expect(spacing.vertical).toEqual({ x: 188, y: 80 })
  })
})

describe('BOX_SIZES', () => {
  it('gives a finger a box it can actually hit', () => {
    // A node's size under a fingertip is its CSS size times the tree's zoom:
    // 200x40 at zoom 0.9 lands as 180x36, under the ~44px a finger can aim at.
    const { w, h, zoom } = BOX_SIZES.coarse
    expect(h * zoom).toBeGreaterThanOrEqual(44)
    expect(w * zoom).toBeGreaterThanOrEqual(44)
  })

  it('pins the mouse layout', () => {
    expect(BOX_SIZES.fine).toEqual({ w: 176, h: 40, zoom: 0.9, thumb: 26, font: 11 })
  })

  it('fits a parent and a whole child column on a phone', () => {
    // The reason the coarse box shrank. At 210 wide with a 40px connector, one
    // generation cost 250px and a 390px screen could show neither box in full.
    const { w, zoom } = BOX_SIZES.coarse
    const pitch = gameSpacing(BOX_SIZES.coarse).horizontal.x
    expect((w + pitch) * zoom).toBeLessThanOrEqual(390)
  })
})

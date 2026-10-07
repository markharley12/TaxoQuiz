// Explore's geometry and its expand/collapse rules.
//
// Pure, and in its own module so it can be tested. Everything here is a
// decision that reads as arbitrary and is not: the two budgets that must stay
// separate numbers, the box width that has to be measured rather than assumed,
// and the two traps around truncated nodes — see the notes on each.
import { cachedTaxonInfo } from './taxonCache'
import type { ExploreNode } from './api'
import type { Placed, View } from './gameLayout'

// How many nodes one browse request returns. Opening a node pulls its
// descendants too, so the shape below it is visible immediately and the next
// click is usually free. The server spends the budget breadth-first, so it runs
// deep through a single-child chain and stops early in a bush — see the API.
export const SLICE_BUDGET = 200
export const FETCH_ALL = -1

// Node geometry, the layout spacing derived from it, and how much of the tree
// the first screen opens. Two sets, because a node's size *under a fingertip*
// is its CSS size times the tree's zoom, and the mouse numbers land nowhere
// near what a finger can aim at.
//
// Measured on a 390x844 phone viewport before this existed: the box came out
// 136x30, the info button 12x12, and the "+" glyph 6x16 with its centre 12px
// from the info button's. Against a ~44px fingertip those two controls are one
// target, so tapping "+" to open a clade opened its article instead — and the
// article, the only route to a picture without a mouse, was itself a 12px dot.
// Both of the things that were hard to do on a phone were this one thing.
//
// So on a coarse pointer: no zoom-down, a box tall enough to hold a real
// target, and the two controls at opposite ends of it. `plus` is deliberately
// NOT sized as a touch target — the whole box toggles, so it is a sign saying
// "there is more below" rather than something you have to hit. Only `info` has
// to be aimed at, being the one small control competing with the box for the
// same tap.
//
// The coarse width is a constraint rather than a taste, and `fitWidth` below
// solves it against the container that is actually there: a phone has to show a
// parent and a *whole* child column at once, or the "+" at the child's right
// edge — the only sign that there is anything below it — sits past the edge of
// the view. Long clade names ellipsise instead; the full name is one tap away
// in the popup, whereas an invisible "+" is a dead end, so that is the right
// way round to spend the pixels. The number below is the cap, used when there
// is room for it.
//
// `info` lands at 40x52. Stated honestly: not the 44px square the guidance
// asks for, but past 44 in its long dimension, past a 44x44's area, and — the
// part that actually mattered — 120px from the "+" instead of 12.
//
// `show` is how many nodes the first screen opens, and is deliberately far
// below `SLICE_BUDGET`: fetching is about round trips, showing is about
// legibility, and conflating them gets both wrong. Opening the root with all
// 200 fetched nodes expanded made a tree ~7000px tall whose own root children
// were off-screen. On a phone even 40 spreads the root's children over several
// screens of empty canvas, so 14 leaves them as one readable list.
export interface NodeSize {
  /** Node box, in CSS px before `zoom`. */
  w: number
  h: number
  zoom: number
  /** Hit-area widths; both span the box's full height. */
  info: number
  plus: number
  thumb: number
  label: number
  sub: number
  pad: number
  gap: number
  /** Connector length between generations, going across. */
  hgap: number
  /** Nodes opened on the first screen. */
  show: number
}

//
// `hgap` came down in Sep 2026 to fit more generations on a screen. The widths
// did not: explore exists to *read* a taxonomy, its box already spends most of
// itself on chrome (an info button, a thumbnail, a "+"), and a narrower one buys
// a column at the cost of ellipsising the names that are the entire point. The
// connector between generations is the part that was free to give up.
export const NODE_SIZES: Record<'fine' | 'coarse', NodeSize> = {
  fine:   { w: 170, h: 38, zoom: 0.8, info: 15, plus: 14, thumb: 26, label: 12, sub: 9.5, pad: 6, gap: 4, hgap: 24, show: 40 },
  coarse: { w: 184, h: 56, zoom: 1.0, info: 38, plus: 22, thumb: 26, label: 14, sub: 10.5, pad: 2, gap: 4, hgap: 14, show: 14 },
}

// Derived rather than written out, so the box and the gaps between boxes cannot
// drift apart — a taller box with the old row pitch overlaps its own siblings.
// Across leaves a connector of `hgap` between generations and 6px between
// stacked siblings; down leaves 8px between side-by-side siblings and 22px
// between rows. All four came down in Oct 2026 (from 8, 10 and 50) at the
// owner's request, to fit more of an opened clade on a screen.
/** Narrow the box until a parent and a whole child column fit side by side.
 *
 * Measured rather than assumed: the tree's container is not the viewport — the
 * app's own padding took a 390px phone down to 364, which was enough to push
 * every child box's "+" off the right edge while the arithmetic said it fit.
 * The floor stops a very narrow screen from shrinking the box into nothing;
 * below it, panning is the better answer than an unreadable node.
 */
export const MIN_COARSE_W = 150

/** Gap between the root's outer edge and the edge of the view. */
export const EDGE = 4

export function fitWidth(s: NodeSize, containerW: number): NodeSize {
  if (!containerW) return s
  // The root does not start at zero — it is inset by EDGE, and that inset is
  // part of the budget. Leaving it out is what still clipped the child column
  // after the width was supposedly fitted.
  const fits = Math.floor((containerW - s.hgap - 2 * EDGE) / 2)
  const w = Math.max(MIN_COARSE_W, Math.min(s.w, fits))
  return w === s.w ? s : { ...s, w }
}

export function spacingFor(s: NodeSize) {
  return {
    horizontal: { x: s.w + s.hgap, y: s.h + 6 },
    // 22px between rows going down, still room for the connectors' curve. It
    // was 50, which with the group gap below read as a sparse grid (Oct 2026).
    vertical: { x: s.w + 8, y: s.h + 22 },
  } as const
}

/** Extra space, in px, between neighbours with different parents, so a group
 *  still reads as a group. */
export const GROUP_GAP = 8

/** react-d3-tree's `separation`, which is a multiple of the sibling pitch.
 *
 *  It was a flat 1.25, i.e. a quarter of the pitch — about right going across,
 *  where the pitch is a box's *height* (46px, so 12px extra), and four times too
 *  much going down, where it is a box's *width* (180px, so 45px extra). And it
 *  applies nearly everywhere: a chain of single children makes every pair of
 *  neighbours below a fork cousins, so a fully opened clade going down was a
 *  grid of 55px gaps. Worked out from a gap in pixels instead, so both
 *  orientations get the same one. */
export function separationFor(s: NodeSize, orientation: 'horizontal' | 'vertical') {
  const spacing = spacingFor(s)
  const pitch = orientation === 'horizontal' ? spacing.horizontal.y : spacing.vertical.x
  return { siblings: 1, nonSiblings: 1 + GROUP_GAP / pitch }
}

// Above this many nodes, "Expand all" asks first.
//
// Measured on this machine against the full Wikidata scrape, rather than
// guessed. react-d3-tree lays out every node and renders a foreignObject each,
// and the SVG canvas grows with the widest level — 18,421 leaves at 220px is a
// four-million-pixel-wide surface:
//
//     nodes    first render   one drag-pan
//     ------   ------------   ------------
//      1,996          4.7 s         120 ms   usable, slightly janky
//     27,169        ~180 s         15.4 s    unusable; Chrome could not even
//                                            screenshot the page afterwards
//
// The cost is superlinear and the wall is somewhere in the low thousands, so
// the threshold sits just above the largest size measured to be fine. Bigger is
// still offered — the honest answer to "what if I render the whole thing?" is
// to let someone try it — but with the numbers on the dialog rather than a
// vague warning.
export const EXPAND_ALL_WARN = 2000

// Opening a clade this small opens the whole thing, rather than one level at a
// time. The level-by-level dance earns its keep on a clade with hundreds
// beneath it; on a genus of three it is just extra clicks for a shape you could
// already see the whole of. Counted in species, not nodes, because that is what
// the box already tells you is down there — the rendered node count is several
// times this, since every species drags its lineage on screen with it.
//
// 100 since Oct 2026, the owner's choice; it was 25. On the Full dataset a
// clade under 100 species draws 88 boxes at the median and 244 at most, more
// than one `SLICE_BUDGET` fetch holds — which is why ExploreTree fetches a small
// clade whole rather than with the budget.
export const AUTO_EXPAND_SPECIES = 100


export interface D3Data {
  name: string
  attributes: {
    label: string
    sub: string
    thumb: string
    depth: number
    warmth: number
    isLeaf: boolean
    hasHidden: boolean
    collapsed: boolean
  }
  children: D3Data[]
}

/** Replace the node named `name` with `replacement`, structurally sharing the rest. */
export function spliceIn(node: ExploreNode, name: string, replacement: ExploreNode): ExploreNode {
  if (node.name === name) return replacement
  if (!node.children.length) return node
  let changed = false
  const children = node.children.map((c) => {
    const next = spliceIn(c, name, replacement)
    if (next !== c) changed = true
    return next
  })
  return changed ? { ...node, children } : node
}

export function subtitle(node: ExploreNode): string {
  if (node.child_count === 0) return node.scientific_name ?? node.rank
  return `${node.rank || 'clade'} · ${node.species_count.toLocaleString()} species`
}

export function toD3(node: ExploreNode, expanded: Set<string>, dataset: string): D3Data {
  const isOpen = expanded.has(node.name)
  const isLeaf = node.child_count === 0
  return {
    name: node.name,
    attributes: {
      label: node.common_name ?? node.name,
      sub: subtitle(node),
      // Empty until something has looked this node up. Read straight from the
      // cache rather than threaded through as a prop: the component subscribes
      // to the cache, so a lookup landing rebuilds this and the picture appears.
      thumb: cachedTaxonInfo(node.name, dataset)?.image_url ?? '',
      depth: node.depth,
      warmth: node.warmth,
      isLeaf,
      // Something is hidden below this node: either the server did not send it,
      // or the user folded it away. Both get the same affordance, because from
      // the reader's side they are the same thing — there is more down there.
      hasHidden: !isLeaf && !isOpen,
      collapsed: !isOpen,
    },
    children: isOpen ? node.children.map((c) => toD3(c, expanded, dataset)) : [],
  }
}

export function countRendered(node: D3Data): number {
  return 1 + node.children.reduce((sum, c) => sum + countRendered(c), 0)
}

/** Names to open so that roughly `budget` nodes are visible, breadth-first.
 *
 * `keep` is opened regardless of budget: it is the lineage spine after a jump,
 * which must stay open or the thing you jumped to is not on screen.
 *
 * `maxLevels` caps how many generations get opened, which is a different limit
 * from the budget and is there for phones. A phone fits two columns, so a third
 * generation is off the right edge — and a node whose children are all
 * off-screen renders with no "+" (it *is* open) and nothing visible below it,
 * which reads as a dead end rather than as "scroll right". Opening exactly one
 * level leaves every child collapsed, carrying the "+" that says to tap it.
 */
export function seedExpanded(
  root: ExploreNode,
  budget: number,
  keep: string[] = [],
  maxLevels = Infinity,
): Set<string> {
  const expanded = new Set<string>(keep)
  let shown = countVisible(root, expanded)
  let frontier = [root]
  let level = 0
  while (frontier.length && level < maxLevels) {
    const next: ExploreNode[] = []
    for (const n of frontier) {
      if (!n.children.length) continue
      if (!expanded.has(n.name)) {
        if (shown + n.children.length > budget) continue
        expanded.add(n.name)
        shown += n.children.length
      }
      next.push(...n.children)
    }
    if (!next.length) break
    frontier = next
    level += 1
  }
  return expanded
}

export function countVisible(node: ExploreNode, expanded: Set<string>): number {
  if (!expanded.has(node.name)) return 1
  return 1 + node.children.reduce((sum, c) => sum + countVisible(c, expanded), 0)
}

export function allNames(node: ExploreNode, into: Set<string> = new Set()): Set<string> {
  into.add(node.name)
  for (const c of node.children) allNames(c, into)
  return into
}

export function hasTruncated(node: ExploreNode): boolean {
  return node.truncated || node.children.some(hasTruncated)
}

/** Open everything under `node` that is actually in memory.
 *
 * A truncated node is skipped rather than opened: opening it would render no
 * children — they were never sent — while clearing the "+" that says there is
 * more down there, leaving a dead end you cannot click your way out of. Half of
 * the nodes in a root fetch are truncated, so this is the common case, not an
 * edge one.
 */
export function addLoadedNames(node: ExploreNode, into: Set<string>) {
  if (node.truncated) return
  into.add(node.name)
  for (const c of node.children) addLoadedNames(c, into)
}

/** Space kept between the framed node and the edge of the view, when the node
 *  and its children are too long to fit. The root's inset: `fitWidth` sizes a
 *  phone's box so that two columns fill the view with exactly that to spare. */
export const FOCUS_MARGIN = EDGE

/** The view after a node is tapped open or shut: centred on that node, at the
 *  zoom the reader already has.
 *
 *  The layout has to change — opening a node pushes its neighbours apart — so
 *  the one thing the reader can hold on to is the node they tapped. It used to
 *  be the tree's root instead: every expand re-placed the whole tree, which
 *  threw the view hundreds of pixels at the default zoom. Centring on the node
 *  is also what the game tree does with a guess, so the two trees agree.
 *
 *  Opened, the node is framed *with its children* along the generations axis,
 *  since they are what was asked for: centred together when they fit, otherwise
 *  the node at the ancestors' edge with its children running on from it. On a
 *  phone that is the node in the left column and its children filling the
 *  right. Across the siblings the node is centred, and so are its children,
 *  being laid out centred on it. Shut, or with nothing below, the node alone
 *  goes to the middle. */
export function viewOnTapped(
  node: Placed, children: Placed[], box: { w: number; h: number }, view: View,
  width: number, height: number, orientation: 'horizontal' | 'vertical',
): View {
  const z = view.zoom
  const across = orientation === 'horizontal'
  const gen = (p: Placed) => (across ? p.x : p.y)
  const sib = (p: Placed) => (across ? p.y : p.x)
  const genLimit = across ? width : height
  const sibLimit = across ? height : width
  const half = (across ? box.w : box.h) / 2

  let genAt = genLimit / 2 - gen(node) * z
  if (children.length > 0) {
    const near = gen(node) - half
    const far = Math.max(...children.map((c) => gen(c) + half))
    genAt = (far - near) * z <= genLimit - 2 * FOCUS_MARGIN
      ? genLimit / 2 - ((near + far) / 2) * z
      : FOCUS_MARGIN - near * z
  }
  const sibAt = sibLimit / 2 - sib(node) * z
  return across ? { x: genAt, y: sibAt, zoom: z } : { x: sibAt, y: genAt, zoom: z }
}

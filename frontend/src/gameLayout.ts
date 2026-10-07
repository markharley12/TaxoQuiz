// Turning a game-state tree into what react-d3-tree lays out.
//
// Pure, and in its own module so it can be tested: these are the display
// decisions that were each wrong once — the collapsed-chain labels, and the
// spacer rows that make vertical distance mean taxonomic depth rather than
// tree level. See the notes on each.
import type { TreeNode } from './api'

export interface D3Data {
  name: string
  attributes: { type: string; onPath: boolean; warmth: number; taxa: string }
  children: D3Data[]
}

// Collapsing a single-child chain joins the labels for display; `name` has to
// be joined the same way, or the popup opens on one taxon out of the several
// the node now stands for.
export function compress(node: TreeNode): TreeNode {
  const children = node.children.map(compress)
  if (node.node_type === 'ancestor' && children.length === 1 && children[0].node_type === 'ancestor') {
    const child = children[0]
    return {
      ...child,
      label: `${child.label} › ${node.label}`,
      name: `${child.name} › ${node.name}`,
    }
  }
  return { ...node, children }
}

// How many layout rows to spend on an edge spanning `gap` taxonomic ranks.
//
// react-d3-tree positions nodes by tree level, so without this every edge is one
// row regardless of how much evolutionary distance it covers. Once single-child
// chains are collapsed that is badly misleading: with a 64-deep tree, a chimp
// (branching from a human at rank 55) and a comb jelly (branching at rank 1)
// render one row apart, so the shape says they diverged at about the same time
// when the whole point of the game is that they did not.
//
// Sub-linear on purpose. One row per rank is truthful but makes a 60-rank tree
// ~5000px tall and unreadable; the square root keeps the ordering intact and the
// differences plainly visible while the tree still fits on a screen.
export function rowsForGap(gap: number): number {
  return Math.max(1, Math.round(Math.sqrt(Math.max(gap, 1))))
}

export const SPACER = '__spacer__'

export function countNodes(node: TreeNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0)
}

// Node box, and the spacing each orientation needs around it. Across gets a
// tighter row pitch than Down gets a column pitch, because the box is five
// times wider than it is tall.
//
// Two sets, for the same reason explore has them: a box's size under a
// fingertip is its CSS size times the zoom, and 200x40 at zoom 0.9 lands as
// 180x36 — under the ~44px a finger can aim at. The game tree is the milder
// case, since the whole box is one target and there are no small controls
// beside it to hit by mistake, but 36px is still a box you poke at twice.
//
// The spacings are derived so they cannot drift from the box: a taller node
// with the old row pitch overlaps its own siblings. The fine numbers reproduce
// what these were — across, a 40px connector and a 12px sibling gap; down, 20px
// between side-by-side siblings and 40px of row.
//
// The widths came down in Sep 2026, and the gaps with them. A generation cost
// 240px across with a mouse and 250 on a phone, so a 390px screen could not
// show a parent and its child in full — you panned to read a tree whose whole
// point is its shape. Across is the phone default precisely because generations
// run along the axis you have least of, which is what makes the pitch the thing
// worth spending on.
//
// The phone zoomed out from 1.0 to 0.75 later that month, with the box resized
// in CSS pixels for where it lands: 176x60 reaches the screen as 132x45, just
// over the touch floor, with an 11px name. At 1.0 a phone showed the guess
// column and a sliver of its parents, so a round read as a stack of coloured
// boxes rather than a tree; 0.75 shows two and a half generations. Further out
// would take the box under what a finger can hit, which a test pins, so the rest
// of the fix is where the view is put — see GameTree's focus effect.
export const BOX_SIZES = {
  fine:   { w: 176, h: 40, zoom: 0.9, thumb: 26, font: 11 },
  coarse: { w: 176, h: 60, zoom: 0.75, thumb: 34, font: 15 },
}

export function gameSpacing(b: { w: number; h: number }) {
  return {
    // Across: x is the connector between generations, so it is the whole cost
    // of seeing further back. Down: x is the gap between side-by-side siblings,
    // and 12 is enough to read two boxes as two.
    horizontal: { x: b.w + 20, y: b.h + 12 },
    vertical: { x: b.w + 12, y: b.h + 40 },
  } as const
}

/** Where the tree is drawn: its translate, and the zoom. */
export interface View { x: number; y: number; zoom: number }

export function sameView(a: View, b: View): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom
}

/** Whether a node's whole box is on screen. `nodeX`/`nodeY` are its layout
 *  position — the translate on its own `<g>`, already swapped for Across. */
export function nodeInView(
  nodeX: number, nodeY: number, box: { w: number; h: number }, view: View, width: number, height: number,
): boolean {
  const cx = view.x + nodeX * view.zoom
  const cy = view.y + nodeY * view.zoom
  const hw = (box.w / 2) * view.zoom
  const hh = (box.h / 2) * view.zoom
  return cx - hw >= 0 && cx + hw <= width && cy - hh >= 0 && cy + hh <= height
}

/** How far into the view a node has to sit from its ancestors' side — the top
 *  going down, the left going across — before it counts as placed. */
export const CONTEXT_SHARE = 0.35

/** Whether a node is on screen *with room for what it hangs from*. Merely in
 *  view was not enough: going down, a guess wholly visible but pressed against
 *  the top edge showed none of its ancestors, which are the reason to look. */
export function nodeWellPlaced(
  nodeX: number, nodeY: number, box: { w: number; h: number }, view: View,
  width: number, height: number, orientation: 'horizontal' | 'vertical',
): boolean {
  if (!nodeInView(nodeX, nodeY, box, view, width, height)) return false
  return orientation === 'horizontal'
    ? view.x + nodeX * view.zoom >= width * CONTEXT_SHARE
    : view.y + nodeY * view.zoom >= height * CONTEXT_SHARE
}

/** Where down the view a node is put going down: low, so its ancestors fill the
 *  space above it. */
export const DOWN_FOCUS = 0.7

/** A view that shows a node, **at the zoom the player already has**. Resetting
 *  the zoom on every guess is what made a round disorienting: you zoomed in on
 *  the part you were working through, guessed, and landed somewhere else at a
 *  different scale.
 *
 *  Going across, a guess sits in the last column, so centring it spent the right
 *  half of a phone on nothing and cut its parents off the left edge. At the
 *  right edge instead, the room goes to the ancestors it hangs from. Going down,
 *  the same reasoning puts it low (`DOWN_FOCUS`): centred or at the top, the
 *  ancestors above it were off the screen. */
export function viewOnNode(
  nodeX: number, nodeY: number, box: { w: number; h: number }, view: View,
  width: number, height: number, orientation: 'horizontal' | 'vertical',
): View {
  const z = view.zoom
  return {
    x: orientation === 'horizontal' ? width - 12 - (nodeX + box.w / 2) * z : width / 2 - nodeX * z,
    y: orientation === 'horizontal' ? height / 2 - nodeY * z : height * DOWN_FOCUS - nodeY * z,
    zoom: z,
  }
}

/** A node's label and its layout position, read off the drawn tree. */
export interface Placed { label: string; x: number; y: number }

/** A node the player was looking at: where on screen it sat, and the zoom. */
export interface Anchor { label: string; sx: number; sy: number; zoom: number }

/** The node nearest the middle of the view, and where on screen it sits.
 *
 *  "Where you were" has to be remembered as a node, not as a translate. Every
 *  guess re-lays-out the tree — a new branch pushes its neighbours aside — so
 *  the old translate, restored, shows different nodes from the ones you left. */
export function anchorAt(nodes: Placed[], view: View, width: number, height: number): Anchor | null {
  let best: Anchor | null = null
  let bestDistance = Infinity
  for (const n of nodes) {
    const sx = view.x + n.x * view.zoom
    const sy = view.y + n.y * view.zoom
    const distance = (sx - width / 2) ** 2 + (sy - height / 2) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = { label: n.label, sx, sy, zoom: view.zoom }
    }
  }
  return best
}

/** Where a remembered node is in a new layout. A guess can split a collapsed
 *  chain ("Carnivora › Laurasiatheria" becomes two boxes) or a chain can absorb
 *  a box, so after the exact label this takes the box carrying its first,
 *  deepest name, and then any box sharing one of its names. */
export function findAnchor(nodes: Placed[], label: string): Placed | null {
  const exact = nodes.find((n) => n.label === label)
  if (exact) return exact
  const parts = label.split(' › ')
  return nodes.find((n) => n.label.split(' › ').includes(parts[0]))
    ?? nodes.find((n) => n.label.split(' › ').some((p) => parts.includes(p)))
    ?? null
}

/** The view that puts a remembered node back where it sat on screen, at the
 *  zoom it was seen at. */
export function viewForAnchor(anchor: Anchor, at: Placed): View {
  return { x: anchor.sx - at.x * anchor.zoom, y: anchor.sy - at.y * anchor.zoom, zoom: anchor.zoom }
}

export function nodeToD3(node: TreeNode, parentDepth: number | null = null): D3Data {
  const self: D3Data = {
    name: node.label,
    attributes: {
      type: node.node_type,
      onPath: node.on_secret_path,
      warmth: node.lca_warmth ?? node.warmth,
      taxa: node.name ?? '',
    },
    children: node.children.map((c) => nodeToD3(c, node.depth)),
  }

  const gap = parentDepth === null ? 0 : node.depth - parentDepth
  const extra = gap > 1 ? rowsForGap(gap) - 1 : 0
  if (extra <= 0) return self

  // Thread the node onto the end of a chain of unlabelled spacers, so the
  // layout spends real distance on the ranks the collapse hid.
  let chain = self
  for (let i = 0; i < extra; i++) {
    chain = {
      name: SPACER,
      attributes: {
        type: SPACER,
        onPath: node.on_secret_path,
        warmth: node.lca_warmth ?? node.warmth,
        taxa: '',
      },
      children: [chain],
    }
  }
  return chain
}

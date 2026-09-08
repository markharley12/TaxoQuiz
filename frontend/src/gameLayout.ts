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
// The box only has to hold a thumbnail and a name: 164 leaves about 100px of
// label, which carries "Domestic cat" and ellipsises what it cannot. The height
// is untouched, because that is the touch target.
export const BOX_SIZES = {
  fine:   { w: 176, h: 40, zoom: 0.9, thumb: 26, font: 11 },
  coarse: { w: 164, h: 52, zoom: 1.0, thumb: 30, font: 13 },
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

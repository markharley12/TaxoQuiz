// Where to put a tree in its container.
//
// react-d3-tree pins the root wherever it is told and lets the rest fall off
// the edges. That is right while the tree is bigger than the view — you pan
// from the root — and wrong the rest of the time, which on a desktop is most of
// the time: a three-level explore slice sat in the top third of a 900px canvas
// with two thirds of empty paper under it, and a game tree centred on its root
// ran off the left edge, because a root is only in the middle of its subtree
// when the subtree happens to be symmetrical.
//
// So: per axis, independently, centre the content when it fits that axis and
// otherwise keep the caller's pin. A tree wider than the view still starts at
// its root and pans; a tree that fits is simply composed in its frame.
export interface Translate { x: number; y: number }

/** How many nodes is too many to measure. `getBBox` walks the whole subtree,
 *  and "expand all" can be tens of thousands of them — a tree that size does
 *  not fit any axis anyway, so the pin is the right answer regardless. */
export const FRAME_NODE_LIMIT = 2000

export function frameTree(
  host: HTMLElement,
  zoom: number,
  pin: Translate,
  nodeCount: number,
): Translate {
  if (nodeCount > FRAME_NODE_LIMIT) return pin
  const g = host.querySelector('.rd3t-g')
  if (!(g instanceof SVGGraphicsElement)) return pin

  let box: DOMRect
  try {
    // Throws in a detached or not-yet-laid-out SVG; the pin is a fine answer.
    box = g.getBBox()
  } catch {
    return pin
  }
  if (!box.width || !box.height) return pin

  // getBBox reports the group's own coordinate space, before its transform —
  // which is exactly the space `translate` is expressed in, so no unwinding.
  const { width, height } = host.getBoundingClientRect()
  return {
    x: box.width * zoom <= width ? width / 2 - (box.x + box.width / 2) * zoom : pin.x,
    y: box.height * zoom <= height ? height / 2 - (box.y + box.height / 2) * zoom : pin.y,
  }
}

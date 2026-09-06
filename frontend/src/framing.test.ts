import { beforeEach, describe, expect, it } from 'vitest'
import { FRAME_NODE_LIMIT, frameTree, type Translate } from './framing'

const PIN: Translate = { x: 111, y: 222 }

/** A host element containing an `.rd3t-g` whose getBBox is ours to decide.
 *
 * jsdom implements neither getBBox nor getBoundingClientRect with real layout,
 * so both are stubbed. That is the whole of what frameTree reads, and stubbing
 * them is what lets the interesting cases — a bbox that throws, a zero-sized
 * one, one axis fitting and not the other — be arranged at all.
 */
function host(opts: {
  view: { width: number; height: number }
  box?: { x: number; y: number; width: number; height: number } | 'throws'
  group?: 'svg' | 'div' | 'missing'
}): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({ width: opts.view.width, height: opts.view.height }) as DOMRect

  const kind = opts.group ?? 'svg'
  if (kind !== 'missing') {
    const g =
      kind === 'svg'
        ? document.createElementNS('http://www.w3.org/2000/svg', 'g')
        : document.createElement('div')
    g.setAttribute('class', 'rd3t-g')
    // jsdom's SVG elements are not instanceof SVGGraphicsElement, so the guard
    // frameTree uses would reject even a legitimate group. Borrow the real
    // prototype rather than weaken the guard.
    if (kind === 'svg') Object.setPrototypeOf(g, SVGGraphicsElement.prototype)
    if (opts.box === 'throws') {
      // Detached or not-yet-laid-out SVG. The real thing throws here.
      ;(g as SVGGraphicsElement).getBBox = () => {
        throw new Error('not rendered')
      }
    } else if (opts.box) {
      ;(g as SVGGraphicsElement).getBBox = () => opts.box as DOMRect
    }
    el.appendChild(g)
  }
  return el
}

describe('frameTree', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('centres content that fits both axes', () => {
    // A three-level explore slice in a 900px canvas used to sit in the top
    // third with two thirds of empty paper under it.
    const el = host({
      view: { width: 1000, height: 900 },
      box: { x: 0, y: 0, width: 200, height: 100 },
    })
    // centre = view/2 - (boxCentre * zoom); zoom 1 => 500 - 100, 450 - 50
    expect(frameTree(el, 1, PIN, 10)).toEqual({ x: 400, y: 400 })
  })

  it('accounts for a bbox that does not start at the origin', () => {
    // getBBox reports the group's own coordinate space, which is the space
    // `translate` is expressed in — so the offset is used directly, not unwound.
    const el = host({
      view: { width: 1000, height: 900 },
      box: { x: 100, y: 50, width: 200, height: 100 },
    })
    expect(frameTree(el, 1, PIN, 10)).toEqual({ x: 300, y: 350 })
  })

  it('scales the fit test by zoom, not raw bbox size', () => {
    // 800 wide does not fit 1000 at zoom 2, and does at zoom 1. The bug this
    // guards is comparing unscaled bbox against a scaled view.
    const box = { x: 0, y: 0, width: 800, height: 100 }
    const fits = frameTree(host({ view: { width: 1000, height: 900 }, box }), 1, PIN, 10)
    const overflows = frameTree(host({ view: { width: 1000, height: 900 }, box }), 2, PIN, 10)
    expect(fits.x).toBe(100)
    expect(overflows.x).toBe(PIN.x)
  })

  it('decides each axis independently', () => {
    // The point of the whole module: a game tree can fit vertically and run off
    // the left edge, and centring both or neither is wrong either way.
    const el = host({
      view: { width: 300, height: 900 },
      box: { x: 0, y: 0, width: 2000, height: 100 },
    })
    const framed = frameTree(el, 1, PIN, 10)
    expect(framed.x).toBe(PIN.x)     // too wide: keep the pin and pan from the root
    expect(framed.y).toBe(400)       // fits vertically: compose it
  })

  it('keeps the pin when the content overflows both axes', () => {
    const el = host({
      view: { width: 300, height: 200 },
      box: { x: 0, y: 0, width: 2000, height: 4000 },
    })
    expect(frameTree(el, 1, PIN, 10)).toEqual(PIN)
  })

  it('centres content exactly the size of the view', () => {
    // The boundary is <=, not <: a tree that exactly fills the view fits, and
    // "centred" for content that already fills its frame is no translation.
    const el = host({
      view: { width: 400, height: 200 },
      box: { x: 0, y: 0, width: 400, height: 200 },
    })
    expect(frameTree(el, 1, PIN, 10)).toEqual({ x: 0, y: 0 })
  })

  it('skips measuring above the node limit', () => {
    // getBBox walks the whole subtree, and "expand all" can be tens of
    // thousands of nodes — which do not fit any axis anyway.
    const el = host({
      view: { width: 10000, height: 10000 },
      box: { x: 0, y: 0, width: 10, height: 10 },
    })
    expect(frameTree(el, 1, PIN, FRAME_NODE_LIMIT + 1)).toEqual(PIN)
    expect(frameTree(el, 1, PIN, FRAME_NODE_LIMIT)).not.toEqual(PIN)
  })

  it('keeps the pin when the tree has not rendered yet', () => {
    expect(frameTree(host({ view: { width: 900, height: 900 }, group: 'missing' }), 1, PIN, 10))
      .toEqual(PIN)
  })

  it('keeps the pin when getBBox throws on a detached svg', () => {
    expect(frameTree(host({ view: { width: 900, height: 900 }, box: 'throws' }), 1, PIN, 10))
      .toEqual(PIN)
  })

  it('keeps the pin for an empty bbox', () => {
    // An empty tree measures 0x0, which would otherwise centre "nothing" and
    // translate the view somewhere arbitrary.
    for (const box of [
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: 100, height: 0 },
    ]) {
      expect(frameTree(host({ view: { width: 900, height: 900 }, box }), 1, PIN, 10)).toEqual(PIN)
    }
  })

  it('keeps the pin when the group is not an SVG element', () => {
    expect(frameTree(host({ view: { width: 900, height: 900 }, group: 'div' }), 1, PIN, 10))
      .toEqual(PIN)
  })
})

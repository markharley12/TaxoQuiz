import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { Box, Stack, Button, Chip, Typography, CircularProgress, Autocomplete, TextField, Breadcrumbs, Link, Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { fetchDataset, fetchExplore, fetchLineage, searchExplore, type ExploreNode, type ExploreHit } from '../api'
import { makeColorScale, makeTintScale, FALLBACK_ANCHOR_DEPTH } from '../colors'
import { CARD, TREE_LINK, FONT_DISPLAY, FONT_UI } from '../theme'
import { useSettings } from '../settings'
import { useCoarsePointer, useNarrow } from '../media'
import { frameTree } from '../framing'
import { cachedTaxonInfo, useTaxonCache } from '../taxonCache'
import { HoverPreview, NodeThumb, useHoverPreview } from './HoverPreview'
import TaxonPopup from './TaxonPopup'

type NodeDatum = CustomNodeElementProps['nodeDatum']

// How many nodes one browse request returns. Opening a node pulls its
// descendants too, so the shape below it is visible immediately and the next
// click is usually free. The server spends the budget breadth-first, so it runs
// deep through a single-child chain and stops early in a bush — see the API.
const SLICE_BUDGET = 200
const FETCH_ALL = -1

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
interface NodeSize {
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

const NODE_SIZES: Record<'fine' | 'coarse', NodeSize> = {
  fine:   { w: 170, h: 38, zoom: 0.8, info: 15, plus: 14, thumb: 26, label: 12, sub: 9.5, pad: 6, gap: 4, hgap: 40, show: 40 },
  coarse: { w: 184, h: 56, zoom: 1.0, info: 38, plus: 22, thumb: 26, label: 14, sub: 10.5, pad: 2, gap: 4, hgap: 20, show: 14 },
}

// Derived rather than written out, so the box and the gaps between boxes cannot
// drift apart — a taller box with the old row pitch overlaps its own siblings.
// The fine numbers reproduce exactly what these were before: across leaves a
// 40px connector between generations and 8px between stacked siblings; down
// leaves 10px between side-by-side siblings and 50px between rows.
/** Narrow the box until a parent and a whole child column fit side by side.
 *
 * Measured rather than assumed: the tree's container is not the viewport — the
 * app's own padding took a 390px phone down to 364, which was enough to push
 * every child box's "+" off the right edge while the arithmetic said it fit.
 * The floor stops a very narrow screen from shrinking the box into nothing;
 * below it, panning is the better answer than an unreadable node.
 */
const MIN_COARSE_W = 150

/** Gap between the root's outer edge and the edge of the view. */
const EDGE = 4

function fitWidth(s: NodeSize, containerW: number): NodeSize {
  if (!containerW) return s
  // The root does not start at zero — it is inset by EDGE, and that inset is
  // part of the budget. Leaving it out is what still clipped the child column
  // after the width was supposedly fitted.
  const fits = Math.floor((containerW - s.hgap - 2 * EDGE) / 2)
  const w = Math.max(MIN_COARSE_W, Math.min(s.w, fits))
  return w === s.w ? s : { ...s, w }
}

function spacingFor(s: NodeSize) {
  return {
    horizontal: { x: s.w + s.hgap, y: s.h + 8 },
    vertical: { x: s.w + 10, y: s.h + 50 },
  } as const
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
const EXPAND_ALL_WARN = 2000

// Opening a clade this small opens the whole thing, rather than one level at a
// time. The level-by-level dance earns its keep on a clade with hundreds
// beneath it; on a genus of three it is just extra clicks for a shape you could
// already see the whole of. Counted in species, not nodes, because that is what
// the box already tells you is down there — the rendered node count is several
// times this, since every species drags its lineage on screen with it.
const AUTO_EXPAND_SPECIES = 25


interface D3Data {
  name: string
  attributes: {
    label: string
    sub: string
    thumb: string
    depth: number
    isLeaf: boolean
    hasHidden: boolean
    collapsed: boolean
  }
  children: D3Data[]
}

/** Replace the node named `name` with `replacement`, structurally sharing the rest. */
function spliceIn(node: ExploreNode, name: string, replacement: ExploreNode): ExploreNode {
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

function subtitle(node: ExploreNode): string {
  if (node.child_count === 0) return node.scientific_name ?? node.rank
  return `${node.rank || 'clade'} · ${node.species_count.toLocaleString()} species`
}

function toD3(node: ExploreNode, expanded: Set<string>, dataset: string): D3Data {
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

function countRendered(node: D3Data): number {
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
function seedExpanded(
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

function countVisible(node: ExploreNode, expanded: Set<string>): number {
  if (!expanded.has(node.name)) return 1
  return 1 + node.children.reduce((sum, c) => sum + countVisible(c, expanded), 0)
}

function allNames(node: ExploreNode, into: Set<string> = new Set()): Set<string> {
  into.add(node.name)
  for (const c of node.children) allNames(c, into)
  return into
}

function hasTruncated(node: ExploreNode): boolean {
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
function addLoadedNames(node: ExploreNode, into: Set<string>) {
  if (node.truncated) return
  into.add(node.name)
  for (const c of node.children) addLoadedNames(c, into)
}

interface NodeBoxProps {
  nodeData: NodeDatum
  color: string
  tint: string
  size: NodeSize
  onHover: (name: string, e: React.PointerEvent<HTMLElement>) => void
  onHoverEnd: () => void
  onToggle: (name: string) => void
  onInfo: (name: string) => void
  busy: boolean
}

// Deliberately plain DOM with inline styles rather than MUI `Box`+`sx`.
//
// This is the one component that can be on screen tens of thousands of times.
// `sx` runs emotion's style pipeline per node per render, which is invisible at
// the game's scale (a few dozen nodes) and is the dominant cost at explore's.
// Everything else in the app should keep using `sx`.
function NodeBox({ nodeData, color, tint, size, onHover, onHoverEnd, onToggle, onInfo, busy }: NodeBoxProps) {
  const a = nodeData.attributes as unknown as D3Data['attributes']
  const isLeaf = a.isLeaf === true || String(a.isLeaf) === 'true'
  const hasHidden = a.hasHidden === true || String(a.hasHidden) === 'true'
  const ink = isLeaf ? color : '#fff'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        padding: size.pad,
        borderRadius: 6,
        fontFamily: FONT_UI,
        // A species is a card on paper with a coloured edge; a clade is filled
        // and carries the colour itself. Same distinction the game tree draws
        // between a guess and a shared ancestor, so a node means the same thing
        // in both places.
        background: isLeaf ? CARD : tint,
        border: isLeaf ? `1.5px solid ${color}` : '1px solid transparent',
        boxShadow: isLeaf ? '0 1px 2px rgba(44,38,32,0.10)' : '0 1px 2px rgba(44,38,32,0.14)',
        color: ink,
        cursor: 'pointer',
      }}
      data-node={nodeData.name}
      title={nodeData.name}
      onPointerEnter={(e) => onHover(nodeData.name, e)}
      onPointerLeave={onHoverEnd}
      onClick={(e) => {
        e.stopPropagation()
        // A leaf has nothing to expand, so its whole box opens the info that
        // the "i" opens elsewhere. Anything else toggles.
        if (isLeaf) onInfo(nodeData.name)
        else onToggle(nodeData.name)
      }}
    >
      {/* Info sits at the far LEFT and expand at the far RIGHT, which is the
        * whole point of the arrangement rather than a matter of taste. They
        * used to be neighbours 12px apart, so on a phone the two were one
        * target and you got whichever the finger happened to cover. Opposite
        * ends puts most of the box between them, and the box itself toggles —
        * so the only way to open an article is to mean it, and every miss
        * lands on "expand", which is both the commoner intent and the one you
        * can undo by tapping again. */}
      <span
        role="button"
        aria-label={`Information about ${nodeData.name}`}
        onClick={(e) => { e.stopPropagation(); onInfo(nodeData.name) }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: size.info, flexShrink: 0, alignSelf: 'stretch', cursor: 'pointer',
        }}
      >
        <span style={{
          fontSize: size.info > 20 ? 13 : 10, fontWeight: 700, fontStyle: 'italic',
          width: size.info > 20 ? 20 : 15, height: size.info > 20 ? 20 : 15,
          lineHeight: size.info > 20 ? '19px' : '14px', textAlign: 'center',
          borderRadius: '50%', border: `1px solid ${isLeaf ? color : 'rgba(255,255,255,0.7)'}`,
        }}>i</span>
      </span>

      <NodeThumb src={a.thumb} size={size.thumb} />

      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.15, alignSelf: 'center', paddingLeft: size.gap }}>
        <div style={{
          fontSize: size.label, fontWeight: 600, fontFamily: FONT_DISPLAY,
          letterSpacing: '0.005em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {a.label}
        </div>
        <div style={{
          fontSize: size.sub, opacity: 0.78, letterSpacing: '0.02em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {a.sub}
        </div>
      </div>

      {/* Not a button: it does exactly what the box around it does, so making
        * it one would only add a way to miss. It is a sign, sized to be read
        * and to say where the tap that follows should land. */}
      {busy || hasHidden ? (
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: size.plus, flexShrink: 0, alignSelf: 'stretch',
          fontSize: size.plus > 20 ? 20 : 13, fontWeight: 700, opacity: 0.9,
        }}>
          {busy ? '…' : '+'}
        </span>
      ) : null}
    </div>
  )
}

export default function ExploreTree() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { colorScheme, orientation, dataset } = useSettings()
  const coarse = useCoarsePointer()
  const narrow = useNarrow()
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const size = useMemo(() => {
    const base = coarse ? NODE_SIZES.coarse : NODE_SIZES.fine
    // Only touch sizing has to fit two columns; the mouse box is small enough
    // that it always does, and shrinking it on a narrow window would be a
    // change nobody asked for.
    return coarse ? fitWidth(base, viewport.w) : base
  }, [coarse, viewport.w])
  const spacing = spacingFor(size)
  // A phone shows a parent and one child column; opening deeper than that puts
  // the result off the right edge. See seedExpanded.
  const seedLevels = coarse ? 1 : Infinity
  useTaxonCache()   // a lookup landing repaints the thumbnails
  const [tree, setTree] = useState<ExploreNode | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [path, setPath] = useState<string[]>([])
  const [popup, setPopup] = useState<string | null>(null)
  const [anchorDepth, setAnchorDepth] = useState(FALLBACK_ANCHOR_DEPTH)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [options, setOptions] = useState<ExploreHit[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Bumped on load, jump and re-root — the three things that should re-centre
  // the view. Deliberately not bumped on expand, which would yank the view out
  // from under the click that caused it.
  const [viewKey, setViewKey] = useState(0)
  // Set by a jump, cleared once the view has been moved onto that node.
  const [focusName, setFocusName] = useState<string | null>(null)
  const [confirmExpand, setConfirmExpand] = useState(false)

  useEffect(() => {
    fetchDataset(dataset).then((d) => setAnchorDepth(d.color_anchor_depth)).catch(() => {})
    fetchExplore(undefined, SLICE_BUDGET, dataset)
      .then((t) => {
        setTree(t)
        setPath([t.name])
        setExpanded(seedExpanded(t, size.show, [], seedLevels))
        setViewKey((k) => k + 1)
      })
      .catch(() => setError('Could not load the tree'))
    // `size.show` is a real dependency and is listed as one. Re-running on it
    // costs a refetch and drops what the reader had open, which sounds bad and
    // is not: the pointer kind changes only when a tablet is docked or devtools
    // toggles emulation, and when it does, the whole first screen wants
    // re-seeding for the new size anyway. Leaving it out would mean a phone
    // that started life reporting a mouse keeps a 40-node opening screen for
    // the rest of the session.
  }, [dataset, size.show, seedLevels])

  // The container's own size, watched rather than read once: rotating a phone
  // changes it, and a box fitted to portrait is wrong in landscape.
  // Counted here rather than beside the JSX, because the framing effect below
  // needs it and the early returns further down would put it out of reach.
  const rendered = tree ? countRendered(toD3(tree, expanded, dataset)) : 0
  const hasTree = tree !== null
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      setViewport((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // `hasTree`, not `[]`: until the tree lands this component renders a
    // spinner and the container ref is still null, so a mount-only effect
    // measured nothing and every box kept its unfitted width.
  }, [hasTree])

  useEffect(() => {
    if (!containerRef.current) return
    const host = containerRef.current
    const { width, height } = host.getBoundingClientRect()
    const pin = orientation === 'horizontal'
      ? { x: size.w / 2 + EDGE, y: height / 2 }
      : { x: width / 2, y: size.h / 2 + 40 }
    setTranslate(pin)
    // A phone keeps the pin: `fitWidth` sized the box so the root and one child
    // column fill the view exactly, and centring content that already fills the
    // frame only shifts it off the left edge it was fitted to.
    if (coarse) return
    // Deferred, because react-d3-tree lays its nodes out in its own commit and
    // there is nothing to measure yet in this one.
    const raf = requestAnimationFrame(() => setTranslate(frameTree(host, size.zoom, pin, rendered)))
    return () => cancelAnimationFrame(raf)
  }, [orientation, viewKey, size.w, size.h, size.zoom, viewport.w, viewport.h, coarse, rendered])

  // Put the jumped-to node in the middle of the view.
  //
  // Read back from the DOM rather than computed, because only react-d3-tree
  // knows where it put things: a node's x follows from its depth, but its y
  // falls out of the whole layout's leaf ordering, which is not something this
  // component can reproduce without duplicating the library. Without this a
  // jump to Homo sapiens expanded the right lineage and left you looking at
  // Animalia, 59 levels away.
  useEffect(() => {
    if (!focusName || !containerRef.current) return
    const el = containerRef.current.querySelector(`[data-node="${CSS.escape(focusName)}"]`)
    const g = el?.closest('g')
    const m = g?.getAttribute('transform')?.match(/translate\(([-\d.]+)[, ]+([-\d.]+)\)/)
    if (m) {
      const { width, height } = containerRef.current.getBoundingClientRect()
      setTranslate({
        x: width / 2 - Number(m[1]) * size.zoom,
        y: height / 2 - Number(m[2]) * size.zoom,
      })
    }
    setFocusName(null)
  }, [focusName, tree, size.zoom])

  // Search-as-you-type over every node, not just species.
  useEffect(() => {
    // Drop the previous query's hits immediately rather than leaving them
    // under a query that no longer asks for them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (query.trim().length < 2) { setOptions([]); return }
    let cancelled = false
    const id = setTimeout(() => {
      searchExplore(query, 20, dataset)
        .then((hits) => { if (!cancelled) setOptions(hits) })
        .catch(() => {})
    }, 180)
    return () => { cancelled = true; clearTimeout(id) }
  }, [query, dataset])

  const { preview, startHover, cancelHover } = useHoverPreview(containerRef, dataset)

  const toggle = useCallback(async (name: string) => {
    if (!tree) return
    if (expanded.has(name)) {
      setExpanded((prev) => { const next = new Set(prev); next.delete(name); return next })
      return
    }
    // A node the server truncated has to be fetched before it can open. One
    // whose children are already in memory opens with no request at all, which
    // is the point of fetching more than is shown.
    let node = findNode(tree, name)
    // Small clades open whole, so fetch the rest of one if any of it is still
    // server-side. It is a single request for a subtree of at most a few nodes,
    // and without it "expand all within" would stop at the first truncation.
    const small = node !== null && node.species_count < AUTO_EXPAND_SPECIES
    if (node && (node.truncated || (small && hasTruncated(node)))) {
      setBusy((prev) => new Set(prev).add(name))
      try {
        const fetched = await fetchExplore(name, SLICE_BUDGET, dataset)
        setTree((prev) => (prev ? spliceIn(prev, name, fetched) : prev))
        node = fetched
      } catch {
        setError(`Could not load ${name}`)
        setBusy((prev) => { const next = new Set(prev); next.delete(name); return next })
        return
      }
      setBusy((prev) => { const next = new Set(prev); next.delete(name); return next })
    }
    setExpanded((prev) => {
      const next = new Set(prev).add(name)
      if (small && node) addLoadedNames(node, next)
      return next
    })
  }, [tree, expanded, dataset])

  async function jumpTo(name: string) {
    setPending(true)
    setError(null)
    try {
      const { path: chain, tree: spine } = await fetchLineage(name, dataset)
      setTree(spine)
      setPath(chain)
      // The spine stays open regardless of budget, or you would land on a
      // search result that is not on screen.
      setExpanded(seedExpanded(spine, size.show, chain, seedLevels))
      setFocusName(name)
    } catch {
      setError(`Could not jump to ${name}`)
    } finally {
      setPending(false)
    }
  }

  async function reroot(name: string | null) {
    setPending(true)
    setError(null)
    try {
      const t = await fetchExplore(name ?? undefined, SLICE_BUDGET, dataset)
      setTree(t)
      setPath(name ? path.slice(0, path.indexOf(name) + 1) : [t.name])
      setExpanded(seedExpanded(t, size.show, [], seedLevels))

      setViewKey((k) => k + 1)    } catch {
      setError('Could not load that subtree')
    } finally {
      setPending(false)
    }
  }

  async function expandAll(confirmed = false) {
    if (!tree) return
    if (!confirmed && tree.node_count > EXPAND_ALL_WARN) {
      setConfirmExpand(true)
      return
    }
    setConfirmExpand(false)
    setPending(true)
    setError(null)
    const started = performance.now()
    try {
      const full = await fetchExplore(tree.name, FETCH_ALL, dataset)
      setTree(full)
      setExpanded(allNames(full))
      setViewKey((k) => k + 1)
      // Logged rather than shown: it is the answer to "how bad is this really?",
      // which is a question you ask once while building and never again.
      console.info(`expand all: ${full.node_count} nodes, fetched in ${Math.round(performance.now() - started)}ms`)
    } catch {
      setError('Could not load the full subtree')
    } finally {
      setPending(false)
    }
  }

  if (error && !tree) return <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>
  if (!tree) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress /></Box>

  const d3Data = toD3(tree, expanded, dataset)
  const colorForDepth = makeColorScale(anchorDepth, colorScheme)
  const tintForDepth = makeTintScale(anchorDepth, colorScheme)

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1, md: 2 }} sx={{ mb: { xs: 1, md: 2 }, alignItems: { md: 'center' } }}>
        <Autocomplete
          size="small"
          sx={{ width: { xs: '100%', md: 340 } }}
          options={options}
          filterOptions={(x) => x}
          getOptionLabel={(o) => o.common_name || o.name}
          isOptionEqualToValue={(a, b) => a.name === b.name}
          onInputChange={(_, v) => setQuery(v)}
          onChange={(_, v) => { if (v) jumpTo(v.name) }}
          noOptionsText={query.trim().length < 2 ? 'Type to search' : 'No matches'}
          renderOption={(props, o) => (
            <li {...props} key={o.name}>
              <Stack sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap>{o.common_name || o.name}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {o.common_name ? `${o.name} · ` : ''}{o.rank || 'clade'}
                  {!o.is_species && ` · ${o.species_count.toLocaleString()} species`}
                </Typography>
              </Stack>
            </li>
          )}
          renderInput={(params) => <TextField {...params} label="Go to any taxon or species" />}
        />
        {/* One row rather than three stacked ones. Column-stacking every
          * control put the search box, two full-width buttons and a chip above
          * the tree, which on a 390x844 phone left the tree starting 615px
          * down — 73% of the screen spent on chrome before any taxonomy. These
          * three are small; they fit side by side at any width. */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" onClick={() => expandAll()} disabled={pending}>
            Expand all{narrow ? '' : ` of ${tree.name}`}
          </Button>
          <Button size="small" onClick={() => reroot(null)} disabled={pending}>
            Back to {path[0]}
          </Button>
          <Chip size="small" label={`${rendered.toLocaleString()} shown`} />
          {pending && <CircularProgress size={18} />}
        </Stack>
      </Stack>

      {path.length > 1 && (
        <Breadcrumbs sx={{ mb: 1 }} maxItems={6}>
          {path.map((name, i) => (
            <Link
              key={name}
              component="button"
              variant="body2"
              underline="hover"
              onClick={() => reroot(name)}
              sx={{ fontWeight: i === path.length - 1 ? 600 : 400 }}
            >
              {name}
            </Link>
          ))}
        </Breadcrumbs>
      )}

      {error && <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box
        ref={containerRef}
        sx={{
          position: 'relative', width: '100%',
          // dvh, not vh: on a phone `vh` is the height with the browser's
          // toolbars *hidden*, so a vh-sized box is taller than the screen the
          // moment they are showing, and the page scrolls behind the tree.
          // The subtraction is smaller on xs because the toolbar above is now
          // two rows rather than four.
          height: { xs: 'calc(100dvh - 190px)', sm: 'calc(100vh - 260px)' },
          minHeight: { xs: 320, sm: 400 },
          // The tree pans itself, so the browser must not also try to scroll or
          // zoom the page from a drag that starts here — otherwise a pan either
          // scrolls the page or does nothing while the two fight.
          touchAction: 'none',
          overscrollBehavior: 'contain',
          border: 1, borderColor: 'divider', borderRadius: 3,
          bgcolor: CARD,
          overflow: 'hidden',
          // Near-black hairlines from the library. On a root fan-out of forty
          // nodes the links are most of the ink on screen and read as a
          // scribble across it rather than as the joins between the boxes.
          '& .rd3t-link': { stroke: TREE_LINK, strokeWidth: 1.25 },
        }}
      >
        <HoverPreview preview={preview} dataset={dataset} />
        <Tree
          data={d3Data}
          orientation={orientation}
          pathFunc="diagonal"
          translate={translate}
          nodeSize={spacing[orientation]}
          separation={{ siblings: 1, nonSiblings: 1.25 }}
          zoom={size.zoom}
          renderCustomNodeElement={({ nodeDatum }) => (
            <foreignObject x={-size.w / 2} y={-size.h / 2} width={size.w} height={size.h}>
              <NodeBox
                nodeData={nodeDatum}
                size={size}
                color={colorForDepth(Number(nodeDatum.attributes?.depth ?? 0))}
                tint={tintForDepth(Number(nodeDatum.attributes?.depth ?? 0))}
                onHover={startHover}
                onHoverEnd={cancelHover}
                onToggle={toggle}
                onInfo={setPopup}
                busy={busy.has(nodeDatum.name)}
              />
            </foreignObject>
          )}
        />
      </Box>

      <Dialog open={confirmExpand} onClose={() => setConfirmExpand(false)}>
        <DialogTitle>Expand all of {tree.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            That is <strong>{tree.node_count.toLocaleString()} nodes</strong> drawn at once.
            For scale, 2,000 nodes takes about five seconds to draw and pans with a
            visible stutter; 27,000 takes around three minutes, after which a single
            drag freezes the page for fifteen seconds.
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>
            Nothing is lost either way — reloading starts over. But expanding a smaller
            group is usually the better move: search for one, click it in the trail
            above the tree to make it the root, then expand that.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmExpand(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={() => expandAll(true)}>
            Expand anyway
          </Button>
        </DialogActions>
      </Dialog>

      {popup && <TaxonPopup names={[popup]} onClose={() => setPopup(null)} />}
    </>
  )
}

function findNode(node: ExploreNode, name: string): ExploreNode | null {
  if (node.name === name) return node
  for (const c of node.children) {
    const hit = findNode(c, name)
    if (hit) return hit
  }
  return null
}

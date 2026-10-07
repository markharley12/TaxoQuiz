import { useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react'
import { Box, Stack, Button, Chip, Typography, CircularProgress, Autocomplete, TextField, Breadcrumbs, Link, Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { fetchExplore, fetchLineage, searchExplore, type ExploreNode, type ExploreHit } from '../api'
import { makeColorScale, makeTintScale } from '../colors'
import { CARD, INK, INK_MUTED, LINE, TREE_BLEED, TREE_LINK, FONT_DISPLAY, FONT_UI } from '../theme'
import { useSettings } from '../settings'
import { useCoarsePointer, useNarrow } from '../media'
import { frameTree, placedNodes } from '../framing'
import { anchorAt, findAnchor, sameView, viewForAnchor, type Anchor, type View } from '../gameLayout'
import { useTaxonCache } from '../taxonCache'
import {
  addLoadedNames, allNames, AUTO_EXPAND_SPECIES, countRendered, EXPAND_ALL_WARN,
  EDGE, FETCH_ALL, fitWidth, hasTruncated, NODE_SIZES, seedExpanded, separationFor, SLICE_BUDGET, spacingFor,
  spliceIn, toD3, viewOnTapped, type D3Data, type NodeSize,
} from '../exploreLayout'
import { HoverPreview, NodeThumb, useHoverPreview } from './HoverPreview'
import TaxonPopup from './TaxonPopup'
import { displayName } from '../names'
import { useCloseOnBack } from '../backButton'

type NodeDatum = CustomNodeElementProps['nodeDatum']

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
  // Ink on paper for every node now, rather than white on a filled block. See
  // the note on the background below.
  const ink = INK

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
        // A species is a card on paper with a coloured edge; a clade is a card
        // with a spine of its colour down the leading edge. Same distinction
        // the game tree draws between a guess and a shared ancestor, so a node
        // means the same thing in both places.
        //
        // Clades used to be *filled*. Depth changes slowly near the root, so
        // the opening screen — Animalia and two ranks under it — came out as
        // sixteen degrees of hue across thirty-odd nodes: one flat brick-red
        // field, with the names set in small white type on top of it. The spine
        // carries exactly the same colour while the label goes back to ink on
        // paper, which is the only reason any of this is on screen.
        background: isLeaf ? CARD : tint,
        border: `1px solid ${LINE}`,
        borderLeft: `${isLeaf ? 1.5 : 5}px solid ${color}`,
        boxShadow: '0 1px 2px rgba(44,38,32,0.10)',
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
          borderRadius: '50%', border: `1px solid ${isLeaf ? color : INK_MUTED}`,
        }}>i</span>
      </span>

      <NodeThumb src={a.thumb} size={size.thumb} />

      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.15, alignSelf: 'center', paddingLeft: size.gap }}>
        <div style={{
          fontSize: size.label, fontWeight: 600, fontFamily: FONT_DISPLAY,
          letterSpacing: '0.005em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {displayName(a.label)}
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
  // Where the tree is told to be (`shown`) and where it actually is (`actual`),
  // which part the moment the reader pans or pinches: react-d3-tree hands the
  // gesture to d3 and reports it only through `onUpdate`. Every move made for
  // the reader starts from `actual`, at the zoom they chose — the library resets
  // its zoom whenever it is handed a new position. Same scheme as GameTree.
  const [shown, setShown] = useState<View>({ x: 0, y: 0, zoom: size.zoom })
  const shownRef = useRef(shown)
  const actual = useRef(shown)
  // The node just tapped open or shut, and what the reader was looking at
  // before, found in the layout as it was. Read once the new layout is drawn.
  const tapped = useRef<{ name: string; before: Anchor | null } | null>(null)
  // Where ↩ Back returns to: a node and where on screen it sat, not a
  // translate, because the tap that moved the view also re-laid the tree out.
  // Mirrored in a ref for onUpdate, which d3 calls with whatever callback was
  // current when it bound. The same scheme as the game's shortcuts.
  const [back, setBack] = useState<Anchor | null>(null)
  const backRef = useRef(back)
  const setBackState = useCallback((next: Anchor | null) => {
    backRef.current = next
    setBack(next)
  }, [])
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
  useCloseOnBack(confirmExpand, () => setConfirmExpand(false))

  // The library re-applies a position only when the props change, so moving to
  // exactly the last position told, after the reader has panned away from it,
  // would do nothing. A hundredth of a pixel makes it a change.
  const moveTo = useCallback((next: View) => {
    const target = sameView(next, shownRef.current) ? { ...next, x: next.x + 0.01 } : next
    shownRef.current = target
    actual.current = target
    setShown(target)
  }, [])

  const onUpdate = useCallback(({ translate, zoom }: { translate: { x: number; y: number }; zoom: number }) => {
    const reported = { x: translate.x, y: translate.y, zoom }
    // After every re-render the library also reports its *props* position;
    // taking that would overwrite where the reader really is.
    if (sameView(reported, shownRef.current)) return
    actual.current = reported
    // A real pan or pinch: where the reader is now is where they are.
    if (backRef.current) setBackState(null)
  }, [setBackState])

  useEffect(() => {
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
    setBackState(null)
    moveTo({ ...pin, zoom: size.zoom })
    // A phone keeps the pin: `fitWidth` sized the box so the root and one child
    // column fill the view exactly, and centring content that already fills the
    // frame only shifts it off the left edge it was fitted to.
    if (coarse) return
    // Deferred, because react-d3-tree lays its nodes out in its own commit and
    // there is nothing to measure yet in this one.
    const raf = requestAnimationFrame(() => moveTo({ ...frameTree(host, size.zoom, pin, rendered), zoom: size.zoom }))
    return () => cancelAnimationFrame(raf)
    // `rendered` is read, not depended on. It was a dependency until Oct 2026,
    // which re-placed the tree on every expand and collapse — back to the pin
    // and the default zoom, then re-centred a frame later — so the view jumped
    // away from the node just tapped, by hundreds of pixels on a collapse.
  }, [orientation, viewKey, size.w, size.h, size.zoom, viewport.w, viewport.h, coarse, moveTo, setBackState]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const zoom = actual.current.zoom
      moveTo({ x: width / 2 - Number(m[1]) * zoom, y: height / 2 - Number(m[2]) * zoom, zoom })
    }
    setBackState(null)
    setFocusName(null)
  }, [focusName, tree, moveTo, setBackState])

  // Centre the view on the node just tapped open or shut — see viewOnTapped.
  //
  // A layout effect, because react-d3-tree has already drawn the new layout by
  // now (it lays out in render) and the move must land before the browser
  // paints, or the reader sees the re-laid tree in the old place for a frame.
  useLayoutEffect(() => {
    const host = containerRef.current
    const t = tapped.current
    if (!host || !t) return
    tapped.current = null
    const nodes = placedNodes(host)
    const at = nodes.find((n) => n.label === t.name)
    if (!at) return
    const kids = new Set(expanded.has(t.name) && tree ? findNode(tree, t.name)?.children.map((c) => c.name) : [])
    const { width, height } = host.getBoundingClientRect()
    moveTo(viewOnTapped(at, nodes.filter((n) => kids.has(n.label)), size, actual.current, width, height, orientation))
    setBackState(t.before)
  }, [tree, expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  function goBack() {
    const host = containerRef.current
    const remembered = backRef.current
    setBackState(null)
    if (!host || !remembered) return
    const at = findAnchor(placedNodes(host), remembered.label)
    if (at) moveTo(viewForAnchor(remembered, at))
  }

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

  // Note what the reader is looking at before a tap re-lays the tree out, for
  // ↩ Back, and which node to centre once it has.
  const noteTap = useCallback((name: string) => {
    const host = containerRef.current
    if (!host) return
    const { width, height } = host.getBoundingClientRect()
    tapped.current = { name, before: anchorAt(placedNodes(host), actual.current, width, height) }
  }, [])

  const toggle = useCallback(async (name: string) => {
    if (!tree) return
    if (expanded.has(name)) {
      noteTap(name)
      setExpanded((prev) => { const next = new Set(prev); next.delete(name); return next })
      return
    }
    // A node the server truncated has to be fetched before it can open. One
    // whose children are already in memory opens with no request at all, which
    // is the point of fetching more than is shown.
    let node = findNode(tree, name)
    // Small clades open whole, so fetch the rest of one if any of it is still
    // server-side — all of it, not a budget's worth. Under AUTO_EXPAND_SPECIES
    // a clade is a few hundred nodes at most (244 on the Full dataset), past
    // SLICE_BUDGET, and a budgeted fetch would open it whole down to wherever
    // the budget ran out and stop there.
    const small = node !== null && node.species_count < AUTO_EXPAND_SPECIES
    if (node && (node.truncated || (small && hasTruncated(node)))) {
      setBusy((prev) => new Set(prev).add(name))
      try {
        const fetched = await fetchExplore(name, small ? FETCH_ALL : SLICE_BUDGET, dataset)
        setTree((prev) => (prev ? spliceIn(prev, name, fetched) : prev))
        node = fetched
      } catch {
        setError(`Could not load ${name}`)
        setBusy((prev) => { const next = new Set(prev); next.delete(name); return next })
        return
      }
      setBusy((prev) => { const next = new Set(prev); next.delete(name); return next })
    }
    // Measured now rather than at the tap: the reader may have panned while
    // the fetch was out.
    noteTap(name)
    setExpanded((prev) => {
      const next = new Set(prev).add(name)
      if (small && node) addLoadedNames(node, next)
      return next
    })
  }, [tree, expanded, dataset, noteTap])

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
  // No dataset anchor: each node carries its own rank position. See colors.ts.
  const colorFor = makeColorScale(colorScheme)
  const tintFor = makeTintScale(colorScheme)

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1, md: 2 }} sx={{ mb: { xs: 1, md: 2 }, alignItems: { md: 'center' } }}>
        <Autocomplete
          size="small"
          sx={{ width: { xs: '100%', md: 340 } }}
          options={options}
          filterOptions={(x) => x}
          getOptionLabel={(o) => displayName(o.common_name || o.name)}
          isOptionEqualToValue={(a, b) => a.name === b.name}
          onInputChange={(_, v) => setQuery(v)}
          onChange={(_, v) => { if (v) jumpTo(v.name) }}
          noOptionsText={query.trim().length < 2 ? 'Type to search' : 'No matches'}
          renderOption={(props, o) => (
            <li {...props} key={o.name}>
              <Stack sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap>{displayName(o.common_name || o.name)}</Typography>
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
          position: 'relative',
          // Whatever the page leaves, out to just short of the window: App lays
          // explore out as a 100dvh column, as it does the game. This was
          // `calc(100vh - 260px)`, a guess at the controls above that left a
          // strip of empty page below the tree and a margin round it.
          flex: '1 0 0', ...TREE_BLEED,
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
        {/* Top left, where the game keeps Newest, which turns into Back the
          * same way. Here there is no jump to offer until a tap has moved the
          * view, so the button only exists while there is somewhere to go back to. */}
        {back && (
          <Button
            size="small" variant="contained" disableElevation
            aria-label="Back to where you were"
            onClick={goBack}
            sx={{ position: 'absolute', top: 8, left: 8, zIndex: 2, minHeight: coarse ? 40 : undefined }}
          >
            ↩ Back
          </Button>
        )}
        <Tree
          data={d3Data}
          orientation={orientation}
          pathFunc="diagonal"
          translate={{ x: shown.x, y: shown.y }}
          nodeSize={spacing[orientation]}
          separation={separationFor(size, orientation)}
          zoom={shown.zoom}
          onUpdate={onUpdate}
          renderCustomNodeElement={({ nodeDatum }) => (
            <foreignObject x={-size.w / 2} y={-size.h / 2} width={size.w} height={size.h}>
              <NodeBox
                nodeData={nodeDatum}
                size={size}
                color={colorFor(Number(nodeDatum.attributes?.warmth ?? 0))}
                tint={tintFor(Number(nodeDatum.attributes?.warmth ?? 0))}
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

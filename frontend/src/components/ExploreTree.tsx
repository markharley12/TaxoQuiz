import { useRef, useEffect, useState, useCallback } from 'react'
import { Box, Stack, Button, Chip, Typography, CircularProgress, Autocomplete, TextField, Breadcrumbs, Link, Alert, ToggleButton, ToggleButtonGroup, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { fetchDataset, fetchExplore, fetchLineage, searchExplore, type ExploreNode, type ExploreHit } from '../api'
import { makeColorScale, FALLBACK_ANCHOR_DEPTH } from '../colors'
import TaxonPopup from './TaxonPopup'

type NodeDatum = CustomNodeElementProps['nodeDatum']

// How many nodes one browse request returns. Opening a node pulls its
// descendants too, so the shape below it is visible immediately and the next
// click is usually free. The server spends the budget breadth-first, so it runs
// deep through a single-child chain and stops early in a bush — see the API.
const SLICE_BUDGET = 200
const FETCH_ALL = -1

// How many nodes are *shown* when a view first opens. Deliberately much smaller
// than the fetch budget, and a separate number from it: fetching is about round
// trips, showing is about legibility, and conflating them gets both wrong.
// Opening the root with all 200 fetched nodes expanded produced a tree ~7000px
// tall in which the root's own children were off-screen. Fetching 200 and
// showing 40 means the first screen reads, and the next several clicks expand
// from memory with no request at all.
const DISPLAY_BUDGET = 40

// Shared by the <Tree> and by the jump-centring maths, which has to undo it to
// convert layout coordinates into on-screen ones.
const ZOOM = 0.8

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

interface D3Data {
  name: string
  attributes: {
    label: string
    sub: string
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

function toD3(node: ExploreNode, expanded: Set<string>): D3Data {
  const isOpen = expanded.has(node.name)
  const isLeaf = node.child_count === 0
  return {
    name: node.name,
    attributes: {
      label: node.common_name ?? node.name,
      sub: subtitle(node),
      depth: node.depth,
      isLeaf,
      // Something is hidden below this node: either the server did not send it,
      // or the user folded it away. Both get the same affordance, because from
      // the reader's side they are the same thing — there is more down there.
      hasHidden: !isLeaf && !isOpen,
      collapsed: !isOpen,
    },
    children: isOpen ? node.children.map((c) => toD3(c, expanded)) : [],
  }
}

function countRendered(node: D3Data): number {
  return 1 + node.children.reduce((sum, c) => sum + countRendered(c), 0)
}

/** Names to open so that roughly `budget` nodes are visible, breadth-first.
 *
 * `keep` is opened regardless of budget: it is the lineage spine after a jump,
 * which must stay open or the thing you jumped to is not on screen.
 */
function seedExpanded(root: ExploreNode, budget: number, keep: string[] = []): Set<string> {
  const expanded = new Set<string>(keep)
  let shown = countVisible(root, expanded)
  let frontier = [root]
  while (frontier.length) {
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

interface NodeBoxProps {
  nodeData: NodeDatum
  color: string
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
function NodeBox({ nodeData, color, onToggle, onInfo, busy }: NodeBoxProps) {
  const a = nodeData.attributes as unknown as D3Data['attributes']
  const isLeaf = a.isLeaf === true || String(a.isLeaf) === 'true'
  const hasHidden = a.hasHidden === true || String(a.hasHidden) === 'true'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        padding: '0 8px',
        borderRadius: 4,
        fontFamily: 'Roboto, Helvetica, Arial, sans-serif',
        background: isLeaf ? '#fff' : color,
        border: isLeaf ? `2px solid ${color}` : 'none',
        color: isLeaf ? color : '#fff',
        cursor: 'pointer',
      }}
      data-node={nodeData.name}
      title={nodeData.name}
      onClick={(e) => {
        e.stopPropagation()
        // A leaf has nothing to expand, so its whole box opens the info that
        // the "i" opens elsewhere. Anything else toggles.
        if (isLeaf) onInfo(nodeData.name)
        else onToggle(nodeData.name)
      }}
    >
      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.15 }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.label}
        </div>
        <div style={{ fontSize: 9.5, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.sub}
        </div>
      </div>
      {busy ? (
        <span style={{ fontSize: 10, opacity: 0.9 }}>…</span>
      ) : hasHidden ? (
        <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.9 }}>+</span>
      ) : null}
      <span
          role="button"
          aria-label={`Information about ${nodeData.name}`}
          onClick={(e) => { e.stopPropagation(); onInfo(nodeData.name) }}
          style={{
            fontSize: 10, fontWeight: 700, fontStyle: 'italic', cursor: 'pointer',
            width: 15, height: 15, lineHeight: '15px', textAlign: 'center', flexShrink: 0,
            borderRadius: '50%', border: `1px solid ${isLeaf ? color : 'rgba(255,255,255,0.7)'}`,
          }}
        >
          i
        </span>
    </div>
  )
}

export default function ExploreTree() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tree, setTree] = useState<ExploreNode | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [path, setPath] = useState<string[]>([])
  const [popup, setPopup] = useState<string | null>(null)
  const [anchorDepth, setAnchorDepth] = useState(FALLBACK_ANCHOR_DEPTH)
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('horizontal')
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
    fetchDataset().then((d) => setAnchorDepth(d.color_anchor_depth)).catch(() => {})
    fetchExplore(undefined, SLICE_BUDGET)
      .then((t) => {
        setTree(t)
        setPath([t.name])
        setExpanded(seedExpanded(t, DISPLAY_BUDGET))
        setViewKey((k) => k + 1)
      })
      .catch(() => setError('Could not load the tree'))
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const { width, height } = containerRef.current.getBoundingClientRect()
    setTranslate(orientation === 'horizontal' ? { x: 140, y: height / 2 } : { x: width / 2, y: 70 })
  }, [orientation, viewKey])

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
        x: width / 2 - Number(m[1]) * ZOOM,
        y: height / 2 - Number(m[2]) * ZOOM,
      })
    }
    setFocusName(null)
  }, [focusName, tree])

  // Search-as-you-type over every node, not just species.
  useEffect(() => {
    if (query.trim().length < 2) { setOptions([]); return }
    let cancelled = false
    const id = setTimeout(() => {
      searchExplore(query, 20)
        .then((hits) => { if (!cancelled) setOptions(hits) })
        .catch(() => {})
    }, 180)
    return () => { cancelled = true; clearTimeout(id) }
  }, [query])

  const toggle = useCallback(async (name: string) => {
    if (!tree) return
    if (expanded.has(name)) {
      setExpanded((prev) => { const next = new Set(prev); next.delete(name); return next })
      return
    }
    // A node the server truncated has to be fetched before it can open. One
    // whose children are already in memory opens with no request at all, which
    // is the point of fetching more than is shown.
    const target = findNode(tree, name)
    if (target && target.truncated) {
      setBusy((prev) => new Set(prev).add(name))
      try {
        const fetched = await fetchExplore(name, SLICE_BUDGET)
        setTree((prev) => (prev ? spliceIn(prev, name, fetched) : prev))
      } catch {
        setError(`Could not load ${name}`)
        setBusy((prev) => { const next = new Set(prev); next.delete(name); return next })
        return
      }
      setBusy((prev) => { const next = new Set(prev); next.delete(name); return next })
    }
    setExpanded((prev) => new Set(prev).add(name))
  }, [tree, expanded])

  async function jumpTo(name: string) {
    setPending(true)
    setError(null)
    try {
      const { path: chain, tree: spine } = await fetchLineage(name)
      setTree(spine)
      setPath(chain)
      // The spine stays open regardless of budget, or you would land on a
      // search result that is not on screen.
      setExpanded(seedExpanded(spine, DISPLAY_BUDGET, chain))
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
      const t = await fetchExplore(name ?? undefined, SLICE_BUDGET)
      setTree(t)
      setPath(name ? path.slice(0, path.indexOf(name) + 1) : [t.name])
      setExpanded(seedExpanded(t, DISPLAY_BUDGET))

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
      const full = await fetchExplore(tree.name, FETCH_ALL)
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

  const d3Data = toD3(tree, expanded)
  const rendered = countRendered(d3Data)
  const colorForDepth = makeColorScale(anchorDepth)

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { md: 'center' } }}>
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
        <Button size="small" variant="outlined" onClick={() => expandAll()} disabled={pending}>
          Expand all of {tree.name}
        </Button>
        <Button size="small" onClick={() => reroot(null)} disabled={pending}>
          Back to {path[0]}
        </Button>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={orientation}
          onChange={(_, v) => v && setOrientation(v)}
        >
          <ToggleButton value="horizontal">Across</ToggleButton>
          <ToggleButton value="vertical">Down</ToggleButton>
        </ToggleButtonGroup>
        <Chip size="small" label={`${rendered.toLocaleString()} shown`} />
        {pending && <CircularProgress size={18} />}
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
        sx={{ width: '100%', height: 'calc(100vh - 260px)', minHeight: 400, border: 1, borderColor: 'divider', borderRadius: 2 }}
      >
        <Tree
          data={d3Data}
          orientation={orientation}
          pathFunc="diagonal"
          translate={translate}
          nodeSize={orientation === 'horizontal' ? { x: 260, y: 46 } : { x: 210, y: 88 }}
          separation={{ siblings: 1, nonSiblings: 1.25 }}
          zoom={ZOOM}
          renderCustomNodeElement={({ nodeDatum }) => (
            <foreignObject x={-105} y={-19} width={210} height={38}>
              <NodeBox
                nodeData={nodeDatum}
                color={colorForDepth(Number(nodeDatum.attributes?.depth ?? 0))}
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

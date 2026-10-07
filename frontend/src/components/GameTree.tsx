import { useCallback, useRef, useEffect, useState } from 'react'
import { Box, Button } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { type TreeNode } from '../api'
import { makeColorScale, makeTintScale } from '../colors'
import { CARD, INK, INK_MUTED, LINE, TREE_LINK, FONT_DISPLAY } from '../theme'
import { useSettings } from '../settings'
import { useCoarsePointer } from '../media'
import { frameTree, placedNodes, TRANSLATE } from '../framing'
import { cachedTaxonInfo, useTaxonCache } from '../taxonCache'
import {
  anchorAt, BOX_SIZES, compress, countNodes, findAnchor, gameSpacing, nodeToD3, nodeWellPlaced, sameView, SPACER,
  viewForAnchor, viewOnNode, type Anchor, type Placed, type View,
} from '../gameLayout'
import { deepestKnown } from '../endgame'
import { HoverPreview, NodeThumb, useHoverPreview } from './HoverPreview'
import TaxonPopup from './TaxonPopup'
import { displayName } from '../names'

type NodeDatum = CustomNodeElementProps['nodeDatum']

interface NodeLabelProps {
  nodeData: NodeDatum
  size: { thumb: number; font: number }
  tintFor: (warmth: number) => string
  onClick: (names: string[]) => void
  onHover: (name: string, e: React.PointerEvent<HTMLElement>) => void
  onHoverEnd: () => void
  colorFor: (warmth: number) => string
  dataset: string
}

function NodeLabel({ nodeData, size, onClick, onHover, onHoverEnd, colorFor, tintFor, dataset }: NodeLabelProps) {
  const type = nodeData.attributes?.type as string | undefined
  if (type === SPACER) return null
  const onPath = nodeData.attributes?.onPath
  const isOnPath = onPath === true || onPath === 'true'
  // Guesses open their own info now that species are scraped too. The ??? node
  // has no name to look up, so it stays unclickable.
  const taxa = String(nodeData.attributes?.taxa ?? '')
  const clickable = taxa.length > 0 && type !== 'secret'
  // A compressed node stands for several taxa, joined deepest-first, so the
  // first is both the most specific and the one the label leads with — picture
  // that one. The ??? node has no taxa at all and so never looks anything up,
  // which is what keeps it from leaking the answer.
  const primary = clickable ? taxa.split(' › ')[0] : ''
  const thumb = primary ? cachedTaxonInfo(primary, dataset)?.image_url ?? '' : ''
  const warmth = nodeData.attributes?.warmth as number

  const color = colorFor(warmth)

  // Four kinds of node, and the amount of colour each gets is the hierarchy:
  //   guess    — your own move. The loudest thing on screen: a card with a
  //              coloured edge and coloured name.
  //   on-path  — a clade you share with the answer. Paper, ink, and a spine of
  //              its depth colour down the leading edge.
  //   off-path — context. A quiet outline, no colour at all.
  //   ???      — dashed, so it reads as known-to-exist and not yet found.
  //
  // On-path clades used to be *filled* with the colour, and that was backwards.
  // A clade's depth is the least interesting number on screen — you cannot act
  // on it — yet at 200x56 of solid green per node it was also the loudest, and
  // a game four guesses in read as a wall of green boxes rather than as a tree.
  // Worse, the fill made the guesses, which are the only nodes whose colour you
  // are actually asked to compare, the *quietest* things on the page.
  //
  // The spine keeps the depth reading exactly — same scale, same colour — while
  // giving the ink back to the words. A taxonomy is mostly names, and they have
  // to be readable before anything else is.
  const boxSx = {
    px: 1.25,
    gap: 0.75,
    borderRadius: 1.25,
    fontSize: size.font,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box' as const,
    cursor: clickable ? 'pointer' : 'default',
    transition: 'filter 120ms, box-shadow 120ms',
    ...(type === 'secret'
      // Dashed, and washed rather than filled. It carries the colour of the
      // depth it sits at like any other node on the path, but as a solid block
      // it read as a node you had *found* — the one thing it is not. A broken
      // edge is the ordinary way to draw a thing that is there and not yet
      // known, and it also stops the eye taking it for a guess. It takes the
      // same wash as an on-path clade, because that is what it is; left
      // transparent it was the faintest thing on a screen it ought to anchor.
      ? { bgcolor: tintFor(warmth), border: '2px dashed', borderColor: color, color,
          fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: '0.14em' }
      : type === 'guess'
      // Filled, and the only filled thing in the tree. A guess is what the
      // player did and the one node whose colour they are asked to compare, so
      // it gets the saturated block that the clades gave up. There are four or
      // five of them against a quiet tree, which is legible where twenty were
      // not — the count is what makes a fill work here and not there.
      ? { bgcolor: color, border: '1.5px solid', borderColor: color, color: '#fdfbf7',
          fontWeight: 700, fontFamily: FONT_DISPLAY, letterSpacing: '0.01em',
          boxShadow: `0 1px 3px rgba(44,38,32,0.22)`,
          '&:hover': clickable ? { boxShadow: `0 3px 10px rgba(44,38,32,0.30)` } : {} }
      : isOnPath
      // The spine is a border, not a pseudo-element, so it costs no extra box
      // and cannot fall out of step with the card's own rounding.
      ? { bgcolor: tintFor(warmth), color: INK,
          border: `1px solid ${LINE}`, borderLeft: `5px solid ${color}`,
          fontFamily: FONT_DISPLAY, fontWeight: 600,
          '&:hover': clickable ? { borderColor: color } : {} }
      // CARD, not transparent, and that is the point rather than a default.
      // Links are painted before nodes, so a node occludes the ones running
      // under it — but only if it has something to occlude *with*. Left
      // transparent, every link crossing a context node was drawn straight
      // through its label. CARD is the canvas colour, so the box still reads as
      // an outline on paper and the line now stops at its edge.
      : { bgcolor: CARD, border: '1px solid', borderColor: LINE, color: INK_MUTED,
          fontFamily: FONT_DISPLAY,
          '&:hover': clickable ? { borderColor: INK, color: INK } : {} }),
  }

  function handleClick(e: React.MouseEvent) {
    if (!clickable) return
    e.stopPropagation()
    // Split `taxa`, not the displayed label: a guess is labelled by its common
    // name, and taxon info is keyed by the scientific one.
    onClick(taxa.split(' › '))
  }

  return (
    <Box
      sx={boxSx}
      data-node={nodeData.name}
      title={nodeData.name}
      onClick={handleClick}
      onPointerEnter={(e) => onHover(primary, e)}
      onPointerLeave={onHoverEnd}
    >
      <NodeThumb src={thumb} size={size.thumb} />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {displayName(nodeData.name)}
      </Box>
    </Box>
  )
}

interface GameTreeProps {
  treeData: TreeNode | null
  /** What to bring into view when the tree changes: the guess just made, or the
   *  ??? node after a hint. */
  focusLabel?: string | null
  /** The newest guess, for the Newest shortcut. */
  newestLabel?: string | null
}

/** The two shortcuts. Each jumps to its node, and becomes Back until the player
 *  pans or zooms — at which point where they are is simply where they are. */
type Shortcut = 'newest' | 'secret'

export default function GameTree({ treeData, focusLabel, newestLabel }: GameTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { colorScheme, orientation, dataset } = useSettings()
  const coarse = useCoarsePointer()
  const size = coarse ? BOX_SIZES.coarse : BOX_SIZES.fine
  const spacing = gameSpacing(size)
  useTaxonCache()   // a lookup landing repaints the thumbnails
  const { preview, startHover, cancelHover } = useHoverPreview(containerRef, dataset)
  // Cheap size guard for the framing pass; a game tree is tens of nodes, but
  // the helper's limit exists for the explore tree and the signature is shared.
  const nodeCount = treeData ? countNodes(treeData) : 0
  const [popupNames, setPopupNames] = useState<string[] | null>(null)

  // Where the tree is told to be (`shown`, its props) and where it actually is
  // (`actual`). They part as soon as the player pans or pinches: react-d3-tree
  // hands the gesture to d3 and only reports it through `onUpdate`. A move made
  // for the player has to start from where they *are*, at the zoom they chose.
  const [shown, setShown] = useState<View>({ x: 0, y: 0, zoom: size.zoom })
  const shownRef = useRef(shown)
  const actual = useRef(shown)
  // Which shortcut, if either, is showing Back, and the spot it goes back to.
  // A node rather than a translate, since a guess re-lays the tree out between
  // leaving and returning. Mirrored in a ref for onUpdate, which d3 calls with
  // whatever callback was current when it bound.
  const [back, setBack] = useState<{ from: Shortcut; anchor: Anchor } | null>(null)
  const backRef = useRef(back)
  const setBackState = useCallback((next: { from: Shortcut; anchor: Anchor } | null) => {
    backRef.current = next
    setBack(next)
  }, [])
  // The layout as last drawn, so the node the player was looking at can be found
  // from *before* a guess re-laid the tree out.
  const positions = useRef<Placed[]>([])
  const hasTree = treeData !== null

  // The library re-applies its position only when the props change, so moving
  // to exactly the last position told — after the player has panned away from
  // it — would do nothing. A hundredth of a pixel makes it a change.
  const moveTo = useCallback((next: View) => {
    const target = sameView(next, shownRef.current) ? { ...next, x: next.x + 0.01 } : next
    shownRef.current = target
    actual.current = target
    setShown(target)
  }, [])

  const onUpdate = useCallback(({ translate, zoom }: { translate: { x: number; y: number }; zoom: number }) => {
    const reported = { x: translate.x, y: translate.y, zoom }
    // After every re-render the library also reports its *props* position, not
    // the gesture's; taking that would overwrite where the player really is.
    if (sameView(reported, shownRef.current)) return
    actual.current = reported
    // A real pan or pinch: where the player is now is where they are, so there
    // is nothing to go back to and both shortcuts offer their jump again.
    if (backRef.current) setBackState(null)
  }, [setBackState])

  // Place the tree when it first appears and when its layout changes shape —
  // not on every guess. It used to re-place per guess, back to the root at the
  // default zoom, which threw away both where the player was looking and how
  // far in they had zoomed. `nodeCount` is read, not depended on, for that reason.
  useEffect(() => {
    const host = containerRef.current
    if (!host || !hasTree) return
    setBackState(null)
    const { width, height } = host.getBoundingClientRect()
    // Where the tree grows away from: left-centre going across, top-centre
    // going down. The fallback whenever the tree is too big to frame.
    const pin = orientation === 'horizontal'
      ? { x: size.w / 2 + 8, y: height / 2, zoom: size.zoom }
      : { x: width / 2, y: size.h / 2 + 24, zoom: size.zoom }
    moveTo(pin)
    // A phone keeps the pin and lets the focus effect below carry the view to
    // the newest guess; there is no framing of a game tree onto a 390px screen.
    if (coarse) return
    // A root is only in the middle of its own subtree when that subtree is
    // symmetrical, which a game's never is — pinning it put half the guesses
    // off the left edge. Deferred a frame: the nodes are not laid out yet.
    const raf = requestAnimationFrame(() => moveTo({ ...frameTree(host, size.zoom, pin, nodeCount), zoom: size.zoom }))
    return () => cancelAnimationFrame(raf)
  }, [hasTree, orientation, size.w, size.h, size.zoom, coarse, moveTo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bring the newest guess into view when it lands outside it.
  //
  // The tree grows away from the root, so on a phone the root is at the edge
  // and everything interesting is off it: four guesses into a game, a 390px
  // screen showed "Animalia" and nothing else, with every guess 500-1500px
  // further along. Pinning the root is right for the first look at an empty
  // tree and wrong from the first guess onwards.
  //
  // Only when the node is actually off-screen, which is why this is not simply
  // "centre on every guess": on a desktop the whole tree usually fits, and
  // yanking the view after each guess would move a tree the reader is already
  // looking at. Coordinates come back out of the DOM for the same reason as in
  // ExploreTree — the layout's leaf ordering is react-d3-tree's alone.
  // Retried across a few frames rather than read once, which is the whole
  // reason this did not work when it was written: react-d3-tree lays out and
  // renders its nodes in its own commit, so on the commit where `treeData`
  // arrives the node is not in the DOM yet. A single lookup finds nothing,
  // returns, and never runs again — the deps have not changed. It looks exactly
  // like an effect that fired and decided to do nothing.
  useEffect(() => {
    const host = containerRef.current
    if (!host || !focusLabel) return

    let frame = 0
    let raf = 0
    const attempt = () => {
      const el = host.querySelector(`[data-node="${CSS.escape(focusLabel)}"]`)
      // Two frames at least, even when a node by that label is already there:
      // after a hint the ??? node exists in the old layout too, and measuring
      // that one would anchor everything below to positions about to change.
      if (!el || frame < 2) {
        // ~10 frames is a sixth of a second; past that the node is genuinely
        // not there (a guess collapsed into a chain label, say) and retrying
        // for longer would only risk yanking a view the reader has since panned.
        if (frame++ < 10) raf = requestAnimationFrame(attempt)
        return
      }
      const m = el.closest('g')?.getAttribute('transform')?.match(TRANSLATE)
      if (!m) return
      // Judged against where the view actually is, from the layout position and
      // the tracked transform rather than the DOM, which can still be showing
      // the frame before a move this same commit has asked for.
      const { width, height } = host.getBoundingClientRect()
      const here = actual.current
      // What the player was looking at, found in the layout they were looking at
      // it in; then the new layout becomes the one to remember.
      const before = anchorAt(positions.current, here, width, height)
      positions.current = placedNodes(host)
      const nodeX = Number(m[1])
      const nodeY = Number(m[2])
      if (nodeWellPlaced(nodeX, nodeY, size, here, width, height, orientation)) return
      // Then centre any axis the whole tree fits. Across, a round is far wider
      // than a phone and rarely taller, and centring the guess alone left the
      // top third of the tree empty with the tree in the half below it.
      const onNode = viewOnNode(nodeX, nodeY, size, here, width, height, orientation)
      // An automatic move is a jump like a tap on the matching shortcut, so that
      // shortcut offers the way back.
      setBackState(before ? { from: focusLabel === '???' ? 'secret' : 'newest', anchor: before } : null)
      moveTo({ ...frameTree(host, here.zoom, onNode, nodeCount), zoom: here.zoom })
    }
    raf = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(raf)
    // Keyed on the tree and the focus alone: a move happens because something
    // new landed, never because the player zoomed.
  }, [treeData, focusLabel]) // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to a node at the zoom the player already has, remembering where they
  // were so the same button can take them back.
  function jumpTo(label: string, from: Shortcut) {
    const host = containerRef.current
    if (!host) return
    const { width, height } = host.getBoundingClientRect()
    const nodes = placedNodes(host)
    const target = nodes.find((n) => n.label === label)
    if (!target) return
    const here = actual.current
    const onNode = viewOnNode(target.x, target.y, size, here, width, height, orientation)
    const spot = anchorAt(nodes, here, width, height)
    moveTo({ ...frameTree(host, here.zoom, onNode, nodeCount), zoom: here.zoom })
    setBackState(spot ? { from, anchor: spot } : null)
  }

  function goBack() {
    const host = containerRef.current
    const remembered = backRef.current
    setBackState(null)
    if (!host || !remembered) return
    // Found again by name: a guess may have moved it since.
    const at = findAnchor(placedNodes(host), remembered.anchor.label)
    if (at) moveTo(viewForAnchor(remembered.anchor, at))
  }

  if (!treeData) return null
  const hasSecret = deepestKnown(treeData) !== null

  const compressed = compress(treeData)
  const d3Data = nodeToD3(compressed)
  // No dataset anchor: the API sends each node's rank position directly, and
  // a rank means the same thing in every dataset. See colors.ts.
  const colorFor = makeColorScale(colorScheme)
  const tintFor = makeTintScale(colorScheme)

  return (
    <>
      <Box
        ref={containerRef}
        sx={{
          position: 'relative', width: '100%',
          // Whatever the page leaves: App lays the game out as a 100dvh column
          // and gives this the rest. It was `calc(100dvh - 300px)`, a guess at
          // what sits above, which left a strip of empty screen under the tree
          // on a phone and was wrong again whenever a banner appeared.
          height: '100%',
          minHeight: { xs: 300, sm: 400 },
          // The tree pans itself; the browser must not also try to scroll the
          // page from a drag that starts in here, or the two fight and neither
          // happens properly.
          touchAction: 'none',
          overscrollBehavior: 'contain',
          border: 1, borderColor: 'divider', borderRadius: 3,
          bgcolor: CARD,
          overflow: 'hidden',
          // The library draws its links as near-black hairlines. On a wide
          // fan-out they are most of the ink on screen and read as the subject
          // rather than as the joins between the nodes that are.
          '& .rd3t-link': { stroke: TREE_LINK, strokeWidth: 1.25 },
        }}
      >
        <HoverPreview preview={preview} dataset={dataset} />
        {/* Newest top left, ??? top right. Whichever was used last reads Back
          * until the player pans, zooms or goes back. */}
        {newestLabel && (
          <Button
            size="small" variant="contained" disableElevation
            aria-label={back?.from === 'newest' ? 'Back to where you were' : 'Jump to the newest guess'}
            onClick={() => (back?.from === 'newest' ? goBack() : jumpTo(newestLabel, 'newest'))}
            sx={{ position: 'absolute', top: 8, left: 8, zIndex: 2, minHeight: coarse ? 40 : undefined }}
          >
            {back?.from === 'newest' ? '↩ Back' : 'Newest'}
          </Button>
        )}
        {hasSecret && (
          <Button
            size="small" variant="contained" disableElevation
            aria-label={back?.from === 'secret' ? 'Back to where you were' : 'Jump to ???'}
            onClick={() => (back?.from === 'secret' ? goBack() : jumpTo('???', 'secret'))}
            sx={{ position: 'absolute', top: 8, right: 8, zIndex: 2, minHeight: coarse ? 40 : undefined }}
          >
            {back?.from === 'secret' ? '↩ Back' : '???'}
          </Button>
        )}
        <Tree
          data={d3Data}
          orientation={orientation}
          pathFunc="diagonal"
          translate={{ x: shown.x, y: shown.y }}
          nodeSize={spacing[orientation]}
          separation={{ siblings: 1.1, nonSiblings: 1.4 }}
          zoom={shown.zoom}
          onUpdate={onUpdate}
          renderCustomNodeElement={({ nodeDatum }) => (
            <foreignObject x={-size.w / 2} y={-size.h / 2} width={size.w} height={size.h}>
              <NodeLabel
                nodeData={nodeDatum}
                size={size}
                onClick={setPopupNames}
                onHover={startHover}
                onHoverEnd={cancelHover}
                colorFor={colorFor}
                tintFor={tintFor}
                dataset={dataset}
              />
            </foreignObject>
          )}
        />
      </Box>

      {popupNames && (
        <TaxonPopup names={popupNames} onClose={() => setPopupNames(null)} />
      )}
    </>
  )
}

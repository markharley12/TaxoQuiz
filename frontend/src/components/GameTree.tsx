import { useRef, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { fetchDataset, type TreeNode } from '../api'
import { makeColorScale, makeTintScale, FALLBACK_ANCHOR_DEPTH } from '../colors'
import { CARD, INK, INK_MUTED, LINE, TREE_LINK, FONT_DISPLAY } from '../theme'
import { useSettings } from '../settings'
import { useCoarsePointer } from '../media'
import { frameTree } from '../framing'
import { cachedTaxonInfo, useTaxonCache } from '../taxonCache'
import { BOX_SIZES, compress, countNodes, gameSpacing, nodeToD3, SPACER } from '../gameLayout'
import { HoverPreview, NodeThumb, useHoverPreview } from './HoverPreview'
import TaxonPopup from './TaxonPopup'

type NodeDatum = CustomNodeElementProps['nodeDatum']

interface NodeLabelProps {
  nodeData: NodeDatum
  size: { thumb: number; font: number }
  tintForDepth: (depth: number) => string
  onClick: (names: string[]) => void
  onHover: (name: string, e: React.PointerEvent<HTMLElement>) => void
  onHoverEnd: () => void
  colorForDepth: (depth: number) => string
  dataset: string
}

function NodeLabel({ nodeData, size, onClick, onHover, onHoverEnd, colorForDepth, tintForDepth, dataset }: NodeLabelProps) {
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
  const colorDepth = nodeData.attributes?.colorDepth as number

  const color = colorForDepth(colorDepth)

  // Three kinds of node, three treatments, and the difference between them is
  // meant to be readable at a glance across a whole tree:
  //   guess    — your own move, so it is a card on paper with a coloured edge
  //   on-path  — a clade you share with the answer: filled, carrying the colour
  //   off-path — context. Quiet, so the two above are what the eye lands on.
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
      // Dashed, and outlined rather than filled. It carries the colour of the
      // depth it sits at like any other node on the path, but as a solid block
      // it read as a node you had *found* — the one thing it is not. A broken
      // edge is the ordinary way to draw a thing that is there and not yet
      // known, and it also stops the eye taking it for a guess.
      ? { bgcolor: 'transparent', border: '1.5px dashed', borderColor: color, color,
          fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: '0.14em' }
      : type === 'guess'
      ? { bgcolor: CARD, border: '1.5px solid', borderColor: color, color,
          fontWeight: 700, fontFamily: FONT_DISPLAY, letterSpacing: '0.01em',
          boxShadow: `0 1px 2px rgba(44,38,32,0.10)`,
          '&:hover': clickable ? { boxShadow: `0 2px 8px rgba(44,38,32,0.18)` } : {} }
      : isOnPath
      ? { bgcolor: tintForDepth(colorDepth), color: '#fdfbf7', fontFamily: FONT_DISPLAY, fontWeight: 600,
          '&:hover': clickable ? { filter: 'brightness(1.08)' } : {} }
      : { bgcolor: 'transparent', border: '1px solid', borderColor: LINE, color: INK_MUTED,
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
        {nodeData.name}
      </Box>
    </Box>
  )
}

interface GameTreeProps {
  treeData: TreeNode | null
  /** The guess just made, so the view can go and show it. */
  focusLabel?: string | null
}

export default function GameTree({ treeData, focusLabel }: GameTreeProps) {
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
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [popupNames, setPopupNames] = useState<string[] | null>(null)
  const [maxDepth, setMaxDepth] = useState(FALLBACK_ANCHOR_DEPTH)

  useEffect(() => {
    fetchDataset(dataset)
      .then((d) => setMaxDepth(d.color_anchor_depth))
      .catch(() => {})   // keep the fallback; the game is still playable
  }, [dataset])

  useEffect(() => {
    const host = containerRef.current
    if (!host) return
    const { width, height } = host.getBoundingClientRect()
    // Where the tree grows away from: left-centre going across, top-centre
    // going down. The fallback whenever the tree is too big to frame.
    const pin = orientation === 'horizontal'
      ? { x: size.w / 2 + 8, y: height / 2 }
      : { x: width / 2, y: size.h / 2 + 24 }
    setTranslate(pin)
    // A phone keeps the pin and lets the focus effect below carry the view to
    // the newest guess; there is no framing of a game tree onto a 390px screen.
    if (coarse) return
    // A root is only in the middle of its own subtree when that subtree is
    // symmetrical, which a game's never is — pinning it put half the guesses
    // off the left edge. Deferred a frame: the nodes are not laid out yet.
    const raf = requestAnimationFrame(() => setTranslate(frameTree(host, size.zoom, pin, nodeCount)))
    return () => cancelAnimationFrame(raf)
  }, [treeData, orientation, size.w, size.h, size.zoom, coarse, nodeCount])

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
      if (!el) {
        // ~10 frames is a sixth of a second; past that the node is genuinely
        // not there (a guess collapsed into a chain label, say) and retrying
        // for longer would only risk yanking a view the reader has since panned.
        if (frame++ < 10) raf = requestAnimationFrame(attempt)
        return
      }
      const box = el.getBoundingClientRect()
      const view = host.getBoundingClientRect()
      const inside =
        box.left >= view.left && box.right <= view.right &&
        box.top >= view.top && box.bottom <= view.bottom
      if (inside) return
      const m = el.closest('g')?.getAttribute('transform')?.match(/translate\(([-\d.]+)[, ]+([-\d.]+)\)/)
      if (!m) return
      setTranslate({
        x: view.width / 2 - Number(m[1]) * size.zoom,
        y: view.height / 2 - Number(m[2]) * size.zoom,
      })
    }
    raf = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(raf)
  }, [treeData, focusLabel, size.zoom])

  if (!treeData) return null

  const compressed = compress(treeData)
  const d3Data = nodeToD3(compressed)
  const colorForDepth = makeColorScale(maxDepth, colorScheme)
  const tintForDepth = makeTintScale(maxDepth, colorScheme)

  return (
    <>
      <Box
        ref={containerRef}
        sx={{
          position: 'relative', width: '100%',
          // dvh rather than vh: on a phone `vh` is measured with the browser's
          // toolbars hidden, so a vh-sized box overflows the screen whenever
          // they are showing and the page scrolls behind the tree.
          height: { xs: 'calc(100dvh - 300px)', sm: 'calc(100vh - 220px)' },
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
        <Tree
          data={d3Data}
          orientation={orientation}
          pathFunc="diagonal"
          translate={translate}
          nodeSize={spacing[orientation]}
          separation={{ siblings: 1.1, nonSiblings: 1.4 }}
          zoom={size.zoom}
          renderCustomNodeElement={({ nodeDatum }) => (
            <foreignObject x={-size.w / 2} y={-size.h / 2} width={size.w} height={size.h}>
              <NodeLabel
                nodeData={nodeDatum}
                size={size}
                onClick={setPopupNames}
                onHover={startHover}
                onHoverEnd={cancelHover}
                colorForDepth={colorForDepth}
                tintForDepth={tintForDepth}
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

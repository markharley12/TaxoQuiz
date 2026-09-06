import { useRef, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { fetchDataset, type TreeNode } from '../api'
import { makeColorScale, FALLBACK_ANCHOR_DEPTH } from '../colors'
import { useSettings } from '../settings'
import { useCoarsePointer } from '../media'
import { cachedTaxonInfo, useTaxonCache } from '../taxonCache'
import { HoverPreview, NodeThumb, useHoverPreview } from './HoverPreview'
import TaxonPopup from './TaxonPopup'

type NodeDatum = CustomNodeElementProps['nodeDatum']

interface D3Data {
  name: string
  attributes: { type: string; onPath: boolean; colorDepth: number; taxa: string }
  children: D3Data[]
}

// Collapsing a single-child chain joins the labels for display; `name` has to
// be joined the same way, or the popup opens on one taxon out of the several
// the node now stands for.
function compress(node: TreeNode): TreeNode {
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
function rowsForGap(gap: number): number {
  return Math.max(1, Math.round(Math.sqrt(Math.max(gap, 1))))
}

const SPACER = '__spacer__'

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
const BOX_SIZES = {
  fine:   { w: 200, h: 40, zoom: 0.9, thumb: 26, font: 11 },
  coarse: { w: 210, h: 52, zoom: 1.0, thumb: 30, font: 13 },
}

function gameSpacing(b: { w: number; h: number }) {
  return {
    horizontal: { x: b.w + 40, y: b.h + 12 },
    vertical: { x: b.w + 20, y: b.h + 40 },
  } as const
}

function nodeToD3(node: TreeNode, parentDepth: number | null = null): D3Data {
  const self: D3Data = {
    name: node.label,
    attributes: {
      type: node.node_type,
      onPath: node.on_secret_path,
      colorDepth: node.lca_depth ?? node.depth,
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
        colorDepth: node.lca_depth ?? node.depth,
        taxa: '',
      },
      children: [chain],
    }
  }
  return chain
}

interface NodeLabelProps {
  nodeData: NodeDatum
  size: { thumb: number; font: number }
  onClick: (names: string[]) => void
  onHover: (name: string, e: React.PointerEvent<HTMLElement>) => void
  onHoverEnd: () => void
  colorForDepth: (depth: number) => string
  dataset: string
}

function NodeLabel({ nodeData, size, onClick, onHover, onHoverEnd, colorForDepth, dataset }: NodeLabelProps) {
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

  const boxSx = {
    px: 1.25,
    gap: 0.75,
    borderRadius: 1,
    fontSize: size.font,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box' as const,
    cursor: clickable ? 'pointer' : 'default',
    ...(type === 'guess'
      ? { bgcolor: '#fff', border: '2px solid', borderColor: color, color, fontWeight: 'bold',
          '&:hover': clickable ? { filter: 'brightness(0.9)' } : {} }
      : isOnPath
      ? { bgcolor: color, color: 'white', '&:hover': clickable ? { filter: 'brightness(0.85)' } : {} }
      : { bgcolor: 'grey.200', color: 'text.secondary', '&:hover': clickable ? { bgcolor: 'grey.300' } : {} }),
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
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [popupNames, setPopupNames] = useState<string[] | null>(null)
  const [maxDepth, setMaxDepth] = useState(FALLBACK_ANCHOR_DEPTH)

  useEffect(() => {
    fetchDataset(dataset)
      .then((d) => setMaxDepth(d.color_anchor_depth))
      .catch(() => {})   // keep the fallback; the game is still playable
  }, [dataset])

  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect()
      // The root sits where the tree grows away from: left-centre going across,
      // top-centre going down.
      setTranslate(orientation === 'horizontal'
        ? { x: size.w / 2 + 8, y: height / 2 }
        : { x: width / 2, y: size.h / 2 + 24 })
    }
  }, [treeData, orientation, size.w, size.h])

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
          border: 1, borderColor: 'divider', borderRadius: 2,
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

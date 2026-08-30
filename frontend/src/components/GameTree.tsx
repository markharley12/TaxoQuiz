import { useRef, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { fetchDataset, type TreeNode } from '../api'
import { makeColorScale, FALLBACK_ANCHOR_DEPTH } from '../colors'
import { useSettings } from '../settings'
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
const BOX_W = 200
const BOX_H = 40
const SPACING = {
  horizontal: { x: BOX_W + 40, y: 52 },
  vertical: { x: BOX_W + 20, y: 80 },
} as const

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
  onClick: (names: string[]) => void
  colorForDepth: (depth: number) => string
}

function NodeLabel({ nodeData, onClick, colorForDepth }: NodeLabelProps) {
  const type = nodeData.attributes?.type as string | undefined
  if (type === SPACER) return null
  const onPath = nodeData.attributes?.onPath
  const isOnPath = onPath === true || onPath === 'true'
  // Guesses open their own info now that species are scraped too. The ??? node
  // has no name to look up, so it stays unclickable.
  const taxa = String(nodeData.attributes?.taxa ?? '')
  const clickable = taxa.length > 0 && type !== 'secret'
  const colorDepth = nodeData.attributes?.colorDepth as number

  const color = colorForDepth(colorDepth)

  const boxSx = {
    px: 1.25,
    borderRadius: 1,
    fontSize: 11,
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
    <Box sx={boxSx} title={nodeData.name} onClick={handleClick}>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {nodeData.name}
      </Box>
    </Box>
  )
}

interface GameTreeProps {
  treeData: TreeNode | null
}

export default function GameTree({ treeData }: GameTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { colorScheme, orientation, dataset } = useSettings()
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
        ? { x: 130, y: height / 2 }
        : { x: width / 2, y: 60 })
    }
  }, [treeData, orientation])

  if (!treeData) return null

  const compressed = compress(treeData)
  const d3Data = nodeToD3(compressed)
  const colorForDepth = makeColorScale(maxDepth, colorScheme)

  return (
    <>
      <Box
        ref={containerRef}
        sx={{ width: '100%', height: 'calc(100vh - 220px)', minHeight: 400, border: 1, borderColor: 'divider', borderRadius: 2 }}
      >
        <Tree
          data={d3Data}
          orientation={orientation}
          pathFunc="diagonal"
          translate={translate}
          nodeSize={SPACING[orientation]}
          separation={{ siblings: 1.1, nonSiblings: 1.4 }}
          zoom={0.9}
          renderCustomNodeElement={({ nodeDatum }) => (
            <foreignObject x={-BOX_W / 2} y={-BOX_H / 2} width={BOX_W} height={BOX_H}>
              <NodeLabel nodeData={nodeDatum} onClick={setPopupNames} colorForDepth={colorForDepth} />
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

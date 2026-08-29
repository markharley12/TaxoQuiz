import { useRef, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { fetchDataset, type TreeNode } from '../api'
import TaxonPopup from './TaxonPopup'

type NodeDatum = CustomNodeElementProps['nodeDatum']

interface D3Data {
  name: string
  attributes: { type: string; onPath: boolean; colorDepth: number }
  children: D3Data[]
}

// The colour scale is deliberately ABSOLUTE: depth 0 (the root) is always red and
// the dataset's deepest node always green, so a node never changes colour because
// of a later guess. A relative scale rescaled on every guess, and rendered a set of
// equally-cold guesses mid-gradient instead of red.
//
// Not normalised against the secret's own depth, though that would give tidier
// warmth: it would leak how deep the secret sits, which the ??? node exists to hide.
// The trade-off is that a shallow secret cannot reach green — correctly so, since
// little lineage is genuinely shared.
//
// maxDepth comes from /dataset rather than a constant: the bundled example is 18
// deep but a full Wikidata scrape is 64, and hardcoding either renders the other
// almost entirely one colour. The fallback only applies before that request lands.
const FALLBACK_MAX_DEPTH = 18

function makeColorScale(maxDepth: number) {
  const span = maxDepth > 0 ? maxDepth : FALLBACK_MAX_DEPTH
  return (depth: number): string => {
    const t = Math.min(Math.max(depth / span, 0), 1)
    const hue = Math.round(t * 120) // 0 = red, 120 = green
    return `hsl(${hue}, 70%, 35%)`
  }
}

function compress(node: TreeNode): TreeNode {
  const children = node.children.map(compress)
  if (node.node_type === 'ancestor' && children.length === 1 && children[0].node_type === 'ancestor') {
    const child = children[0]
    return { ...child, label: `${child.label} › ${node.label}` }
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

function nodeToD3(node: TreeNode, parentDepth: number | null = null): D3Data {
  const self: D3Data = {
    name: node.label,
    attributes: {
      type: node.node_type,
      onPath: node.on_secret_path,
      colorDepth: node.lca_depth ?? node.depth,
    },
    children: node.children.map((c) => nodeToD3(c, node.depth)),
  }

  const gap = parentDepth === null ? 0 : node.depth - parentDepth
  const extra = gap > 1 ? rowsForGap(gap) - 1 : 0
  if (extra <= 0) return self

  // Thread the node onto the end of a chain of unlabelled spacers, so the
  // layout spends real vertical distance on the ranks the collapse hid.
  let chain = self
  for (let i = 0; i < extra; i++) {
    chain = {
      name: SPACER,
      attributes: {
        type: SPACER,
        onPath: node.on_secret_path,
        colorDepth: node.lca_depth ?? node.depth,
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
  const isAncestor = type === 'ancestor'
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
    cursor: isAncestor ? 'pointer' : 'default',
    ...(type === 'guess'
      ? { bgcolor: '#fff', border: '2px solid', borderColor: color, color, fontWeight: 'bold' }
      : isOnPath
      ? { bgcolor: color, color: 'white', '&:hover': isAncestor ? { filter: 'brightness(0.85)' } : {} }
      : { bgcolor: 'grey.200', color: 'text.secondary', '&:hover': isAncestor ? { bgcolor: 'grey.300' } : {} }),
  }

  function handleClick(e: React.MouseEvent) {
    if (!isAncestor) return
    e.stopPropagation()
    onClick(nodeData.name.split(' › '))
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
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [popupNames, setPopupNames] = useState<string[] | null>(null)
  const [maxDepth, setMaxDepth] = useState(FALLBACK_MAX_DEPTH)

  useEffect(() => {
    fetchDataset()
      .then((d) => setMaxDepth(d.max_depth))
      .catch(() => {})   // keep the fallback; the game is still playable
  }, [])

  useEffect(() => {
    if (containerRef.current) {
      const { width } = containerRef.current.getBoundingClientRect()
      setTranslate({ x: width / 2, y: 60 })
    }
  }, [treeData])

  if (!treeData) return null

  const compressed = compress(treeData)
  const d3Data = nodeToD3(compressed)
  const colorForDepth = makeColorScale(maxDepth)

  return (
    <>
      <Box
        ref={containerRef}
        sx={{ width: '100%', height: 'calc(100vh - 220px)', minHeight: 400, border: 1, borderColor: 'divider', borderRadius: 2 }}
      >
        <Tree
          data={d3Data}
          orientation="vertical"
          pathFunc="diagonal"
          translate={translate}
          nodeSize={{ x: 220, y: 80 }}
          separation={{ siblings: 1.1, nonSiblings: 1.4 }}
          zoom={0.9}
          renderCustomNodeElement={({ nodeDatum }) => (
            <foreignObject x={-100} y={-20} width={200} height={40}>
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

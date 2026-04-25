import { useRef, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { type TreeNode } from '../api'
import TaxonPopup from './TaxonPopup'

type NodeDatum = CustomNodeElementProps['nodeDatum']

interface D3Data {
  name: string
  attributes: { type: string; onPath: boolean; colorDepth: number }
  children: D3Data[]
}

function collectColorDepths(node: TreeNode): number[] {
  const out: number[] = []
  if (node.node_type === 'guess') out.push(node.lca_depth ?? node.depth)
  if (node.node_type === 'ancestor' && node.on_secret_path) out.push(node.depth)
  for (const child of node.children) out.push(...collectColorDepths(child))
  return out
}

function makeColorScale(min: number, max: number) {
  return (depth: number): string => {
    const t = max === min ? 0.5 : (depth - min) / (max - min)
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

function nodeToD3(node: TreeNode): D3Data {
  return {
    name: node.label,
    attributes: {
      type: node.node_type,
      onPath: node.on_secret_path,
      colorDepth: node.lca_depth ?? node.depth,
    },
    children: node.children.map(nodeToD3),
  }
}

interface NodeLabelProps {
  nodeData: NodeDatum
  onClick: (names: string[]) => void
  pathColor: (depth: number) => string
}

function NodeLabel({ nodeData, onClick, pathColor }: NodeLabelProps) {
  const type = nodeData.attributes?.type as string | undefined
  const onPath = nodeData.attributes?.onPath
  const isOnPath = onPath === true || onPath === 'true'
  const isAncestor = type === 'ancestor'
  const colorDepth = nodeData.attributes?.colorDepth as number

  const color = pathColor(colorDepth)

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

  useEffect(() => {
    if (containerRef.current) {
      const { width } = containerRef.current.getBoundingClientRect()
      setTranslate({ x: width / 2, y: 60 })
    }
  }, [treeData])

  if (!treeData) return null

  const compressed = compress(treeData)
  const depths = collectColorDepths(compressed)
  const minD = Math.min(...depths)
  const maxD = Math.max(...depths)
  const pathColor = makeColorScale(minD, maxD)

  const d3Data = nodeToD3(compressed)

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
              <NodeLabel nodeData={nodeDatum} onClick={setPopupNames} pathColor={pathColor} />
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

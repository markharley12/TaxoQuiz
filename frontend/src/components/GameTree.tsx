import { useRef, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import Tree, { type CustomNodeElementProps } from 'react-d3-tree'
import { type TreeNode } from '../api'

type NodeDatum = CustomNodeElementProps['nodeDatum']

interface D3Data {
  name: string
  attributes: { type: string; onPath: boolean }
  children: D3Data[]
}

function compress(node: TreeNode): TreeNode {
  const children = node.children.map(compress)
  if (node.node_type === 'ancestor' && children.length === 1 && children[0].node_type === 'ancestor') {
    const child = children[0]
    return { ...child, label: `${node.label} › ${child.label}`, depth: node.depth }
  }
  return { ...node, children }
}

function nodeToD3(node: TreeNode): D3Data {
  return {
    name: node.label,
    attributes: { type: node.node_type, onPath: node.on_secret_path },
    children: node.children.map(nodeToD3),
  }
}

function NodeLabel({ nodeData }: { nodeData: NodeDatum }) {
  const type = nodeData.attributes?.type as string | undefined
  const onPath = nodeData.attributes?.onPath
  const isOnPath = onPath === true || onPath === 'true'

  const boxSx = {
    px: 1.25,
    borderRadius: 1,
    fontSize: 11,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box' as const,
    ...(type === 'guess'
      ? { bgcolor: 'background.paper', border: '2px solid', borderColor: 'text.primary', fontWeight: 'bold' }
      : isOnPath
      ? { bgcolor: '#8B0000', color: 'white' }
      : { bgcolor: 'grey.200', color: 'text.secondary' }),
  }

  return (
    <Box sx={boxSx} title={nodeData.name}>
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

  useEffect(() => {
    if (containerRef.current) {
      const { width } = containerRef.current.getBoundingClientRect()
      setTranslate({ x: width / 2, y: 60 })
    }
  }, [treeData])

  if (!treeData) return null

  const d3Data = nodeToD3(compress(treeData))

  return (
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
            <NodeLabel nodeData={nodeDatum} />
          </foreignObject>
        )}
      />
    </Box>
  )
}

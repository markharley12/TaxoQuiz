import { useRef, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import Tree from 'react-d3-tree'

function compress(node) {
  const children = node.children.map(compress)
  if (node.node_type === 'ancestor' && children.length === 1 && children[0].node_type === 'ancestor') {
    const child = children[0]
    return { ...child, label: `${node.label} › ${child.label}`, depth: node.depth }
  }
  return { ...node, children }
}

function nodeToD3(node) {
  return {
    name: node.label,
    attributes: { type: node.node_type, onPath: node.on_secret_path },
    children: node.children.map(nodeToD3),
  }
}

function NodeLabel({ nodeData }) {
  const { type, onPath } = nodeData.attributes ?? {}

  const sx = {
    px: 1.25, py: 0.5,
    borderRadius: 1,
    fontSize: 11,
    whiteSpace: 'nowrap',
    display: 'inline-block',
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    ...(type === 'guess'
      ? { bgcolor: 'background.paper', border: '2px solid', borderColor: 'text.primary', fontWeight: 'bold' }
      : (onPath === true || onPath === 'true')
      ? { bgcolor: '#8B0000', color: 'white' }
      : { bgcolor: 'grey.200', color: 'text.secondary' }),
  }

  return <Box sx={sx}>{nodeData.name}</Box>
}

export default function GameTree({ treeData }) {
  const containerRef = useRef(null)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (containerRef.current) {
      const { width } = containerRef.current.getBoundingClientRect()
      setTranslate({ x: width / 2, y: 40 })
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
        pathFunc="step"
        translate={translate}
        nodeSize={{ x: 220, y: 80 }}
        separation={{ siblings: 1.1, nonSiblings: 1.4 }}
        zoom={0.9}
        renderCustomNodeElement={({ nodeDatum }) => (
          <foreignObject x={-100} y={-18} width={200} height={40}>
            <NodeLabel nodeData={nodeDatum} />
          </foreignObject>
        )}
      />
    </Box>
  )
}

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Box, Typography } from '@mui/material'
import { cachedTaxonInfo, loadTaxonInfo, useTaxonCache } from '../taxonCache'

// Hovering asks for a node's info, and the picture then stays on its box.
//
// The delay is what keeps that honest: dragging the mouse across the tree
// crosses dozens of nodes, and without it every one of them would fetch. A
// deliberate hover is well over this; a pass-through is well under.
export const HOVER_DELAY_MS = 350
export const THUMB_PX = 26
const PREVIEW_W = 190

interface Preview {
  name: string
  x: number
  y: number
}

/** Hover-to-preview, shared by the game tree and the explore tree.
 *
 * `container` must be positioned (the card is absolute within it) and is what
 * the card is measured against, since the tree pans underneath it.
 */
export function useHoverPreview(container: RefObject<HTMLElement | null>) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const timer = useRef<number | null>(null)

  const cancelHover = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    setPreview(null)
  }, [])

  const startHover = useCallback((name: string, el: HTMLElement) => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    if (!name) return
    // Measured now rather than in the callback: by the time it fires the mouse
    // may have moved, but the box has not.
    const box = el.getBoundingClientRect()
    const host = container.current?.getBoundingClientRect()
    if (!host) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      void loadTaxonInfo(name)
      setPreview({
        name,
        x: Math.max(4, Math.min(box.left - host.left, host.width - PREVIEW_W - 8)),
        y: box.bottom - host.top + 6,
      })
    }, HOVER_DELAY_MS)
  }, [container])

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  return { preview, startHover, cancelHover }
}

/** The picture that appears when you rest on a node.
 *
 * Renders nothing until the lookup lands, and nothing ever for a node with no
 * picture — a card that pops up empty is worse than no card. The image is the
 * point, so it is shown whole rather than cropped, on the same black mat the
 * popup uses.
 */
export function HoverPreview({ preview }: { preview: Preview | null }) {
  useTaxonCache()
  const info = preview && cachedTaxonInfo(preview.name)
  if (!preview || !info?.image_url) return null

  return (
    <Box
      sx={{
        position: 'absolute', left: preview.x, top: preview.y, width: PREVIEW_W, zIndex: 5,
        pointerEvents: 'none', borderRadius: 1, overflow: 'hidden',
        bgcolor: 'background.paper', boxShadow: 6,
      }}
    >
      <Box sx={{ aspectRatio: '4 / 3', bgcolor: 'common.black' }}>
        <Box
          component="img"
          src={info.image_url}
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </Box>
      <Typography variant="caption" sx={{ display: 'block', px: 1, py: 0.5, lineHeight: 1.3 }}>
        {info.common_name || preview.name}
      </Typography>
    </Box>
  )
}

/** The small square that stays on a node once its picture is known.
 *
 * `cover` on 26px: this is an identifying dot, not something you read detail
 * from, so filling the square beats letterboxing it down to nothing. The card
 * and the popup are where the picture is shown properly.
 */
export function NodeThumb({ src }: { src: string }) {
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      width={THUMB_PX}
      height={THUMB_PX}
      style={{
        width: THUMB_PX, height: THUMB_PX, objectFit: 'cover', borderRadius: 3,
        flexShrink: 0, background: 'rgba(0,0,0,0.15)',
      }}
    />
  )
}

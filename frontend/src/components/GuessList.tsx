/**
 * The record of what has been guessed, clamped to one line.
 *
 * It used to be a wrapping row of every guess at full chip size, which on a
 * phone cost a line of screen every two or three turns — a dozen guesses in, it
 * pushed the tree, the thing the game is actually played on, most of the way
 * off the bottom. The list matters least of anything on the page: the tree
 * already shows every guess in its place, and GuessInput already excludes the
 * ones spent, so this is a reminder rather than a working surface.
 *
 * **Newest first.** With guesses in the order they were made, a clamped line
 * shows the oldest and hides the freshest — including, at the end of a won
 * round, the winning guess, which is the one chip anybody wants to see.
 *
 * How many fit is *measured*, not counted: see `guessRow.ts`.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { Box, Button, Chip, Stack } from '@mui/material'
import { displayName } from '../names'
import { firstRowCount } from '../guessRow'

/** Height of a small MUI chip. Set on the chips too, so the clamp below cannot
 *  drift out of step with what it is clamping. */
const CHIP_H = 24

export default function GuessList({ guesses, secret }: { guesses: string[]; secret: string | null }) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [onFirstRow, setOnFirstRow] = useState(guesses.length)

  useLayoutEffect(() => {
    const el = rowRef.current
    if (!el) return
    const measure = () => {
      const tops = Array.from(el.children).map((c) => (c as HTMLElement).offsetTop)
      setOnFirstRow(firstRowCount(tops))
    }
    measure()
    // Rotating a phone rewraps the row, so the count is watched rather than
    // taken once. Guarded because jsdom has no ResizeObserver, and the measure
    // above is already the whole answer where there is no layout.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [guesses])

  if (guesses.length === 0) return null

  const newestFirst = [...guesses].reverse()
  const hidden = guesses.length - onFirstRow

  return (
    <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'flex-start' }}>
      <Box
        ref={rowRef}
        sx={{
          display: 'flex', flexWrap: 'wrap', gap: 0.75, flex: 1, minWidth: 0,
          // Clamping is overflow, not unmounting: a hidden chip has to stay in
          // the layout, or measuring it would say it fits and the row would
          // flip between the two states forever.
          overflow: 'hidden',
          maxHeight: expanded ? 'none' : CHIP_H,
        }}
      >
        {newestFirst.map((g) => (
          <Chip
            key={g}
            size="small"
            label={displayName(g)}
            variant={g === secret ? 'filled' : 'outlined'}
            color={g === secret ? 'success' : 'default'}
            sx={{ height: CHIP_H, maxWidth: '100%' }}
          />
        ))}
      </Box>
      {/* Always in the layout, even with nothing to hide: a toggle that comes
        * and went would change the width of the row it is measuring, and the
        * row would hunt between "one chip over" and "fits". */}
      <Button
        size="small"
        variant="text"
        onClick={() => setExpanded((e) => !e)}
        sx={{
          minWidth: 62, height: CHIP_H, px: 0.75, flexShrink: 0,
          visibility: hidden > 0 || expanded ? 'visible' : 'hidden',
        }}
        aria-hidden={hidden > 0 || expanded ? undefined : true}
        tabIndex={hidden > 0 || expanded ? undefined : -1}
      >
        {expanded ? 'Fewer' : `+${hidden} more`}
      </Button>
    </Stack>
  )
}

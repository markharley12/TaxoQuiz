// How many guess chips fit on the first line, given where the browser put them.
//
// The guess list is a record, not the game: it grows by one chip a turn and on a
// phone a dozen guesses cost more vertical space than the tree they are about.
// So it is clamped to a single line with a toggle for the rest — and "a single
// line" has to be measured rather than counted, because the chips are names
// ("Grey wolf", "Lions mane jellyfish") and no fixed number of them is a line.
//
// The measurement is done on the natural wrapped layout: clamping is
// `overflow: hidden` on the container, which hides rows without moving them, so
// each chip's `offsetTop` still says which row it landed on.

/** Slack for sub-pixel offsets; chips on one line share an offsetTop exactly,
 *  but a fractional container position can round two of them apart. */
const ROW_TOLERANCE_PX = 1

/**
 * Number of leading items sharing the first row, given their `offsetTop`s in
 * DOM order.
 *
 * Stops at the first item that wrapped rather than counting matches: items are
 * in DOM order, so everything after the first wrap is below it — and in a
 * multi-row list a later row can share a top with nothing at all.
 *
 * Returns `tops.length` when nothing wrapped, which is also what jsdom (no
 * layout, every offsetTop 0) produces — i.e. "nothing is hidden", the right
 * answer where there is no screen.
 */
export function firstRowCount(tops: number[]): number {
  if (tops.length === 0) return 0
  const first = tops[0]
  let n = 0
  for (const top of tops) {
    if (top > first + ROW_TOLERANCE_PX) break
    n++
  }
  return n
}

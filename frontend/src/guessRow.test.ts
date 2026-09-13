/**
 * Tests for the guess row's one-line clamp.
 *
 * Each names the failure it guards, not the code: the point of measuring rather
 * than counting chips is that names are different lengths, and the point of
 * stopping at the first wrap is that a row below the first is not one row.
 */
import { describe, expect, it } from 'vitest'
import { firstRowCount } from './guessRow'

describe('firstRowCount', () => {
  it('counts every item when nothing wrapped', () => {
    expect(firstRowCount([0, 0, 0])).toBe(3)
  })

  it('is 0 for an empty row, so an empty list hides nothing', () => {
    expect(firstRowCount([])).toBe(0)
  })

  it('stops at the first item that wrapped', () => {
    expect(firstRowCount([0, 0, 30, 30])).toBe(2)
  })

  it('does not count a later item back onto the first row', () => {
    // Counting matches rather than stopping would let a third row that happens
    // to share nothing with the first still be scanned past the second — and
    // more importantly would count items the clamp is hiding as visible.
    expect(firstRowCount([0, 30, 0])).toBe(1)
  })

  it('tolerates a sub-pixel offset between chips on one line', () => {
    // A fractional container position rounds two chips on the same line apart;
    // treating that as a wrap would hide a chip that is plainly on screen.
    expect(firstRowCount([0, 0.5, 1])).toBe(3)
  })

  it('treats jsdom’s layout-free zeros as "everything fits"', () => {
    // Every offsetTop is 0 without layout. The answer there has to be "nothing
    // is hidden", or the component would render a "+3 more" toggle in a test
    // that never had a screen.
    expect(firstRowCount([0, 0, 0, 0, 0])).toBe(5)
  })
})

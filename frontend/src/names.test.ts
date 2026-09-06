import { describe, expect, it } from 'vitest'
import { displayName } from './names'

describe('displayName', () => {
  it('capitalises a lower-case vernacular name', () => {
    expect(displayName('lynx')).toBe('Lynx')
    expect(displayName('bobcat')).toBe('Bobcat')
  })

  it('capitalises only the first word', () => {
    // Sentence case, not title case: the convention is "Blue whale", and
    // `text-transform: capitalize` would give "Blue Whale".
    expect(displayName('blue whale')).toBe('Blue whale')
    expect(displayName('african wild dog')).toBe('African wild dog')
    expect(displayName('lions mane jellyfish')).toBe('Lions mane jellyfish')
  })

  it('leaves a taxon name alone', () => {
    // Taxon names arrive capitalised and must not be touched — a compressed
    // chain is several of them joined.
    expect(displayName('Felidae')).toBe('Felidae')
    expect(displayName('Felidae › Feliformia')).toBe('Felidae › Feliformia')
  })

  it('leaves the rest of the string exactly as it was', () => {
    // Only the first character changes. Anything else would be rewriting the
    // dataset's own words on screen.
    for (const name of ['california sea lion', 'Homo sapiens', 'e coli']) {
      expect(displayName(name).slice(1)).toBe(name.slice(1))
    }
  })

  it('passes through a name that does not start with a letter', () => {
    expect(displayName('???')).toBe('???')
    expect(displayName('3-toed sloth')).toBe('3-toed sloth')
  })

  it('handles the empty string rather than throwing', () => {
    // Reached wherever a label has not loaded yet.
    expect(displayName('')).toBe('')
  })
})

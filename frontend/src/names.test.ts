import { describe, expect, it } from 'vitest'
import { displayName, otherArticle } from './names'

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

describe('otherArticle', () => {
  it('names the article when it is about something else', () => {
    // An obsolete genus redirected to its one species: without the title the
    // popup reads as describing the wrong animal.
    expect(otherArticle('Lissonycteris', null, 'Angolan fruit bat')).toBe('Angolan fruit bat')
    expect(otherArticle('Oligoryzomys delticola', 'Delta Pygmy Rice Rat', 'Oligoryzomys nigripes'))
      .toBe('Oligoryzomys nigripes')
  })

  it('stays quiet when the article is the node itself', () => {
    expect(otherArticle('Panthera leo', 'lion', 'Lion')).toBeNull()
    expect(otherArticle('Felidae', null, 'Felidae')).toBeNull()
  })

  it('ignores punctuation, case and the extractor\'s suffixes', () => {
    // Otherwise most species would carry a note saying nothing.
    expect(otherArticle('Petrogale rothschildi', 'Rothschild’s Rock Wallaby',
      "Rothschild's rock-wallaby")).toBeNull()
    expect(otherArticle('Furcifer nicosiai', 'Chameleon (Furcifer nicosiai)', 'Chameleon')).toBeNull()
    expect(otherArticle('Mustela nivalis', 'weasel #2', 'Weasel')).toBeNull()
  })

  it('reads a title written with underscores', () => {
    expect(otherArticle('Ozotoceros', null, 'Pampas_deer')).toBe('Pampas deer')
  })

  it('says nothing without a title', () => {
    expect(otherArticle('Panthera leo', 'lion', undefined)).toBeNull()
    expect(otherArticle('Panthera leo', 'lion', '')).toBeNull()
  })
})

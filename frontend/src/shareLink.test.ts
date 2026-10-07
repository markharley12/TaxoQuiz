import { describe, expect, it } from 'vitest'
import { fingerprint } from './engine/seed'
import { getSpecies, type RawNode } from './engine/taxonomy'
import { SITES, seedFromSearch, shareBase, shareLink, siteForSeed } from './shareLink'
import exampleTree from '../../src/taxoquiz/data/example_tree.json?raw'
import fullTree from '../../data/wikidata-parents-fixed/tree.json?raw'

const TREES: Record<string, string> = { example: exampleTree, 'wikidata-parents-fixed': fullTree }

describe('SITES', () => {
  // A stale fingerprint sends someone to a site that then refuses their seed,
  // which is exactly the dead end the link exists to replace.
  for (const [name, text] of Object.entries(TREES)) {
    it(`pins ${name}'s real fingerprint`, () => {
      const tree: RawNode = JSON.parse(text)
      expect(SITES[name].fingerprint).toBe(fingerprint(getSpecies(tree)))
    })
  }
})

describe('shareBase', () => {
  it('links to the page itself on the web, without its query or index.html', () => {
    expect(shareBase('https://x.io/TaxoQuiz/full/index.html?seed=OLD#t', 'example'))
      .toBe('https://x.io/TaxoQuiz/full/')
  })

  it("uses the bundled dataset's public site inside the app", () => {
    // The app's own address is https://localhost/, useless on another phone.
    expect(shareBase(null, 'wikidata-parents-fixed')).toBe(SITES['wikidata-parents-fixed'].url)
  })

  it('has nothing to link to for an app with no public site', () => {
    expect(shareBase(null, 'some-local-scrape')).toBeNull()
  })
})

describe('shareLink and seedFromSearch', () => {
  it('round-trip a seed', () => {
    const link = shareLink('https://x.io/TaxoQuiz/', 'J3XF-ABC234')
    expect(link).toBe('https://x.io/TaxoQuiz/?seed=J3XF-ABC234')
    expect(seedFromSearch(new URL(link).search)).toBe('J3XF-ABC234')
  })

  it('reads no seed as null, not as an empty one', () => {
    expect(seedFromSearch('')).toBeNull()
    expect(seedFromSearch('?seed=')).toBeNull()
    expect(seedFromSearch('?seed=%20')).toBeNull()
  })
})

describe('siteForSeed', () => {
  it("finds the other site from a seed's tag, however it was typed", () => {
    expect(siteForSeed('08ny vmyv01', 'example')?.name).toBe('TaxoQuiz Full')
    expect(siteForSeed('J3XF-MQYQP3', 'wikidata-parents-fixed')?.name).toBe('TaxoQuiz')
  })

  it('never points a seed at the site it was entered on', () => {
    // That seed failed for some other reason; "go there" would be a loop.
    expect(siteForSeed('J3XF-MQYQP3', 'example')).toBeNull()
  })

  it('knows nothing of a seed from neither site', () => {
    expect(siteForSeed('ABCD-234567', 'example')).toBeNull()
  })
})

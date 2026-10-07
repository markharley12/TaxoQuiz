/**
 * A round shared as a link: `…/TaxoQuiz/?seed=J3XF-ABC234` opens straight into
 * that round. A bare seed has to be copied, the site found, and the code pasted
 * into the box on the front page; a link is one tap. The box stays, for a seed
 * read aloud.
 *
 * The website is two builds, and a seed only resolves on the dataset that made
 * it — its first four characters fingerprint the species list (see
 * engine/seed.ts). So a seed pasted into the wrong site is recognised here and
 * answered with a link to the right one, rather than only "different dataset".
 */

export interface Site {
  name: string
  url: string
  /** The seed tag of this site's dataset: `fingerprint()` of its species. */
  fingerprint: string
}

/**
 * The public builds, by the dataset each bundles. The fingerprints are pinned
 * against the datasets themselves by shareLink.test.ts, so a rebuild that
 * changes either species list fails a test instead of sending people to a site
 * that rejects their seed.
 */
export const SITES: Record<string, Site> = {
  example: {
    name: 'TaxoQuiz',
    url: 'https://markharley12.github.io/TaxoQuiz/',
    fingerprint: 'J3XF',
  },
  'wikidata-parents-fixed': {
    name: 'TaxoQuiz Full',
    url: 'https://markharley12.github.io/TaxoQuiz/full/',
    fingerprint: '08NY',
  },
}

/**
 * What a link to a round of this build starts with. On the web, the page
 * itself, so a dev server or a copy hosted elsewhere links to itself. In the
 * Android app the page is `https://localhost/`, which means nothing on anyone
 * else's phone, so it is the public site for the bundled dataset — or null if
 * there is none, and the bare seed is shared instead.
 *
 * @param page `location.href` on the web; null inside the app.
 */
export function shareBase(page: string | null, dataset: string): string | null {
  if (page === null) return SITES[dataset]?.url ?? null
  const url = new URL(page)
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/index\.html$/, '')
  return url.href
}

export function shareLink(base: string, seed: string): string {
  const url = new URL(base)
  url.searchParams.set('seed', seed)
  return url.href
}

/** The seed a link carries, or null. Validity is the engine's business. */
export function seedFromSearch(search: string): string | null {
  const seed = new URLSearchParams(search).get('seed')?.trim()
  return seed ? seed : null
}

/** The other public site this seed belongs to, if it belongs to one. */
export function siteForSeed(seed: string, dataset: string): Site | null {
  const tag = seed.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 4)
  for (const [name, site] of Object.entries(SITES)) {
    if (name !== dataset && site.fingerprint === tag) return site
  }
  return null
}

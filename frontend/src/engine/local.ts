/**
 * The example dataset, loaded on the device.
 *
 * The files are the ones the Python package ships — `src/taxoquiz/data/` —
 * referenced in place rather than copied into the frontend, so there is one
 * copy of the example and nothing to fall out of step with it.
 *
 * Fetched by URL rather than `import`ed, for three reasons. As a module the
 * 1.8MB of JSON would sit inside the app's own bundle and be parsed before the
 * first paint; the taxon text is only wanted once a popup opens, so it should
 * not be paid for until then; and `tsc` would infer a literal type for every
 * node of a 630KB tree. Vite emits each file as a hashed asset instead, which
 * works the same from a dev server, a static host, and a phone's local assets.
 */
import treeUrl from '../../../src/taxoquiz/data/example_tree.json?url'
import infoUrl from '../../../src/taxoquiz/data/example_taxon_info.json?url'
import type { StoredTaxonInfo } from './taxon'
import type { RawNode } from './taxonomy'

export const EXAMPLE = 'example'

/** Fetch once and share the result. A failure is not kept: on a phone the
 *  next attempt may well have signal, and a cached rejection would end the
 *  session over one dropped request. */
function once<T>(url: string): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    if (pending === null) {
      pending = fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`Could not load ${url}`)
          return res.json() as Promise<T>
        })
        .catch((e) => {
          pending = null
          throw e
        })
    }
    return pending
  }
}

export const exampleTree = once<RawNode>(treeUrl)
export const exampleInfo = once<Record<string, StoredTaxonInfo>>(infoUrl)

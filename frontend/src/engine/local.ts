/**
 * The dataset bundled with this build, loaded on the device.
 *
 * Which dataset that is gets decided at build time. `VITE_BUNDLED_DATASET`
 * unset is the example the Python package ships — the website, and the ordinary
 * app. Set it to a scrape under `data/` and the build carries that instead:
 * the large "TaxoQuiz Full" app, which is only buildable on a machine holding
 * the scrape. `vite.config.ts` points the `@bundle/*` imports at the right files;
 * nothing here knows which it got.
 *
 * The files are referenced in place rather than copied into the frontend, so
 * there is one copy of each dataset and nothing to fall out of step with it.
 *
 * Fetched by URL rather than `import`ed, for three reasons. As a module the JSON
 * would sit inside the app's own bundle and be parsed before the first paint;
 * the taxon text is only wanted once a popup opens, so it should not be paid for
 * until then — which matters at 43MB for a full scrape; and `tsc` would infer a
 * literal type for every node. Vite emits each file as a hashed asset instead,
 * which loads the same from a dev server, a static host, and a phone.
 */
import treeUrl from '@bundle/tree.json?url'
import infoUrl from '@bundle/taxon_info.json?url'
import type { StoredTaxonInfo } from './taxon'
import type { RawNode } from './taxonomy'

/** The name the bundled dataset answers to: what `api.ts` routes to the device,
 *  and what keys the taxon cache and the dataset picker. */
export const BUNDLED = import.meta.env.VITE_BUNDLED_DATASET || 'example'

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

export const bundledTree = once<RawNode>(treeUrl)
export const bundledInfo = once<Record<string, StoredTaxonInfo>>(infoUrl)

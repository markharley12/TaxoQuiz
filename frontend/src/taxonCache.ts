// One client-side cache of taxon info, shared by everything that shows any.
//
// It exists because the same lookup now has three callers — the popup, the
// hover preview and the thumbnail on the node box — and without it hovering a
// node you had already opened would ask again. It also makes the thumbnails
// possible at all: a node can only show a picture if something already knows
// its URL.
//
// Worth being clear about what is expensive here. `/taxon/{name}` is our own
// API reading an in-memory dict, not a call to Wikipedia; what comes from
// Wikimedia is the image itself, and only when an <img> points at it. So the
// cache saves a cheap round trip, and the reason not to prefetch everything is
// the pictures, not the JSON.
import { useSyncExternalStore } from 'react'
import { fetchTaxonInfo, type TaxonInfo } from './api'

// `null` means "asked, and there is no article" — a real answer for ~3% of
// nodes, cached as firmly as a hit so hovering them does not ask again.
// `undefined` from `cachedTaxonInfo` means nobody has asked yet.
const cache = new Map<string, TaxonInfo | null>()
const inflight = new Map<string, Promise<TaxonInfo | null>>()
const listeners = new Set<() => void>()
let version = 0

export function cachedTaxonInfo(name: string): TaxonInfo | null | undefined {
  return cache.get(name)
}

export function loadTaxonInfo(name: string): Promise<TaxonInfo | null> {
  const known = cache.get(name)
  if (known !== undefined || cache.has(name)) return Promise.resolve(known ?? null)

  const pending = inflight.get(name)
  if (pending) return pending

  const request = fetchTaxonInfo(name).then(
    (info) => {
      cache.set(name, info)
      inflight.delete(name)
      version++
      for (const listener of listeners) listener()
      return info
    },
    () => {
      // A transient failure is deliberately not cached, so the next hover
      // retries rather than the node being permanently blank.
      inflight.delete(name)
      return null
    },
  )
  inflight.set(name, request)
  return request
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const snapshot = () => version

/** Re-render when anything lands in the cache. */
export function useTaxonCache(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

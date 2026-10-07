// The service worker: what lets TaxoQuiz open with no connection once it has
// been visited, and so what makes "Add to Home Screen" behave like an app.
//
// Written by hand rather than generated, and kept small on purpose. The build
// (`serviceWorker()` in vite.config.ts) fills in VERSION and FILES — a hash of
// the build and the list of every file in it — and emits this as dist/sw.js.
//
// One rule decides everything below: **a page is always exactly one build.**
// Files are named by content hash, and a deploy replaces all of them at once, so
// an index.html from one build asking for a script from another finds nothing.
// Hence:
//
// - Everything is served cache-first, index.html included. A page opened from
//   the cache is the build that was cached, whole.
// - A new build is fetched in the background when the browser notices sw.js
//   changed, and **waits** — no skipWaiting() — until every page of the old one
//   is closed. Taking over a page mid-round would delete the cache under it,
//   and its next lazy load (the taxon text, on first popup) would 404 against a
//   site that no longer has that file.
// - The old cache is deleted only on activate, by which time nothing uses it.
//
// So an update reaches a player the second time they open the app after a
// deploy, not the first. That is the price of never breaking a round in play.
//
// Not cached: anything not in this build. See the end of the fetch handler.

const VERSION = 'dev'
const FILES = []
// Cached the first time they are asked for rather than on install: the taxon
// text, which is only wanted once a popup opens, and which is 43MB for the full
// scrape — precaching that would fill a phone that only came to play a round.
const LAZY = []

// Two builds share this origin — the example at the site root and the full
// scrape under full/ — and caches belong to the origin, not the scope. So a
// cache is named for its scope, and activate deletes only its own scope's old
// versions. One shared prefix had each build deleting the other's cache.
const SCOPE = self.registration.scope
const PREFIX = `taxoquiz-${new URL(SCOPE).pathname}-`
const CACHE = PREFIX + VERSION
// What builds before the split called their caches. Only the root build ever
// made these, so deleting them on activate is that build cleaning up after
// itself, whichever scope gets there first.
const LEGACY = /^taxoquiz-([0-9a-f]{12}|dev)$/

const url = (name) => new URL(name, SCOPE).href
const PRECACHED = new Set(FILES.map(url))
const LAZILY = new Set(LAZY.map(url))

// The one exception to waiting. A worker from before the split answers every
// navigation in its scope with its own index.html — including full/, which it
// leaves a blank page asking for scripts that are not there, and which stays
// blank until every TaxoQuiz tab is closed. Seen on the live site the day full/
// went up. So when this worker finds that worker's cache, it takes over at once
// and reloads any page it was breaking. The cost, once: an old tab of the
// example mid-round loses its popups until reloaded, as its taxon text is gone.
const replacingLegacy = () => caches.keys().then((keys) => keys.some((key) => LEGACY.test(key)))

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(replacingLegacy)
      .then((legacy) => legacy && self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    replacingLegacy().then(async (legacy) => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => (key.startsWith(PREFIX) && key !== CACHE) || LEGACY.test(key))
          .map((key) => caches.delete(key)),
      )
      if (!legacy) return
      await self.clients.claim()
      const windows = await self.clients.matchAll({ type: 'window' })
      // Every page in scope but our own was being served our index.html.
      // Started and NOT awaited: a navigation's request is held until this
      // worker has activated, and activation would be waiting on the
      // navigation — a deadlock that froze every tab on the origin.
      for (const client of windows) {
        const page = client.url.split(/[?#]/)[0]
        if (page !== SCOPE && page !== url('index.html')) client.navigate(client.url).catch(() => {})
      }
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const target = new URL(request.url)
  target.search = ''
  const href = target.href

  // The page itself, under either of the names it is reached by. Only those:
  // this scope contains full/, and answering *every* navigation with our
  // index.html served the example to anyone opening the full build, whose own
  // worker then never got the chance to register.
  if (request.mode === 'navigate') {
    if (href !== SCOPE && href !== url('index.html')) return
    event.respondWith(caches.open(CACHE).then((cache) => cache.match('index.html')).then((hit) => hit ?? fetch(request)))
    return
  }

  if (PRECACHED.has(href)) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(request)).then((hit) => hit ?? fetch(request)))
  } else if (LAZILY.has(href)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const res = await fetch(request)
        // A failure is not kept, so a later popup with signal tries again.
        if (res.ok) await cache.put(request, res.clone())
        return res
      }),
    )
  }
  // Anything else — other origins (the Wikimedia pictures, which carry their
  // own licences and would fill the phone), the /api probe, which must fail
  // offline so the app plays its bundled data — goes to the network untouched.
})

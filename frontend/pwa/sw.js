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
// Not cached: other origins (the Wikimedia pictures, which carry their own
// licences and would fill the phone), and anything not in the build, such as
// the `/api` probe, which must fail offline so the app plays the example.

const VERSION = 'dev'
const FILES = []
const CACHE = `taxoquiz-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith('taxoquiz-') && key !== CACHE).map((key) => caches.delete(key))),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  // Every navigation within scope is the one page there is.
  const key = request.mode === 'navigate' ? 'index.html' : request
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(key, { ignoreSearch: request.mode === 'navigate' }))
      .then((hit) => hit ?? fetch(request)),
  )
})

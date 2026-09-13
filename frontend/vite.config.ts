import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Emit dist/sw.js: pwa/sw.js with this build's file list and a version hash
 *  written in. See that file for how it caches and why it waits. */
function serviceWorker(): Plugin {
  return {
    name: 'taxoquiz-service-worker',
    apply: 'build',
    generateBundle: {
      // After Vite has emitted index.html, so it is in the bundle to be listed.
      order: 'post',
      handler(_, bundle) {
        const built = Object.keys(bundle).filter((name) => !name.endsWith('.map')).sort()
        const copied = readdirSync(here('public')).sort()
        const hash = createHash('sha256')
        for (const name of built) {
          const out = bundle[name]
          hash.update(name).update(out.type === 'asset' ? out.source : out.code)
        }
        for (const name of copied) hash.update(name).update(readFileSync(here(`public/${name}`)))

        let source = readFileSync(here('pwa/sw.js'), 'utf8')
        const fills: [string, string][] = [
          ["const VERSION = 'dev'", `const VERSION = '${hash.digest('hex').slice(0, 12)}'`],
          ['const FILES = []', `const FILES = ${JSON.stringify([...built, ...copied].sort())}`],
        ]
        for (const [from, to] of fills) {
          // Loud rather than quietly shipping a worker that caches nothing.
          if (!source.includes(from)) throw new Error(`pwa/sw.js no longer contains: ${from}`)
          source = source.replace(from, to)
        }
        this.emitFile({ type: 'asset', fileName: 'sw.js', source })
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],
  // Relative, so one build works wherever it is put: at a domain's root, under
  // GitHub Pages' /TaxoQuiz/, and inside the Android app. An absolute '/' left
  // the Pages site blank — every script requested from the domain root, where
  // there is nothing.
  base: './',
  server: {
    host: true,
    // Vite refuses a request whose Host header it does not recognise, which is
    // DNS-rebinding protection and right by default — but it means the dev
    // server answers on a Tailscale *IP* and rejects the MagicDNS *name* for
    // the same machine, with "Blocked request. This host is not allowed."
    // Reaching it from a phone is the ordinary reason to be off localhost, so
    // the whole tailnet namespace is allowed. The leading dot covers
    // subdomains, and `.ts.net` is Tailscale's own: a name in it only resolves
    // inside your tailnet, which is what makes it safe to name here.
    allowedHosts: ['.ts.net'],
    // The example dataset is read from the Python package's own copy in
    // `src/taxoquiz/data/`, one level above this project, rather than
    // duplicated into it (see src/engine/local.ts). Vite serves nothing outside
    // its root by default, so without this the dev server answers that request
    // with a 403 and the game has no tree — while the build, which does not
    // apply the rule, works fine.
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    // The default warning is 500 kB and it fires on the UNCOMPRESSED bundle,
    // which is not what anyone downloads. Measured: 600 kB minified is 186 kB
    // gzipped for React 19, MUI and react-d3-tree together, and nothing here
    // is dead weight — everything but ExploreTree is on the first paint.
    //
    // So this is not a splitting problem, and a build that warns on every run
    // just trains you to stop reading build output. Re-measure before raising
    // it again: this number is a measurement, not a preference.
    chunkSizeWarningLimit: 700,
  },
  // jsdom rather than node: almost everything under test reads a browser API —
  // localStorage in settings, matchMedia in media, getBBox in framing — and the
  // interesting cases are the ones where those are missing or throw, which can
  // only be arranged if they exist to begin with.
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    // .tsx too, since the component tests are JSX. Without it App.test.tsx
    // is silently not run — it does not fail, it simply never appears.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})

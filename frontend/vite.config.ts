import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
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

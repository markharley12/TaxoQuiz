import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
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
    include: ['src/**/*.test.ts'],
  },
})

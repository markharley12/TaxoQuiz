import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, CssBaseline } from '@mui/material'
// Bundled, not fetched from a CDN: the app is meant to work with no network
// beyond the taxon pictures, and a webfont <link> would have made the way it
// looks depend on one. Variable faces, so every weight is one file.
//
// The build emits every subset — Cyrillic, Greek, Vietnamese — which looks
// wasteful in the output listing and is not: each @font-face carries a
// `unicode-range`, so a reader of Latin text downloads the Latin file and
// nothing else. About 85KB for the pair, not the 250KB the listing suggests.
import '@fontsource-variable/fraunces'
import '@fontsource-variable/inter'
import App from './App'
import { theme } from './theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, CssBaseline, createTheme } from '@mui/material'
import App from './App'

// The app is designed light: GameTree paints nodes on white and the react-d3-tree
// links are dark strokes. Without this the body has no background at all and the
// browser's own canvas shows through, so a dark-mode browser renders dark-on-dark.
// Pinning the palette keeps the app looking the same whatever the OS is set to.
const theme = createTheme({ palette: { mode: 'light' } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
)

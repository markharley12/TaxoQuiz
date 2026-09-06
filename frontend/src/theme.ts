// The app's look, in one place.
//
// The subject is a nineteenth-century one — a tree of life, drawn from named
// clades — so the design is a field guide rather than a dashboard: warm paper
// instead of white, ink instead of black, a serif for the names and a sans for
// the controls. That is not decoration for its own sake. A taxonomy is mostly
// *words*, and the previous build set every one of them in the browser's
// fallback Helvetica at one weight, which is why it read as a form rather than
// as something to look at.
//
// **The accent is blue on purpose, and must not be green or red.** Depth is
// encoded as a red-to-green ramp across every node in both trees (see
// colors.ts), and that ramp is the one thing on screen carrying meaning. An
// accent anywhere inside it would read as a score. Ink blue sits outside the
// ramp entirely, and is what a plate caption would have been printed in anyway.
//
// **Fonts are bundled, not fetched.** @fontsource ships the woff2 files into
// the build, so the app still looks like itself with no network — which is the
// same property that makes the bundled example dataset worth having. A
// Google Fonts <link> would have undone that for a stylesheet.
import { createTheme, alpha } from '@mui/material'

// Warm neutrals. `paper` is the page, `card` the things sitting on it — the
// reverse of the usual white-card-on-grey, because the tree canvas wants to be
// the brightest thing on screen and everything else should recede.
export const INK = '#2c2620'
export const INK_MUTED = '#6f6357'
export const PAPER = '#f4f0e8'
export const CARD = '#fffdf9'
export const LINE = '#ded5c6'
export const ACCENT = '#3f5573'

// Tree connectors. Hairline and warm-grey rather than the library's near-black:
// on a wide fan-out the links are most of the ink on screen, and at full black
// they read as the subject rather than as the joins between the nodes that are.
export const TREE_LINK = alpha(INK, 0.28)

const display = '"Fraunces Variable", "Iowan Old Style", Georgia, serif'
const ui = '"Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif'

export const FONT_DISPLAY = display
export const FONT_UI = ui

export const theme = createTheme({
  // Pinned light, as before: both trees paint nodes on a light ground and the
  // link colour above assumes it. Real dark mode means giving the trees a
  // second palette, not flipping this flag.
  palette: {
    mode: 'light',
    primary: { main: ACCENT, contrastText: '#fff' },
    background: { default: PAPER, paper: CARD },
    text: { primary: INK, secondary: INK_MUTED },
    divider: LINE,
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: ui,
    // Fraunces has an optical-size axis, so the display sizes get the tighter
    // tracking that large settings want and the small ones do not.
    h1: { fontFamily: display, fontWeight: 600, letterSpacing: '-0.02em' },
    h2: { fontFamily: display, fontWeight: 600, letterSpacing: '-0.02em' },
    h3: { fontFamily: display, fontWeight: 600, letterSpacing: '-0.015em' },
    h4: { fontFamily: display, fontWeight: 600, letterSpacing: '-0.015em' },
    h5: { fontFamily: display, fontWeight: 600 },
    h6: { fontFamily: display, fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    body1: { lineHeight: 1.6 },
    body2: { lineHeight: 1.6 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: PAPER, color: INK },
        // The scrollbar is on screen the whole time in explore; the default
        // wide grey one fights a page this quiet.
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-thumb': {
          background: alpha(INK, 0.2), borderRadius: 8,
          border: '2px solid transparent', backgroundClip: 'padding-box',
        },
        '*::-webkit-scrollbar-thumb:hover': { background: alpha(INK, 0.32), backgroundClip: 'padding-box' },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 999, paddingInline: 18 },
        outlined: { borderColor: LINE, '&:hover': { borderColor: ACCENT, background: alpha(ACCENT, 0.05) } },
        text: { '&:hover': { background: alpha(ACCENT, 0.07) } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500, borderRadius: 999 },
        outlined: { borderColor: LINE },
        filled: { background: alpha(INK, 0.06), color: INK },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          background: CARD,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: LINE },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: alpha(INK, 0.35) },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        // A hairline instead of a drop shadow: on a warm ground, MUI's default
        // elevation reads as grey haze rather than as lift.
        outlined: { borderColor: LINE },
        elevation: { boxShadow: `0 1px 2px ${alpha(INK, 0.05)}, 0 8px 24px ${alpha(INK, 0.08)}` },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { background: alpha(INK, 0.92), fontSize: 12, fontWeight: 500, borderRadius: 6 },
      },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 14 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
  },
})

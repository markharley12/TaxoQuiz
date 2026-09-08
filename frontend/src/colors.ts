// The colour scale, shared by the game tree and the explore tree.
//
// It takes a `warmth` in 0..1 that the API computes from a node's taxonomic
// RANK — kingdom 0.00, phylum 0.17, class 0.33, order 0.50, family 0.67,
// genus 0.83, species 1.00 — and turns it into a colour. See
// src/taxoquiz/ranks.py for the ladder and for how unranked clades are placed.
//
// It is deliberately ABSOLUTE: a rank is always the same colour, so a node
// never changes colour because of a later guess. A relative scale rescaled on
// every guess, and rendered a set of equally-cold guesses mid-gradient instead
// of red.
//
// It is also absolute ACROSS DATASETS, which the old scale could not be. That
// one divided an LCA's *depth* by a per-dataset anchor, and depth is not
// comparable between lineages: measured on the 41,167-species scrape, a
// same-family guess scored anywhere from 0.10 to 1.00 depending on the branch
// it was in, and a winning guess had a median of 0.49 — olive — so over half of
// all games could never look warm however well they were played. Rank means the
// same thing everywhere, and a correct guess is a species-level match, so every
// game can now reach the green end.
//
// Not normalised against the secret's own rank or depth, though that would give
// tidier warmth: it would leak where the secret sits, which the ??? node exists
// to hide. That is also why the ??? node is coloured with its parent's warmth
// rather than its own rank — see game_state.py.
//
// Explore mode reuses it unchanged, where it reads as age rather than warmth:
// red is ancient, green is recent. Same scale, so a clade looks the same colour
// whichever mode you meet it in.
//
// Which scheme is in force is a browser-local preference — see `settings.ts`.
// It changes only how far the hue sweeps, so everything above still holds.

// The scale is a sweep through hue, so a scheme is just how far it sweeps.
// Both start at red, because "far away / ancient" reading as red is the part
// people already know from the game; only the far end differs.
export const COLOR_SCHEMES = {
  warmth: { label: 'Warmth', hint: 'red → green', hueSpan: 120 },
  rainbow: { label: 'Rainbow', hint: 'red → violet', hueSpan: 280 },
} as const

export type ColorScheme = keyof typeof COLOR_SCHEMES

export const DEFAULT_COLOR_SCHEME: ColorScheme = 'warmth'

// Saturation and lightness are functions of the hue, not constants, and that is
// what stops the ramp looking like raw HSL.
//
// At a fixed lightness, yellow reads far brighter than red or green at the same
// number — so a red→green sweep held at 70%/35% went acid at the ends and
// mustard through the middle, which is where most of a game's nodes actually
// sit. Darkening around 60° and easing the saturation off turns that middle
// into moss and leaves the ends as brick and forest: the same ordering, the
// same absolute meaning, in colours that belong beside each other.
//
// Nothing about the *scale* changed — same t, same hue span, same clamp — so a
// given rank is still always the same colour and the schemes still differ only
// in how far the hue sweeps.
//
// Saturation rises with warmth, and that is the second channel rather than
// decoration. An absolute scale is right (see above) but it has a consequence
// that only shows up on screen: any one view spans a narrow band, so every
// screen is nearly monochrome. Measured on the example, a game four guesses in
// used 32 degrees of the 120 available — seven nodes, all green — and explore's
// opening screen used 16, all brick. Hue alone therefore separates almost
// nothing *within* a view, which is the only place anyone reads it.
//
// So broad reads faded and narrow reads vivid: an ancient clade recedes, and
// the closest guess is the most saturated thing on the page. That ordering is
// still absolute — same rank, same colour, nothing about the secret leaks —
// and it survives a narrow band, because saturation moves even where hue
// barely does.
function ramp(t: number, hueSpan: number): string {
  const hue = t * hueSpan
  const yellowness = Math.exp(-(((hue - 60) / 45) ** 2))
  const light = 0.40 - 0.11 * yellowness
  const sat = 0.30 + 0.22 * t
  return `hsl(${Math.round(hue)}, ${Math.round(sat * 100)}%, ${Math.round(light * 100)}%)`
}

export function makeColorScale(scheme: ColorScheme = DEFAULT_COLOR_SCHEME) {
  const { hueSpan } = COLOR_SCHEMES[scheme] ?? COLOR_SCHEMES[DEFAULT_COLOR_SCHEME]
  return (warmth: number): string => {
    // Clamped rather than trusted: warmth arrives over HTTP, and a NaN from a
    // missing field would otherwise reach hsl() and paint nothing at all.
    const t = Math.min(Math.max(warmth || 0, 0), 1)
    return ramp(t, hueSpan)
  }
}

/** The same hue as a pale wash, for the background of a card that carries a
 *  spine of the full colour.
 *
 * Clades used to be *filled* with the scale — 200x56 of solid green or red per
 * node — which made the least informative thing on screen the loudest, and left
 * a game reading as a wall of green boxes rather than as a tree. The colour now
 * arrives as a spine down the leading edge, and this is the whisper of it that
 * tells an ancestor on the secret's path from ordinary context. Light enough to
 * set ink on: the label is read, not the box.
 */
export function makeTintScale(scheme: ColorScheme = DEFAULT_COLOR_SCHEME) {
  const { hueSpan } = COLOR_SCHEMES[scheme] ?? COLOR_SCHEMES[DEFAULT_COLOR_SCHEME]
  return (warmth: number): string => {
    const t = Math.min(Math.max(warmth || 0, 0), 1)
    const hue = t * hueSpan
    // Deeper gets a touch more colour, for the same reason the ramp does, but
    // the whole range stays inside a few points of lightness so no wash ever
    // competes with the spine beside it.
    return `hsl(${Math.round(hue)}, ${Math.round((0.26 + 0.16 * t) * 100)}%, ${Math.round((0.945 - 0.035 * t) * 100)}%)`
  }
}

/** The whole scheme as a CSS gradient, so the settings menu can show it. */
export function schemeGradient(scheme: ColorScheme): string {
  const scale = makeColorScale(scheme)
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => scale(t))
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

import { describe, expect, it } from 'vitest'
import {
  COLOR_SCHEMES,
  DEFAULT_COLOR_SCHEME,
  makeColorScale,
  makeTintScale,
  schemeGradient,
  type ColorScheme,
} from './colors'

/** hsl(H, S%, L%) -> [H, S, L]. Throws rather than returning NaN, because a
 *  colour the browser cannot parse is exactly the bug these tests exist for. */
function hsl(color: string): [number, number, number] {
  const m = /^hsl\((\d+), (\d+)%, (\d+)%\)$/.exec(color)
  if (!m) throw new Error(`not a parseable hsl colour: ${color}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

const SCHEMES = Object.keys(COLOR_SCHEMES) as ColorScheme[]

// The warmths the API actually sends, from src/taxoquiz/ranks.py. Named here
// because the tests below are about how a *rank* looks, not about arithmetic.
const KINGDOM = 0
const PHYLUM = 1 / 6
const CLASS = 2 / 6
const ORDER = 3 / 6
const FAMILY = 4 / 6
const GENUS = 5 / 6
const SPECIES = 1

describe('makeColorScale', () => {
  it('is absolute: a rank maps to one colour regardless of what else is asked', () => {
    // The property the relative scale broke — a node must not change colour
    // because of a *later* guess. Two independently built scales have to agree,
    // and asking about other warmths must not perturb either.
    const a = makeColorScale()
    const b = makeColorScale()
    b(KINGDOM); b(ORDER); b(GENUS); b(SPECIES)
    for (const w of [KINGDOM, PHYLUM, ORDER, GENUS, SPECIES]) expect(a(w)).toBe(b(w))
  })

  it('gives a rank the same colour in every dataset', () => {
    // The reason the scale moved from depth to rank. The old one divided depth
    // by a per-dataset anchor — 15 for the example, 68 for the scrape — so the
    // same taxonomic fact came out a different colour in each, and a
    // same-family guess measured anywhere from 0.10 to 1.00 across branches of
    // one tree. There is no anchor to pass now, which is what makes that
    // impossible rather than merely fixed.
    expect(makeColorScale().length).toBe(1)   // (warmth) => string, nothing else
    expect(makeColorScale()(GENUS)).toBe(makeColorScale()(GENUS))
  })

  it('does not collapse to mid-gradient when every guess is equally cold', () => {
    // The old relative scale normalised between the shallowest and deepest
    // guess on screen, so min === max fell back to t = 0.5 and a set of
    // uniformly cold guesses rendered olive. A broad rank must read as red.
    const [hue] = hsl(makeColorScale()(PHYLUM))
    expect(hue).toBeLessThan(COLOR_SCHEMES.warmth.hueSpan / 4)
  })

  it('sweeps from red at the kingdom to the far end of the scheme at the species', () => {
    for (const scheme of SCHEMES) {
      expect(hsl(makeColorScale(scheme)(KINGDOM))[0]).toBe(0)
      expect(hsl(makeColorScale(scheme)(SPECIES))[0]).toBe(COLOR_SCHEMES[scheme].hueSpan)
    }
  })

  it('lets a won game reach the green end, which a depth scale could not', () => {
    // The headline of the change. A correct guess has the secret itself as the
    // LCA, so it is a species-level match and scores 1.0 in every game. Under
    // the depth scale a winning guess scored the secret's own depth over the
    // dataset anchor: a median of 0.49 on the scrape, olive, with only 26% of
    // games able to reach 0.9 at all.
    expect(hsl(makeColorScale('warmth')(SPECIES))[0]).toBe(COLOR_SCHEMES.warmth.hueSpan)
  })

  it('clamps past the species end rather than running off the hue circle', () => {
    // Without the clamp a hue over 360 wraps back to red and the closest
    // matches would read as the coldest.
    const scale = makeColorScale()
    expect(scale(1.5)).toBe(scale(SPECIES))
    expect(scale(1000)).toBe(scale(SPECIES))
  })

  it('clamps below the kingdom too', () => {
    // Ranks above kingdom sit below 0 on the ladder — everything in a dataset
    // rooted at Animalia shares the kingdom, so that is the floor.
    const scale = makeColorScale()
    expect(scale(-5)).toBe(scale(KINGDOM))
  })

  it('is monotonic in hue across the whole range', () => {
    for (const scheme of SCHEMES) {
      const scale = makeColorScale(scheme)
      let previous = -1
      for (let i = 0; i <= 60; i++) {
        const [hue] = hsl(scale(i / 60))
        expect(hue).toBeGreaterThanOrEqual(previous)
        previous = hue
      }
    }
  })

  it('paints red rather than nothing when a node arrives with no warmth', () => {
    // warmth comes over HTTP. An older API, a cached response or a node type
    // that forgot the field yields undefined, and `undefined / 1` is NaN, which
    // reaches hsl() and paints nothing at all — every node invisible.
    for (const missing of [undefined, NaN, null]) {
      expect(makeColorScale()(missing as unknown as number)).toBe(makeColorScale()(0))
    }
  })

  it('paints a real colour for an unknown scheme name', () => {
    // localStorage can hold a scheme an older build shipped. settings.ts
    // validates, but the scale is the last line of defence: `undefined` here
    // used to reach the ramp and paint every node hsl(NaN, ...), i.e. nothing.
    const rogue = 'chartreuse' as ColorScheme
    expect(makeColorScale(rogue)(0.5)).toBe(makeColorScale(DEFAULT_COLOR_SCHEME)(0.5))
  })

  it('emits only parseable hsl right across the ladder', () => {
    const scale = makeColorScale()
    for (let i = 0; i <= 100; i++) expect(() => hsl(scale(i / 100))).not.toThrow()
  })
})

describe('the ramp', () => {
  it('darkens through the yellows, so the middle is moss rather than mustard', () => {
    // Saturation and lightness are functions of hue. At a fixed lightness,
    // yellow reads far brighter than the ends — which is where most of a game's
    // nodes sit. Hue 60 must come out darker than both hue 0 and hue 120.
    const scale = makeColorScale('warmth')
    const [, , lightAtRed] = hsl(scale(0))
    const [, , lightAtYellow] = hsl(scale(0.5))
    const [, , lightAtGreen] = hsl(scale(1))
    expect(lightAtYellow).toBeLessThan(lightAtRed)
    expect(lightAtYellow).toBeLessThan(lightAtGreen)
  })

  it('stays well short of full saturation, so nothing reads as acid', () => {
    const scale = makeColorScale()
    for (let i = 0; i <= 60; i++) {
      const [, sat] = hsl(scale(i / 60))
      expect(sat).toBeLessThanOrEqual(52)
    }
  })

  it('fades the broad end and saturates the narrow one', () => {
    // The second channel, and the reason it exists: an absolute scale means any
    // one screen spans a narrow band, so hue alone separates almost nothing
    // *within* a view — measured at 32 degrees of 120 for a game four guesses
    // in, and 16 for explore's opening screen. Saturation moves where hue
    // barely does.
    const scale = makeColorScale()
    let previous = -1
    for (let i = 0; i <= 60; i++) {
      const [, sat] = hsl(scale(i / 60))
      expect(sat).toBeGreaterThanOrEqual(previous)
      previous = sat
    }
    expect(hsl(scale(1))[1] - hsl(scale(0))[1]).toBeGreaterThanOrEqual(15)
  })

  it('separates the ranks a real game lands on', () => {
    // The band an actual game occupies. Playing lion and guessing tiger, grey
    // wolf and earthworm puts nodes on order, family, subfamily, genus and
    // species — adjacent rungs, which must not collapse into one colour.
    const scale = makeColorScale()
    const seen = new Set([ORDER, FAMILY, 4.3 / 6, GENUS, SPECIES].map(scale))
    expect(seen.size).toBe(5)
  })
})

describe('makeTintScale', () => {
  it('is the same hue as the outline scale, only lighter', () => {
    // A clade carries a spine of the scale over a wash of the tint. They must
    // agree on hue or the same rank reads as two different colours depending on
    // what kind of node carries it.
    const scale = makeColorScale()
    const tint = makeTintScale()
    for (const w of [KINGDOM, CLASS, FAMILY, SPECIES]) {
      const [hueOutline, , lightOutline] = hsl(scale(w))
      const [hueFill, , lightFill] = hsl(tint(w))
      expect(hueFill).toBe(hueOutline)
      expect(lightFill).toBeGreaterThanOrEqual(lightOutline)
    }
  })

  it('is lighter strictly, somewhere a fill can be told from an edge', () => {
    const scale = makeColorScale()
    const tint = makeTintScale()
    const lighter = [KINGDOM, CLASS, FAMILY, SPECIES].filter(
      (w) => hsl(tint(w))[2] > hsl(scale(w))[2],
    )
    expect(lighter.length).toBeGreaterThan(0)
  })

  it('clamps and survives a missing warmth exactly as the outline scale does', () => {
    expect(makeTintScale()(1000)).toBe(makeTintScale()(SPECIES))
    expect(makeTintScale()(undefined as unknown as number)).toBe(makeTintScale()(0))
  })
})

describe('schemeGradient', () => {
  it('renders a five-stop CSS gradient for the settings menu', () => {
    for (const scheme of SCHEMES) {
      const gradient = schemeGradient(scheme)
      expect(gradient.startsWith('linear-gradient(90deg, ')).toBe(true)
      expect(gradient.match(/hsl\(/g)).toHaveLength(5)
    }
  })

  it('distinguishes the schemes by where they end', () => {
    expect(schemeGradient('warmth')).not.toBe(schemeGradient('rainbow'))
  })
})

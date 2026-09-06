import { describe, expect, it } from 'vitest'
import {
  COLOR_SCHEMES,
  DEFAULT_COLOR_SCHEME,
  FALLBACK_ANCHOR_DEPTH,
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

describe('makeColorScale', () => {
  it('is absolute: a depth maps to one colour regardless of what else is asked', () => {
    // The property the relative scale broke — a node must not change colour
    // because of a *later* guess. Two independently built scales for the same
    // anchor have to agree, and asking about other depths must not perturb it.
    const a = makeColorScale(20)
    const b = makeColorScale(20)
    b(0); b(3); b(19); b(20)
    for (const depth of [0, 1, 7, 13, 20]) expect(a(depth)).toBe(b(depth))
  })

  it('does not collapse to mid-gradient when every guess is equally cold', () => {
    // The old scale normalised between the shallowest and deepest guess on
    // screen, so min === max fell back to t = 0.5 and a set of uniformly cold
    // guesses rendered olive. Shallow depths must read as the red end.
    const scale = makeColorScale(20)
    const [hue] = hsl(scale(1))
    expect(hue).toBeLessThan(COLOR_SCHEMES.warmth.hueSpan / 4)
  })

  it('sweeps from red at the root to the far end of the scheme at the anchor', () => {
    for (const scheme of SCHEMES) {
      expect(hsl(makeColorScale(20, scheme)(0))[0]).toBe(0)
      expect(hsl(makeColorScale(20, scheme)(20))[0]).toBe(COLOR_SCHEMES[scheme].hueSpan)
    }
  })

  it('clamps past the anchor rather than running off the end of the hue circle', () => {
    // Depths past the anchor are real: the anchor is a percentile, so a quarter
    // of species sit deeper. Without the clamp a hue over 360 wraps back to red
    // and the deepest lineages would read as the coldest.
    const scale = makeColorScale(20)
    expect(scale(21)).toBe(scale(20))
    expect(scale(1000)).toBe(scale(20))
  })

  it('clamps below the root too', () => {
    const scale = makeColorScale(20)
    expect(scale(-5)).toBe(scale(0))
  })

  it('is monotonic in hue across the whole range', () => {
    for (const scheme of SCHEMES) {
      const scale = makeColorScale(60, scheme)
      let previous = -1
      for (let depth = 0; depth <= 60; depth++) {
        const [hue] = hsl(scale(depth))
        expect(hue).toBeGreaterThanOrEqual(previous)
        previous = hue
      }
    }
  })

  it('falls back to the shipped anchor when the dataset has not answered yet', () => {
    // Both trees render with FALLBACK_ANCHOR_DEPTH before /dataset lands, and a
    // non-positive anchor must not divide by zero into hsl(NaN).
    for (const bad of [0, -1]) {
      expect(makeColorScale(bad)(7)).toBe(makeColorScale(FALLBACK_ANCHOR_DEPTH)(7))
    }
  })

  it('paints a real colour for an unknown scheme name', () => {
    // localStorage can hold a scheme an older build shipped. settings.ts
    // validates, but the scale is the last line of defence: `undefined` here
    // used to reach the ramp and paint every node hsl(NaN, ...), i.e. nothing.
    const rogue = 'chartreuse' as ColorScheme
    expect(makeColorScale(20, rogue)(10)).toBe(makeColorScale(20, DEFAULT_COLOR_SCHEME)(10))
  })

  it('emits only parseable hsl for every depth in a deep dataset', () => {
    const scale = makeColorScale(80)
    for (let depth = 0; depth <= 80; depth++) expect(() => hsl(scale(depth))).not.toThrow()
  })
})

describe('the ramp', () => {
  it('darkens through the yellows, so the middle is moss rather than mustard', () => {
    // Saturation and lightness are functions of hue. At a fixed lightness,
    // yellow reads far brighter than the ends — which is where most of a game's
    // nodes sit. Hue 60 must come out darker than both hue 0 and hue 120.
    const scale = makeColorScale(120, 'warmth')
    const [, , lightAtRed] = hsl(scale(0))
    const [, , lightAtYellow] = hsl(scale(60))
    const [, , lightAtGreen] = hsl(scale(120))
    expect(lightAtYellow).toBeLessThan(lightAtRed)
    expect(lightAtYellow).toBeLessThan(lightAtGreen)
  })

  it('stays well short of full saturation, so nothing reads as acid', () => {
    const scale = makeColorScale(60)
    for (let depth = 0; depth <= 60; depth++) {
      const [, sat] = hsl(scale(depth))
      expect(sat).toBeLessThanOrEqual(52)
    }
  })

  it('fades the shallow end and saturates the deep one', () => {
    // The second channel, and the reason it exists: an absolute depth scale
    // means any one screen spans a narrow band of depths, so hue alone
    // separates almost nothing *within* a view — measured at 32 degrees of 120
    // for a game four guesses in, and 16 for explore's opening screen.
    // Saturation moves where hue barely does.
    const scale = makeColorScale(60)
    let previous = -1
    for (let depth = 0; depth <= 60; depth++) {
      const [, sat] = hsl(scale(depth))
      expect(sat).toBeGreaterThanOrEqual(previous)
      previous = sat
    }
    expect(hsl(scale(60))[1] - hsl(scale(0))[1]).toBeGreaterThanOrEqual(15)
  })

  it('separates adjacent depths inside a narrow band', () => {
    // The band an actual game occupies: on the example, four guesses in, every
    // node sat between depth 10 and depth 14 of an anchor of 15.
    const scale = makeColorScale(15)
    const seen = new Set([10, 11, 12, 13, 14].map((d) => scale(d)))
    expect(seen.size).toBe(5)
  })
})

describe('makeTintScale', () => {
  it('is the same hue as the outline scale, only lighter', () => {
    // A clade is filled with the tint while a guess is outlined with the scale.
    // They must agree on hue or the same depth reads as two different colours
    // depending on what kind of node carries it.
    const scale = makeColorScale(20)
    const tint = makeTintScale(20)
    for (const depth of [0, 5, 11, 20]) {
      const [hueOutline, , lightOutline] = hsl(scale(depth))
      const [hueFill, , lightFill] = hsl(tint(depth))
      expect(hueFill).toBe(hueOutline)
      expect(lightFill).toBeGreaterThanOrEqual(lightOutline)
    }
  })

  it('is lighter strictly, somewhere a fill can be told from an edge', () => {
    const scale = makeColorScale(20)
    const tint = makeTintScale(20)
    const lighter = [0, 5, 11, 20].filter(
      (d) => hsl(tint(d))[2] > hsl(scale(d))[2],
    )
    expect(lighter.length).toBeGreaterThan(0)
  })

  it('clamps and falls back exactly as the outline scale does', () => {
    expect(makeTintScale(20)(1000)).toBe(makeTintScale(20)(20))
    expect(makeTintScale(0)(7)).toBe(makeTintScale(FALLBACK_ANCHOR_DEPTH)(7))
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

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A matchMedia whose answers are ours to change, with the listeners kept so a
 *  change can be fired the way the browser would.
 *
 *  Installed before the import, because media.ts builds its stores at module
 *  load — which is also why every case re-imports.
 */
function stubMatchMedia(initial: (query: string) => boolean) {
  const asked: string[] = []
  const listeners = new Map<string, Set<() => void>>()
  let answer = initial

  vi.stubGlobal('matchMedia', (query: string) => {
    asked.push(query)
    return {
      media: query,
      get matches() { return answer(query) },
      addEventListener: (_: string, cb: () => void) => {
        if (!listeners.has(query)) listeners.set(query, new Set())
        listeners.get(query)!.add(cb)
      },
      removeEventListener: (_: string, cb: () => void) => { listeners.get(query)?.delete(cb) },
    }
  })

  return {
    asked,
    listeners,
    /** Change the answer and notify, as the browser does on rotate or dock. */
    change(next: (query: string) => boolean) {
      answer = next
      act(() => { for (const set of listeners.values()) for (const cb of set) cb() })
    },
  }
}

async function loadMedia(initial: (query: string) => boolean = () => false) {
  vi.resetModules()
  const media = stubMatchMedia(initial)
  return { module: await import('./media'), media }
}

const isCoarse = (q: string) => q === '(pointer: coarse)'
const isNarrow = (q: string) => q.includes('max-width')

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('constants', () => {
  it('keeps the touch floor both platforms agree on', async () => {
    // Apple says 44pt, Material 48dp; 44 is the floor both accept. A real
    // number rather than a comment, because hitting it takes arithmetic.
    const { module } = await loadMedia()
    expect(module.MIN_TOUCH_PX).toBe(44)
  })
})

describe('what the module asks the browser', () => {
  it('asks whether the pointer is coarse, not whether the screen is small', async () => {
    // The whole point of the module: the question is "is this a finger?", not
    // "is this screen small?" — a touch laptop is both coarse and wide.
    const { media } = await loadMedia()
    expect(media.asked).toContain('(pointer: coarse)')
  })

  it('asks about width separately, for the orientation default', async () => {
    const { module, media } = await loadMedia()
    expect(media.asked).toContain(`(max-width: ${module.NARROW_PX - 1}px)`)
  })
})

describe('useCoarsePointer', () => {
  it('is true for a finger and false for a mouse', async () => {
    const finger = await loadMedia(isCoarse)
    expect(renderHook(() => finger.module.useCoarsePointer()).result.current).toBe(true)

    const mouse = await loadMedia(() => false)
    expect(renderHook(() => mouse.module.useCoarsePointer()).result.current).toBe(false)
  })

  it('is true on a touch laptop, which is coarse and wide', async () => {
    const { module } = await loadMedia((q) => isCoarse(q))
    expect(renderHook(() => module.useCoarsePointer()).result.current).toBe(true)
    expect(renderHook(() => module.useNarrow()).result.current).toBe(false)
  })

  it('re-renders when the pointer changes, rather than reading once', async () => {
    // Docking a tablet, or switching a device into touch emulation, has to
    // resize the trees rather than leave them mid-way.
    const { module, media } = await loadMedia(() => false)
    const { result } = renderHook(() => module.useCoarsePointer())
    expect(result.current).toBe(false)

    media.change(isCoarse)
    expect(result.current).toBe(true)
  })

  it('unsubscribes on unmount', async () => {
    const { module, media } = await loadMedia(() => false)
    const { unmount } = renderHook(() => module.useCoarsePointer())
    expect(media.listeners.get('(pointer: coarse)')?.size).toBe(1)
    unmount()
    expect(media.listeners.get('(pointer: coarse)')?.size).toBe(0)
  })
})

describe('useNarrow', () => {
  it('follows the viewport, and re-renders on rotation', async () => {
    const { module, media } = await loadMedia(() => false)
    const { result } = renderHook(() => module.useNarrow())
    expect(result.current).toBe(false)

    media.change(isNarrow)
    expect(result.current).toBe(true)
  })
})

describe('isNarrowNow', () => {
  it('answers without a hook, for a module-level default', async () => {
    const narrow = await loadMedia(isNarrow)
    expect(narrow.module.isNarrowNow()).toBe(true)

    const roomy = await loadMedia(() => false)
    expect(roomy.module.isNarrowNow()).toBe(false)
  })
})

describe('without matchMedia', () => {
  it('assumes mouse and roomy rather than throwing', async () => {
    // A non-DOM render, or an engine without matchMedia. That assumption is
    // what the app was already built for, so it is the safe fallback.
    vi.resetModules()
    vi.stubGlobal('matchMedia', undefined)
    const module = await import('./media')

    expect(module.isNarrowNow()).toBe(false)
    expect(renderHook(() => module.useCoarsePointer()).result.current).toBe(false)
    expect(renderHook(() => module.useNarrow()).result.current).toBe(false)
  })

  it('unmounts cleanly with nothing to unsubscribe from', async () => {
    vi.resetModules()
    vi.stubGlobal('matchMedia', undefined)
    const module = await import('./media')
    expect(() => renderHook(() => module.useCoarsePointer()).unmount()).not.toThrow()
  })
})

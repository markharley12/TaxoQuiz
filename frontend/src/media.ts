// What kind of pointer and how much room — the two things the trees have to
// size themselves against.
//
// Both trees draw their nodes inside an SVG that react-d3-tree scales by a zoom
// factor, so a node's size in CSS pixels is *not* its size under a fingertip.
// That is what made explore hard to use on a phone: a 15px info button inside a
// box drawn at zoom 0.8 lands on screen as 12x12, against the ~44px that a
// finger can actually aim at. Everything that has to grow for touch reads
// `useCoarsePointer` and sizes from it rather than guessing from window width,
// because the question is "is this a finger?" and not "is this screen small?" —
// a touch laptop is both coarse and wide.
import { useSyncExternalStore } from 'react'

/** Smallest comfortable touch target, per both Apple's and Google's guidance.
 *
 * Apple says 44pt, Material says 48dp; 44 is the one both agree is a floor.
 * Used as a real number rather than a comment because the node boxes are laid
 * out in CSS pixels and then scaled, so hitting it takes arithmetic — see
 * `NODE_SIZES` in ExploreTree.
 */
export const MIN_TOUCH_PX = 44

/** Below this width the tree gets the phone treatment. */
export const NARROW_PX = 600

function mediaStore(query: string) {
  // matchMedia is missing in a non-DOM render and can throw in old engines;
  // either way the answer is "assume mouse, assume roomy", which is what the
  // app was already built for.
  const mql = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(query)
    : null
  return {
    subscribe(cb: () => void) {
      if (!mql) return () => {}
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    get: () => (mql ? mql.matches : false),
  }
}

const coarse = mediaStore('(pointer: coarse)')
const narrow = mediaStore(`(max-width: ${NARROW_PX - 1}px)`)

/** True when the primary pointer is a finger rather than a mouse.
 *
 * Reactive, so switching a device into touch emulation (or docking a tablet)
 * re-renders the trees at the other size rather than leaving them mid-way.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(coarse.subscribe, coarse.get, () => false)
}

/** True on a phone-width viewport, regardless of pointer. */
export function useNarrow(): boolean {
  return useSyncExternalStore(narrow.subscribe, narrow.get, () => false)
}

/** The one-shot version, for a module-level default that cannot use a hook. */
export function isNarrowNow(): boolean {
  return narrow.get()
}

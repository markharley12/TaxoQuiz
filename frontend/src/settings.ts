// Front-end-only preferences, kept in localStorage.
//
// Nothing here reaches the API: these change how the tree is drawn, not what
// the game does, so a device that has never seen the server can still hold an
// opinion about it. That also means a preference does not follow you between
// browsers, which is the trade for needing no account.
//
// A module-level store rather than context, because the settings menu and both
// trees are in unrelated parts of the component tree and a change has to reach
// all of them at once.
import { useSyncExternalStore } from 'react'
import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, type ColorScheme } from './colors'

const STORAGE_KEY = 'taxoquiz_settings'

// Which way the tree grows. Named for what the reader sees rather than for
// react-d3-tree's own words: its "horizontal" grows left-to-right, which reads
// as "across", and it is easy to pick the wrong one from the library's name.
export const ORIENTATIONS = {
  horizontal: { label: 'Across', hint: 'root on the left' },
  vertical: { label: 'Down', hint: 'root at the top' },
} as const

export type Orientation = keyof typeof ORIENTATIONS

export interface Settings {
  colorScheme: ColorScheme
  orientation: Orientation
}

const DEFAULTS: Settings = { colorScheme: DEFAULT_COLOR_SCHEME, orientation: 'vertical' }

function read(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const saved = JSON.parse(raw) as Partial<Settings>
    // Validated rather than trusted. A scheme name we no longer ship — an older
    // build, or someone editing localStorage — would otherwise reach the scale
    // as `undefined` and paint every node `hsl(NaN, …)`, i.e. nothing at all.
    return {
      colorScheme:
        saved.colorScheme && saved.colorScheme in COLOR_SCHEMES
          ? saved.colorScheme
          : DEFAULTS.colorScheme,
      orientation:
        saved.orientation && saved.orientation in ORIENTATIONS
          ? saved.orientation
          : DEFAULTS.orientation,
    }
  } catch {
    return DEFAULTS
  }
}

let current: Settings = read()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  if (current[key] === value) return
  current = { ...current, [key]: value }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Private browsing, or storage full. The choice still applies for this
    // session; it just will not be here next time.
  }
  emit()
}

// Another tab changing the setting. Re-read rather than trusting the event's
// payload, so the validation above applies to it too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    current = read()
    emit()
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// `current` is replaced, never mutated, so this is a stable snapshot.
const snapshot = () => current

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

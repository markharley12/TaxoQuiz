/**
 * What Android's back button does in the native app.
 *
 * With no listener, Capacitor closes the app from any screen, because the app
 * keeps no browser history to go back through. The obvious fix — back returns
 * to the mode menu — is the wrong one: leaving a round that way goes through
 * `handleChangeMode`, which clears the saved session, so back would throw away
 * a daily round that cannot be replayed.
 *
 * So back closes whatever overlay was opened most recently — a taxon popup, a
 * confirmation, the settings menu — and with nothing open it minimises the app,
 * which leaves the round exactly where it was for when the app comes back.
 *
 * Overlays register themselves through `useCloseOnBack` rather than being listed
 * here, so a new dialog only has to call the hook to behave.
 */
import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

type Entry = { close: () => void }

/** Open overlays, oldest first. Module-level because overlays live in unrelated
 *  parts of the component tree, and one back press has to reach the newest. */
const open: Entry[] = []

/** Register an open overlay. Returns the function that unregisters it, which is
 *  safe to call after a back press has already removed it. */
export function pushCloser(close: () => void): () => void {
  const entry = { close }
  open.push(entry)
  return () => {
    const i = open.lastIndexOf(entry)
    if (i !== -1) open.splice(i, 1)
  }
}

/** One back press: close the newest overlay, or `leave` when none is open. */
export function handleBack(leave: () => void): void {
  const newest = open.pop()
  if (newest) newest.close()
  else leave()
}

/** Close this overlay on back while `isOpen`. Always calls the latest `close`,
 *  so an inline arrow function does not re-register on every render — which
 *  would move the overlay to the top of the stack each time it re-rendered. */
export function useCloseOnBack(isOpen: boolean, close: () => void): void {
  const latest = useRef(close)
  useEffect(() => {
    latest.current = close
  })
  useEffect(() => {
    if (!isOpen) return
    return pushCloser(() => latest.current())
  }, [isOpen])
}

/** Listen for the hardware back button. Does nothing outside the native app: in
 *  a browser, back belongs to the browser. */
export function installBackButton(): void {
  if (!Capacitor.isNativePlatform()) return
  void App.addListener('backButton', () => {
    handleBack(() => void App.minimizeApp())
  })
}

/**
 * The back button's stack of open overlays.
 *
 * What these guard is specific: a back press must close exactly one thing, the
 * newest, and with nothing open must leave the app rather than the round —
 * because the other way out of a round clears its saved session.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { handleBack, pushCloser, useCloseOnBack } from './backButton'

describe('handleBack', () => {
  it('closes the overlay opened most recently, not the first one', () => {
    const popup = vi.fn()
    const confirm = vi.fn()
    const removePopup = pushCloser(popup)
    const removeConfirm = pushCloser(confirm)
    handleBack(() => {})
    expect(confirm).toHaveBeenCalledOnce()
    expect(popup).not.toHaveBeenCalled()
    removeConfirm()
    removePopup()
  })

  it('closes one thing per press', () => {
    const first = vi.fn()
    const second = vi.fn()
    pushCloser(first)
    pushCloser(second)
    const leave = vi.fn()
    handleBack(leave)
    handleBack(leave)
    expect([second.mock.calls.length, first.mock.calls.length, leave.mock.calls.length]).toEqual([1, 1, 0])
  })

  it('with nothing open, leaves the app instead of touching the round', () => {
    const leave = vi.fn()
    handleBack(leave)
    expect(leave).toHaveBeenCalledOnce()
  })

  it('tolerates an overlay unregistering after back already removed it', () => {
    const remove = pushCloser(vi.fn())
    handleBack(() => {})
    expect(() => remove()).not.toThrow()
    const leave = vi.fn()
    handleBack(leave)
    expect(leave).toHaveBeenCalledOnce()
  })
})

describe('useCloseOnBack', () => {
  it('stops answering back once the overlay is closed some other way', () => {
    const close = vi.fn()
    const { rerender } = renderHook(({ isOpen }) => useCloseOnBack(isOpen, close), {
      initialProps: { isOpen: true },
    })
    rerender({ isOpen: false })
    const leave = vi.fn()
    handleBack(leave)
    expect(close).not.toHaveBeenCalled()
    expect(leave).toHaveBeenCalledOnce()
  })

  it('calls the latest close function, not the one it opened with', () => {
    const stale = vi.fn()
    const fresh = vi.fn()
    const { rerender, unmount } = renderHook(({ close }) => useCloseOnBack(true, close), {
      initialProps: { close: stale },
    })
    rerender({ close: fresh })
    handleBack(() => {})
    expect(fresh).toHaveBeenCalledOnce()
    expect(stale).not.toHaveBeenCalled()
    unmount()
  })

  it('keeps its place when it re-renders, so a newer overlay still closes first', () => {
    const older = vi.fn()
    const newer = vi.fn()
    const a = renderHook(({ close }: { close: () => void }) => useCloseOnBack(true, close), {
      initialProps: { close: older as () => void },
    })
    const b = renderHook(() => useCloseOnBack(true, newer))
    a.rerender({ close: () => older() })   // a new function identity, as an inline arrow gives
    handleBack(() => {})
    expect(newer).toHaveBeenCalledOnce()
    expect(older).not.toHaveBeenCalled()
    a.unmount()
    b.unmount()
  })

  it('is not registered while closed', () => {
    const close = vi.fn()
    const { unmount } = renderHook(() => useCloseOnBack(false, close))
    const leave = vi.fn()
    handleBack(leave)
    expect(leave).toHaveBeenCalledOnce()
    unmount()
  })
})

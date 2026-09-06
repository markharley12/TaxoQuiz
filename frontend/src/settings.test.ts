import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'taxoquiz_settings'

/** Install a matchMedia whose answer to `max-width` is `narrow`.
 *
 * settings.ts reads the viewport once, at module load, to pick the default
 * orientation — so the media state has to be in place before the import, and
 * the module registry reset between cases. That is why every test here imports
 * dynamically instead of at the top of the file.
 */
function setViewport(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width') ? narrow : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

async function loadSettings(opts: { narrow?: boolean; stored?: string | null } = {}) {
  vi.resetModules()
  localStorage.clear()
  setViewport(opts.narrow ?? false)
  if (opts.stored != null) localStorage.setItem(STORAGE_KEY, opts.stored)
  return import('./settings')
}

describe('defaults', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('starts Down on a roomy viewport', async () => {
    const { getSettings } = await loadSettings({ narrow: false })
    expect(getSettings().orientation).toBe('vertical')
  })

  it('starts Across on a phone', async () => {
    // Down puts siblings side by side, so a 390px screen shows two of them and
    // gives all the room to generations you can only walk one at a time.
    const { getSettings } = await loadSettings({ narrow: true })
    expect(getSettings().orientation).toBe('horizontal')
  })

  it('lets a saved choice beat the phone default', async () => {
    // Only the *default* moves. A phone user who prefers Down keeps it.
    const { getSettings } = await loadSettings({
      narrow: true,
      stored: JSON.stringify({ orientation: 'vertical' }),
    })
    expect(getSettings().orientation).toBe('vertical')
  })

  it('defaults the scheme to warmth and the dataset to server choice', async () => {
    const { getSettings } = await loadSettings()
    expect(getSettings().colorScheme).toBe('warmth')
    // Empty string means "let the server decide", mirroring the API's own
    // dataset=None convention.
    expect(getSettings().dataset).toBe('')
  })
})

describe('reading stored settings', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('restores a full saved set', async () => {
    const { getSettings } = await loadSettings({
      stored: JSON.stringify({
        colorScheme: 'rainbow', orientation: 'horizontal', dataset: 'wikidata-2026-09',
      }),
    })
    expect(getSettings()).toEqual({
      colorScheme: 'rainbow', orientation: 'horizontal', dataset: 'wikidata-2026-09',
    })
  })

  it('rejects a colour scheme we no longer ship', async () => {
    // An older build, or someone editing localStorage. Unvalidated, this
    // reached the scale as `undefined` and painted every node hsl(NaN, ...).
    const { getSettings } = await loadSettings({
      stored: JSON.stringify({ colorScheme: 'chartreuse' }),
    })
    expect(getSettings().colorScheme).toBe('warmth')
  })

  it('rejects an orientation that is not one of the two', async () => {
    const { getSettings } = await loadSettings({
      stored: JSON.stringify({ orientation: 'sideways' }),
    })
    expect(getSettings().orientation).toBe('vertical')
  })

  it('rejects a non-string dataset', async () => {
    const { getSettings } = await loadSettings({
      stored: JSON.stringify({ dataset: 42 }),
    })
    expect(getSettings().dataset).toBe('')
  })

  it('survives unparseable storage', async () => {
    const { getSettings } = await loadSettings({ stored: '{not json' })
    expect(getSettings().colorScheme).toBe('warmth')
  })

  it('keeps the valid half of a partly corrupt set', async () => {
    const { getSettings } = await loadSettings({
      stored: JSON.stringify({ colorScheme: 'rainbow', orientation: 'sideways' }),
    })
    expect(getSettings().colorScheme).toBe('rainbow')
    expect(getSettings().orientation).toBe('vertical')
  })

  it('accepts a dataset name without validating it against a list', async () => {
    // The dataset list is server-known, not a frontend constant, so a stale
    // name is stored as-is and caught where the list is fetched.
    const { getSettings } = await loadSettings({
      stored: JSON.stringify({ dataset: 'deleted-last-week' }),
    })
    expect(getSettings().dataset).toBe('deleted-last-week')
  })
})

describe('setSetting', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('applies the change, persists it and notifies', async () => {
    const { setSetting, getSettings, subscribeSettings } = await loadSettings()
    const seen = vi.fn()
    subscribeSettings(seen)

    setSetting('colorScheme', 'rainbow')

    expect(getSettings().colorScheme).toBe('rainbow')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).colorScheme).toBe('rainbow')
  })

  it('replaces the snapshot rather than mutating it', async () => {
    // useSyncExternalStore compares snapshots by identity: mutating in place
    // would leave every subscriber rendering the old value.
    const { setSetting, getSettings } = await loadSettings()
    const before = getSettings()
    setSetting('orientation', 'horizontal')
    expect(getSettings()).not.toBe(before)
    expect(before.orientation).toBe('vertical')
  })

  it('ignores a no-op write', async () => {
    // Otherwise every render that "sets" the current value re-notifies.
    const { setSetting, getSettings, subscribeSettings } = await loadSettings()
    const seen = vi.fn()
    subscribeSettings(seen)
    setSetting('colorScheme', getSettings().colorScheme)
    expect(seen).not.toHaveBeenCalled()
  })

  it('still applies the choice when storage refuses to write', async () => {
    // Private browsing, or storage full. The choice holds for this session; it
    // just will not be there next time.
    const { setSetting, getSettings } = await loadSettings()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => setSetting('colorScheme', 'rainbow')).not.toThrow()
    expect(getSettings().colorScheme).toBe('rainbow')
    setItem.mockRestore()
  })

  it('unsubscribes cleanly', async () => {
    const { setSetting, subscribeSettings } = await loadSettings()
    const seen = vi.fn()
    subscribeSettings(seen)()
    setSetting('colorScheme', 'rainbow')
    expect(seen).not.toHaveBeenCalled()
  })
})

describe('another tab changing the settings', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('re-reads storage rather than trusting the event payload', async () => {
    // Re-reading is what applies the same validation to a cross-tab change:
    // a scheme we no longer ship must not get in this way either.
    const { getSettings, subscribeSettings } = await loadSettings()
    const seen = vi.fn()
    subscribeSettings(seen)

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ colorScheme: 'chartreuse' }))
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))

    expect(getSettings().colorScheme).toBe('warmth')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('picks up a valid cross-tab change', async () => {
    const { getSettings } = await loadSettings()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ orientation: 'horizontal' }))
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    expect(getSettings().orientation).toBe('horizontal')
  })

  it('ignores an unrelated key', async () => {
    const { getSettings, subscribeSettings } = await loadSettings()
    const seen = vi.fn()
    subscribeSettings(seen)
    window.dispatchEvent(new StorageEvent('storage', { key: 'something_else' }))
    expect(seen).not.toHaveBeenCalled()
    expect(getSettings().orientation).toBe('vertical')
  })
})

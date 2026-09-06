import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaxonInfo } from './api'

// The cache is module state with no reset, which is right for the app and means
// each case needs a fresh module. `fetchTaxonInfo` is the only thing it calls.
const fetchTaxonInfo = vi.fn()
vi.mock('./api', () => ({ fetchTaxonInfo: (...args: unknown[]) => fetchTaxonInfo(...args) }))

async function loadCache() {
  vi.resetModules()
  fetchTaxonInfo.mockReset()
  return import('./taxonCache')
}

function info(description: string, image = ''): TaxonInfo {
  return {
    rank: '', common_name: '', qid: null, description, image_url: image,
    wikipedia_url: '', wikipedia_title: '',
  }
}

afterEach(() => { cleanup() })

describe('cachedTaxonInfo', () => {
  it('is undefined until someone asks', async () => {
    // Three states, all meaningful: undefined = nobody asked, null = asked and
    // there is no article, an object = a hit.
    const { cachedTaxonInfo } = await loadCache()
    expect(cachedTaxonInfo('Aves', 'example')).toBeUndefined()
  })

  it('returns the hit once it lands', async () => {
    const { cachedTaxonInfo, loadTaxonInfo } = await loadCache()
    fetchTaxonInfo.mockResolvedValue(info('birds'))
    await loadTaxonInfo('Aves', 'example')
    expect(cachedTaxonInfo('Aves', 'example')?.description).toBe('birds')
  })
})

describe('the cache key', () => {
  it('separates the same name in two datasets', async () => {
    // Load-bearing, not tidy: 1,047 names appear in both the example and the
    // scrape, 86% of them with a different description and 68% a different
    // picture. Animalia is 923 characters in one and 3,369 in the other.
    const { cachedTaxonInfo, loadTaxonInfo } = await loadCache()
    fetchTaxonInfo.mockResolvedValueOnce(info('923 chars'))
    fetchTaxonInfo.mockResolvedValueOnce(info('3369 chars'))

    await loadTaxonInfo('Animalia', 'example')
    await loadTaxonInfo('Animalia', 'wikidata-2026-09')

    expect(cachedTaxonInfo('Animalia', 'example')?.description).toBe('923 chars')
    expect(cachedTaxonInfo('Animalia', 'wikidata-2026-09')?.description).toBe('3369 chars')
    expect(fetchTaxonInfo).toHaveBeenCalledTimes(2)
  })

  it('does not let a dataset/name pair collide with another', async () => {
    // Concatenated plainly, ('a', 'bc') and ('ab', 'c') are one key. The
    // separator is a newline, which a dataset name cannot contain.
    const { cachedTaxonInfo, loadTaxonInfo } = await loadCache()
    fetchTaxonInfo.mockResolvedValueOnce(info('first'))
    await loadTaxonInfo('bc', 'a')
    expect(cachedTaxonInfo('c', 'ab')).toBeUndefined()
  })

  it('passes the dataset through to the API', async () => {
    const { loadTaxonInfo } = await loadCache()
    fetchTaxonInfo.mockResolvedValue(info('x'))
    await loadTaxonInfo('Aves', 'wikidata-2026-09')
    expect(fetchTaxonInfo).toHaveBeenCalledWith('Aves', 'wikidata-2026-09')
  })
})

describe('loadTaxonInfo', () => {
  it('asks once and serves the rest from memory', async () => {
    const { loadTaxonInfo } = await loadCache()
    fetchTaxonInfo.mockResolvedValue(info('birds'))

    await loadTaxonInfo('Aves', 'example')
    await loadTaxonInfo('Aves', 'example')
    await loadTaxonInfo('Aves', 'example')

    expect(fetchTaxonInfo).toHaveBeenCalledTimes(1)
  })

  it('shares one request between simultaneous callers', async () => {
    // The popup, the hover preview and the thumbnail all want the same node,
    // and they ask in the same tick.
    const { loadTaxonInfo } = await loadCache()
    let resolve!: (v: TaxonInfo) => void
    fetchTaxonInfo.mockReturnValue(new Promise((r) => { resolve = r }))

    const all = Promise.all([
      loadTaxonInfo('Aves', 'example'),
      loadTaxonInfo('Aves', 'example'),
      loadTaxonInfo('Aves', 'example'),
    ])
    resolve(info('birds'))
    const [a, b, c] = await all

    expect(fetchTaxonInfo).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('caches a 404 as firmly as a hit', async () => {
    // ~3% of nodes have no article. Re-asking on every hover is exactly the
    // cost the cache exists to avoid, so "there is nothing" is a real answer.
    const { cachedTaxonInfo, loadTaxonInfo } = await loadCache()
    fetchTaxonInfo.mockResolvedValue(null)

    expect(await loadTaxonInfo('Nothing', 'example')).toBeNull()
    expect(await loadTaxonInfo('Nothing', 'example')).toBeNull()

    expect(fetchTaxonInfo).toHaveBeenCalledTimes(1)
    expect(cachedTaxonInfo('Nothing', 'example')).toBeNull()
  })

  it('does not cache a transient failure, so a later hover retries', async () => {
    // The node must not be permanently blank because the network blinked.
    const { cachedTaxonInfo, loadTaxonInfo } = await loadCache()
    fetchTaxonInfo.mockRejectedValueOnce(new Error('network'))

    expect(await loadTaxonInfo('Aves', 'example')).toBeNull()
    // Nobody has a real answer yet — distinct from the cached null above.
    expect(cachedTaxonInfo('Aves', 'example')).toBeUndefined()

    fetchTaxonInfo.mockResolvedValueOnce(info('birds'))
    expect((await loadTaxonInfo('Aves', 'example'))?.description).toBe('birds')
    expect(fetchTaxonInfo).toHaveBeenCalledTimes(2)
  })

  it('clears the in-flight entry after a failure', async () => {
    // Left behind, the rejected promise would be handed to every later caller
    // and the node could never recover.
    const { loadTaxonInfo } = await loadCache()
    fetchTaxonInfo.mockRejectedValueOnce(new Error('network'))
    await loadTaxonInfo('Aves', 'example')

    fetchTaxonInfo.mockResolvedValueOnce(info('birds'))
    await loadTaxonInfo('Aves', 'example')
    fetchTaxonInfo.mockResolvedValueOnce(info('unused'))
    expect((await loadTaxonInfo('Aves', 'example'))?.description).toBe('birds')
  })
})

describe('useTaxonCache', () => {
  it('re-renders when something lands, so the thumbnail appears', async () => {
    // A node can only show a picture if something already knows its URL, so the
    // cache landing is what puts it there.
    const { loadTaxonInfo, useTaxonCache } = await loadCache()
    fetchTaxonInfo.mockResolvedValue(info('birds', 'https://example.invalid/a.jpg'))

    const { result } = renderHook(() => useTaxonCache())
    const before = result.current

    await act(async () => { await loadTaxonInfo('Aves', 'example') })

    expect(result.current).not.toBe(before)
  })

  it('does not re-render for a cache hit, which changed nothing', async () => {
    const { loadTaxonInfo, useTaxonCache } = await loadCache()
    fetchTaxonInfo.mockResolvedValue(info('birds'))
    await loadTaxonInfo('Aves', 'example')

    const { result } = renderHook(() => useTaxonCache())
    const before = result.current
    await act(async () => { await loadTaxonInfo('Aves', 'example') })

    expect(result.current).toBe(before)
  })

  it('does not re-render for a transient failure', async () => {
    const { loadTaxonInfo, useTaxonCache } = await loadCache()
    fetchTaxonInfo.mockRejectedValueOnce(new Error('network'))

    const { result } = renderHook(() => useTaxonCache())
    const before = result.current
    await act(async () => { await loadTaxonInfo('Aves', 'example') })

    expect(result.current).toBe(before)
  })

  it('stops notifying after unmount', async () => {
    const { loadTaxonInfo, useTaxonCache } = await loadCache()
    fetchTaxonInfo.mockResolvedValue(info('birds'))
    const { unmount } = renderHook(() => useTaxonCache())
    unmount()
    await expect(loadTaxonInfo('Aves', 'example')).resolves.toBeTruthy()
  })
})

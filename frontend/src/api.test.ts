/**
 * Who answers a request: the engine on the device, or a server.
 *
 * The engine's *answers* are checked against Python in
 * `engine/conformance.test.ts`. This is about the routing in front of it, which
 * fails in quieter ways: a phone that sits waiting on a server that will never
 * exist, a developer's scrape silently swapped for the example, or one dropped
 * download ending the session for good.
 *
 * Each test gets a fresh copy of `api.ts`, because the server's answer about its
 * default dataset is asked once per page load and kept.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import treeText from '../../src/taxoquiz/data/example_tree.json?raw'
import infoText from '../../src/taxoquiz/data/example_taxon_info.json?raw'
import goldenText from './engine/conformance.json?raw'

interface Fake { ok: boolean; status: number; json: () => Promise<unknown> }

const reply = (body: unknown, status = 200): Fake =>
  ({ ok: status < 400, status, json: async () => body })

/** What a static host or a phone's asset server gives for a path it lacks. */
const indexHtml = (): Fake =>
  ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token '<'") } })

const refused = () => Promise.reject(new TypeError('Failed to fetch'))

type ApiHandler = (url: string, init?: RequestInit) => Fake | Promise<Fake>

function stubFetch(api: ApiHandler, tree: () => Fake | Promise<Fake> = () => reply(JSON.parse(treeText))) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('example_tree')) return tree()
    if (url.includes('example_taxon_info')) return reply(JSON.parse(infoText))
    if (url.startsWith('/api/')) return api(url, init)
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

const apiCalls = (mock: ReturnType<typeof stubFetch>) =>
  mock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/'))

async function freshApi() {
  vi.resetModules()
  return import('./api')
}

// A seed Python resolved, and the animal it resolved to.
const known = JSON.parse(goldenText).seeds.resolve[0] as { seed: string; result: string }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('with no server', () => {
  it('plays the example on the device, asking the server only once whether it exists', async () => {
    const mock = stubFetch(refused)
    const api = await freshApi()
    expect(await api.fetchAnimal({ seed: known.seed })).toStrictEqual(
      { animal: known.result, seed: known.seed, daily: false })
    await api.fetchAutocomplete('li')
    expect(apiCalls(mock)).toEqual(['/api/dataset'])
  })

  it('reads an index.html answer as no server — the static host and phone case', async () => {
    stubFetch(indexHtml)
    const api = await freshApi()
    expect((await api.fetchAnimal({ seed: known.seed })).animal).toBe(known.result)
  })

  it('gives up on a server that accepts the connection and never answers', async () => {
    vi.useFakeTimers()
    stubFetch((_, init) => new Promise<Fake>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const api = await freshApi()
    const game = api.fetchAnimal({ seed: known.seed })
    await vi.advanceTimersByTimeAsync(api.PROBE_TIMEOUT_MS)
    expect((await game).animal).toBe(known.result)
  })

  it('offers the example in the picker rather than an empty list', async () => {
    stubFetch(refused)
    const api = await freshApi()
    expect(await api.fetchDatasets()).toStrictEqual(
      [{ name: 'example', species: 530, max_depth: 21, is_example: true }])
  })

  it("rejects a bad seed with the engine's words, which is what the player reads", async () => {
    stubFetch(refused)
    const api = await freshApi()
    await expect(api.fetchAnimal({ seed: 'nonsense' })).rejects.toThrow(/is not a seed/)
  })

  it('answers a name with no article with null, as the server did with a 404', async () => {
    stubFetch(refused)
    const api = await freshApi()
    expect(await api.fetchTaxonInfo('Not a taxon')).toBeNull()
    expect((await api.fetchTaxonInfo('Animalia'))?.rank).toBe('Kingdom')
  })

  it('tries the tree again after a failed download instead of keeping the failure', async () => {
    let attempts = 0
    stubFetch(refused, () => (++attempts === 1 ? refused() : reply(JSON.parse(treeText))))
    const api = await freshApi()
    await expect(api.fetchAnimal({ seed: known.seed })).rejects.toThrow()
    expect((await api.fetchAnimal({ seed: known.seed })).animal).toBe(known.result)
  })
})

describe('with a server', () => {
  it("keeps a developer's scrape on the server when that is the server's default", async () => {
    const mock = stubFetch((url) =>
      url === '/api/dataset' ? reply({ dataset: 'wikidata' }) : reply({ animal: 'x', seed: 's', daily: false }))
    const api = await freshApi()
    expect((await api.fetchAnimal()).animal).toBe('x')
    expect(apiCalls(mock)).toEqual(['/api/dataset', '/api/animal?dataset=wikidata'])
  })

  it('still plays the example on the device when that is the default', async () => {
    const mock = stubFetch(() => reply({ dataset: 'example' }))
    const api = await freshApi()
    expect((await api.fetchAnimal({ seed: known.seed })).animal).toBe(known.result)
    expect(apiCalls(mock)).toEqual(['/api/dataset'])
  })

  it('never asks about the default when a dataset is named', async () => {
    const mock = stubFetch(() => reply(['lion']))
    const api = await freshApi()
    await api.fetchAutocomplete('li', 30, [], 'example')
    await api.fetchAutocomplete('li', 30, [], 'wikidata')
    expect(apiCalls(mock)).toEqual(['/api/animals?q=li&limit=30&dataset=wikidata'])
  })
})

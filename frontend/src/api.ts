/**
 * Everything the app asks about a dataset — and the one place that decides who
 * answers.
 *
 * The **example** is answered on the device by `engine/`, a TypeScript port of
 * the Python game, checked against it by `engine/conformance.test.ts`. That is
 * what lets the app run with no server: as a static website, or packaged for a
 * phone. Any **other** dataset is a scrape on a server's disk, so it still goes
 * over HTTP.
 *
 * An unset dataset means "the server's default", as it always has — that is how
 * `TAXOQUIZ_DATASET=<name> ./start.sh` plays a scrape — so the first such
 * request asks the server which dataset that is, once. No server, or something
 * that is not one, means the example. "Not one" is common rather than an edge
 * case: a static host and a phone's own asset server both answer `/api/dataset`
 * with `index.html`, which fails to parse and reads as no server, as it should.
 */
import { EXAMPLE, exampleInfo, exampleTree } from './engine/local'
import { getGameState, listAnimals, pickAnimal } from './engine/game'
import { lineage, search, stats, subtree } from './engine/explore'
import { taxonInfo } from './engine/taxon'

const BASE = '/api'

/** How long the first request waits for a server to name its default before
 *  playing the example. Only paid when something at `/api` accepts the
 *  connection and then says nothing; a refusal or a 404 is immediate. */
export const PROBE_TIMEOUT_MS = 3000

let serverDefault: Promise<string> | null = null

async function askServerDefault(): Promise<string> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/dataset`, { signal: abort.signal })
    if (!res.ok) return EXAMPLE
    const body = await res.json()
    return typeof body?.dataset === 'string' ? body.dataset : EXAMPLE
  } catch {
    return EXAMPLE
  } finally {
    clearTimeout(timer)
  }
}

/** Which dataset a request is for, and therefore who answers it. */
function datasetFor(dataset?: string): Promise<string> {
  if (dataset) return Promise.resolve(dataset)
  if (serverDefault === null) serverDefault = askServerDefault()
  return serverDefault
}

export interface TaxonInfo {
  rank: string
  /** Species only; empty for everything above them. */
  common_name: string
  qid: string | null
  description: string
  image_url: string
  wikipedia_url: string
  wikipedia_title: string
}

export interface TreeNode {
  /** The tree's own name — the key for taxon info. Null on the ??? node,
   *  which has nothing to look up. */
  name: string | null
  label: string
  node_type: 'ancestor' | 'guess' | 'secret'
  depth: number
  on_secret_path: boolean
  warmth: number       // rank position 0..1, what the node is coloured by
  lca_depth?: number   // guess nodes only: depth of LCA with secret
  lca_warmth?: number  // guess nodes only: rank position of that LCA
  children: TreeNode[]
}

export interface DatasetSummary {
  name: string
  species: number
  max_depth: number
  is_example: boolean
}

/** Every dataset there is, for the Settings menu's picker. Species count
 *  doubles as a difficulty hint — more species, more ways to be wrong.
 *
 *  With no server that is the example alone, not an empty list: the example
 *  is always playable, and an empty picker would say nothing is. */
export async function fetchDatasets(): Promise<DatasetSummary[]> {
  try {
    const res = await fetch(`${BASE}/datasets`)
    if (res.ok) return await res.json()
  } catch {
    // No server, or a host answering with a page rather than JSON.
  }
  const s = stats(await exampleTree())
  return [{ name: EXAMPLE, species: s.species, max_depth: s.max_depth, is_example: true }]
}

export interface NewGame {
  animal: string
  seed: string
  daily: boolean
}

/** Start a game. Pass a seed to replay someone else's exact round. Rejects with
 *  a message for the player if the seed is malformed or for another dataset. */
export async function fetchAnimal(
  opts: { daily?: boolean; seed?: string; dataset?: string } = {},
): Promise<NewGame> {
  const dataset = await datasetFor(opts.dataset)
  if (dataset === EXAMPLE) {
    const game = pickAnimal(await exampleTree(), { daily: opts.daily, seed: opts.seed })
    return { ...game, daily: Boolean(opts.daily) && !opts.seed }
  }
  const params = new URLSearchParams({ dataset })
  if (opts.daily) params.set('daily', 'true')
  if (opts.seed) params.set('seed', opts.seed)
  const res = await fetch(`${BASE}/animal?${params}`)
  if (res.status === 400) {
    const err = await res.json()
    throw new Error(err.detail)      // malformed, or a seed from another dataset
  }
  if (!res.ok) throw new Error('Failed to fetch animal')
  return res.json()
}

export async function fetchAutocomplete(
  q: string, limit = 30, exclude: string[] = [], dataset?: string,
): Promise<string[]> {
  const ds = await datasetFor(dataset)
  if (ds === EXAMPLE) return listAnimals(await exampleTree(), q, limit, exclude)
  const params = new URLSearchParams({ q, limit: String(limit), dataset: ds })
  for (const name of exclude) params.append('exclude', name)
  const res = await fetch(`${BASE}/animals?${params}`)
  if (!res.ok) throw new Error('Failed to fetch animals')
  return res.json()
}

/** Null for a round with no guesses, which the app never asks for. */
export async function fetchGameState(
  secret: string, guesses: string[], dataset?: string,
): Promise<TreeNode | null> {
  const ds = await datasetFor(dataset)
  if (ds === EXAMPLE) return getGameState(await exampleTree(), secret, guesses)
  const params = new URLSearchParams({ dataset: ds })
  const res = await fetch(`${BASE}/game/state?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, guesses }),
  })
  if (res.status === 400) {
    const err = await res.json()
    throw new Error(err.detail)
  }
  if (!res.ok) throw new Error('Failed to fetch game state')
  return res.json()
}

export async function fetchTaxonInfo(name: string, dataset?: string): Promise<TaxonInfo | null> {
  const ds = await datasetFor(dataset)
  if (ds === EXAMPLE) {
    const [tree, info] = await Promise.all([exampleTree(), exampleInfo()])
    return taxonInfo(tree, info, name)
  }
  const params = new URLSearchParams({ dataset: ds })
  const res = await fetch(`${BASE}/taxon/${encodeURIComponent(name)}?${params}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch taxon info')
  return res.json()
}

// ---------------------------------------------------------------- explore mode

export interface ExploreNode {
  name: string
  common_name?: string
  scientific_name?: string
  rank: string
  depth: number
  /** Rank position 0..1 — what the node is coloured by. See colors.ts. */
  warmth: number
  child_count: number
  species_count: number
  /** Total descendants including this node — what a full expand would render. */
  node_count: number
  /** Has children the server did not send. Opening it needs another fetch. */
  truncated: boolean
  children: ExploreNode[]
}

export interface ExploreHit {
  name: string
  common_name: string
  rank: string
  depth: number
  species_count: number
  is_species: boolean
}

export interface ExploreStats {
  root: string
  nodes: number
  species: number
  max_depth: number
}

/** `budget: -1` fetches every descendant — see the API for what that costs. */
export async function fetchExplore(root?: string, budget = 200, dataset?: string): Promise<ExploreNode> {
  const ds = await datasetFor(dataset)
  if (ds === EXAMPLE) return subtree(await exampleTree(), root ?? null, null, budget === -1 ? null : budget)
  const params = new URLSearchParams({ budget: String(budget), dataset: ds })
  if (root) params.set('root', root)
  const res = await fetch(`${BASE}/explore?${params}`)
  if (!res.ok) throw new Error('Failed to fetch subtree')
  return res.json()
}

export interface Lineage {
  path: string[]
  tree: ExploreNode
}

/** Jump to a taxon: the whole spine from the root, with siblings, in one call. */
export async function fetchLineage(name: string, dataset?: string): Promise<Lineage> {
  const ds = await datasetFor(dataset)
  if (ds === EXAMPLE) return lineage(await exampleTree(), name)
  const params = new URLSearchParams({ dataset: ds })
  const res = await fetch(`${BASE}/explore/lineage/${encodeURIComponent(name)}?${params}`)
  if (!res.ok) throw new Error('Failed to fetch lineage')
  return res.json()
}

export async function searchExplore(q: string, limit = 25, dataset?: string): Promise<ExploreHit[]> {
  const ds = await datasetFor(dataset)
  if (ds === EXAMPLE) return search(await exampleTree(), q, limit)
  const params = new URLSearchParams({ q, limit: String(limit), dataset: ds })
  const res = await fetch(`${BASE}/explore/search?${params}`)
  if (!res.ok) throw new Error('Failed to search')
  return res.json()
}

export async function fetchExploreStats(dataset?: string): Promise<ExploreStats> {
  const ds = await datasetFor(dataset)
  if (ds === EXAMPLE) return stats(await exampleTree())
  const params = new URLSearchParams({ dataset: ds })
  const res = await fetch(`${BASE}/explore/stats?${params}`)
  if (!res.ok) throw new Error('Failed to fetch stats')
  return res.json()
}

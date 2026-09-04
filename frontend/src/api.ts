const BASE = '/api'

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
  lca_depth?: number   // guess nodes only: depth of LCA with secret
  children: TreeNode[]
}

export interface DatasetInfo {
  dataset: string
  is_example: boolean
  available: string[]
  path: string
  root: string
  species: number
  max_depth: number
  /** Depth treated as fully green. A high percentile, not the max — see the API. */
  color_anchor_depth: number
  taxon_info: number
}

export async function fetchDataset(dataset?: string): Promise<DatasetInfo> {
  const params = new URLSearchParams()
  if (dataset) params.set('dataset', dataset)
  const res = await fetch(`${BASE}/dataset?${params}`)
  if (!res.ok) throw new Error('Failed to fetch dataset info')
  return res.json()
}

export interface DatasetSummary {
  name: string
  species: number
  max_depth: number
  is_example: boolean
}

/** Every dataset on disk, for the Settings menu's picker. Species count
 *  doubles as a difficulty hint — more species, more ways to be wrong. */
export async function fetchDatasets(): Promise<DatasetSummary[]> {
  const res = await fetch(`${BASE}/datasets`)
  if (!res.ok) throw new Error('Failed to fetch datasets')
  return res.json()
}

export interface NewGame {
  animal: string
  seed: string
  daily: boolean
}

/** Start a game. Pass a seed to replay someone else's exact round. */
export async function fetchAnimal(
  opts: { daily?: boolean; seed?: string; dataset?: string } = {},
): Promise<NewGame> {
  const params = new URLSearchParams()
  if (opts.daily) params.set('daily', 'true')
  if (opts.seed) params.set('seed', opts.seed)
  if (opts.dataset) params.set('dataset', opts.dataset)
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
  const params = new URLSearchParams({ q, limit: String(limit) })
  for (const name of exclude) params.append('exclude', name)
  if (dataset) params.set('dataset', dataset)
  const res = await fetch(`${BASE}/animals?${params}`)
  if (!res.ok) throw new Error('Failed to fetch animals')
  return res.json()
}

export async function fetchGameState(secret: string, guesses: string[], dataset?: string): Promise<TreeNode> {
  const params = new URLSearchParams()
  if (dataset) params.set('dataset', dataset)
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
  const params = new URLSearchParams()
  if (dataset) params.set('dataset', dataset)
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
  const params = new URLSearchParams({ budget: String(budget) })
  if (root) params.set('root', root)
  if (dataset) params.set('dataset', dataset)
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
  const params = new URLSearchParams()
  if (dataset) params.set('dataset', dataset)
  const res = await fetch(`${BASE}/explore/lineage/${encodeURIComponent(name)}?${params}`)
  if (!res.ok) throw new Error('Failed to fetch lineage')
  return res.json()
}

export async function searchExplore(q: string, limit = 25, dataset?: string): Promise<ExploreHit[]> {
  const params = new URLSearchParams({ q, limit: String(limit) })
  if (dataset) params.set('dataset', dataset)
  const res = await fetch(`${BASE}/explore/search?${params}`)
  if (!res.ok) throw new Error('Failed to search')
  return res.json()
}

export async function fetchExploreStats(dataset?: string): Promise<ExploreStats> {
  const params = new URLSearchParams()
  if (dataset) params.set('dataset', dataset)
  const res = await fetch(`${BASE}/explore/stats?${params}`)
  if (!res.ok) throw new Error('Failed to fetch stats')
  return res.json()
}

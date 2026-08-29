const BASE = '/api'

export interface TaxonInfo {
  rank: string
  qid: string | null
  description: string
  image_url: string
  wikipedia_url: string
  wikipedia_title: string
}

export interface TreeNode {
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

export async function fetchDataset(): Promise<DatasetInfo> {
  const res = await fetch(`${BASE}/dataset`)
  if (!res.ok) throw new Error('Failed to fetch dataset info')
  return res.json()
}

export async function fetchRandomAnimal(daily = false): Promise<string> {
  const res = await fetch(`${BASE}/animal/random?daily=${daily}`)
  if (!res.ok) throw new Error('Failed to fetch animal')
  return res.json()
}

export async function fetchAutocomplete(q: string, limit = 30, exclude: string[] = []): Promise<string[]> {
  const params = new URLSearchParams({ q, limit: String(limit) })
  for (const name of exclude) params.append('exclude', name)
  const res = await fetch(`${BASE}/animals?${params}`)
  if (!res.ok) throw new Error('Failed to fetch animals')
  return res.json()
}

export async function fetchGameState(secret: string, guesses: string[]): Promise<TreeNode> {
  const res = await fetch(`${BASE}/game/state`, {
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

export async function fetchTaxonInfo(name: string): Promise<TaxonInfo | null> {
  const res = await fetch(`${BASE}/taxon/${encodeURIComponent(name)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch taxon info')
  return res.json()
}

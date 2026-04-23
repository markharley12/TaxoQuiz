const BASE = '/api'

export async function fetchRandomAnimal(daily = false) {
  const res = await fetch(`${BASE}/animal/random?daily=${daily}`)
  if (!res.ok) throw new Error('Failed to fetch animal')
  return res.json()
}

export async function fetchAutocomplete(q, limit = 30) {
  const res = await fetch(`${BASE}/animals?q=${encodeURIComponent(q)}&limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch animals')
  return res.json()
}

export async function fetchGameState(secret, guesses) {
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

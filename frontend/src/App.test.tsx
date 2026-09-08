/**
 * Tests for App — the round: starting one, guessing, winning, giving up, and
 * surviving a reload.
 *
 * These are the first tests of a component rather than of a pure module, and
 * they are deliberately about *behaviour a player would notice*, not about
 * markup. Anything to do with how the trees look on a screen is still
 * eyes-only, which is why both tree components are stubbed here: they render
 * react-d3-tree, which measures SVG that jsdom does not lay out, and none of
 * what they draw is what these tests are asking about.
 *
 * The API is stubbed for the same reason the Python suite has no network in it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fetchAnimal = vi.fn()
const fetchGameState = vi.fn()
const fetchAutocomplete = vi.fn()
const fetchDatasets = vi.fn()

vi.mock('./api', () => ({
  fetchAnimal: (...a: unknown[]) => fetchAnimal(...a),
  fetchGameState: (...a: unknown[]) => fetchGameState(...a),
  fetchAutocomplete: (...a: unknown[]) => fetchAutocomplete(...a),
  fetchDatasets: (...a: unknown[]) => fetchDatasets(...a),
}))

// The trees draw with react-d3-tree; what they draw is checked by eye. Stubbed
// down to "did App hand me a tree at all", which is the part App is answerable
// for.
vi.mock('./components/GameTree', () => ({
  default: ({ treeData }: { treeData: unknown }) => (
    <div data-testid="game-tree">{treeData ? 'tree' : 'empty'}</div>
  ),
}))
vi.mock('./components/ExploreTree', () => ({
  default: () => <div data-testid="explore-tree" />,
}))

// GuessInput is an MUI Autocomplete. Driving it through the DOM would be a test
// of MUI; what App is answerable for is what it does with the name it is given,
// so the stub is a button that hands one over.
vi.mock('./components/GuessInput', () => ({
  default: ({ onGuess, disabled }: { onGuess: (a: string) => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={() => onGuess(nextGuess)}>submit guess</button>
  ),
}))

/** What the stubbed GuessInput will hand to App on the next click. */
let nextGuess = 'tiger'

const STORAGE_KEY = 'taxoquiz_session'
const today = () => new Date().toISOString().slice(0, 10)

/** A saved session as App writes it. */
function session(over: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    mode: 'practice', secret: 'lion', seed: 'RZVM-X6N69Q',
    guesses: ['tiger'], won: false, revealed: false, date: today(),
    ...over,
  })
}

const TREE = { name: 'Animalia', label: 'Animalia', node_type: 'ancestor', warmth: 0,
               depth: 0, on_secret_path: true, children: [] }

async function renderApp() {
  const { default: App } = await import('./App')
  return render(<App />)
}

beforeEach(() => {
  nextGuess = 'tiger'
  localStorage.clear()
  fetchAnimal.mockResolvedValue({ animal: 'lion', seed: 'RZVM-X6N69Q' })
  fetchGameState.mockResolvedValue(TREE)
  fetchAutocomplete.mockResolvedValue([])
  fetchDatasets.mockResolvedValue([])
  vi.resetModules()
})

afterEach(cleanup)

describe('starting a round', () => {
  it('offers the three modes before a game exists', async () => {
    await renderApp()
    expect(screen.getByRole('button', { name: /today.s animal/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /practice/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /explore/i })).toBeTruthy()
  })

  it('shows the seed, because that is the whole sharing mechanism', async () => {
    // Daily is not a separate path — it is a seed derived from the date. If the
    // seed is not on screen there is no way to hand a round to anyone.
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /practice/i }))
    expect(await screen.findByText('RZVM-X6N69Q')).toBeTruthy()
  })

  it('reports a rejected seed instead of half-starting a round', async () => {
    // A seed carries a fingerprint of the dataset's species list, so one from
    // the 530-species example is refused on a 41k scrape rather than silently
    // resolving to a different animal. The client half of that contract: say
    // so, and stay on the start screen.
    await renderApp()
    fetchAnimal.mockRejectedValueOnce(new Error('Seed is for a different dataset'))

    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: 'ABCD-234567' } })
    fireEvent.click(screen.getByRole('button', { name: /play seed/i }))

    expect(await screen.findByText(/different dataset/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /today.s animal/i })).toBeTruthy()
  })

  it('leaves the round alone when starting a new one fails', async () => {
    // The failure this guards: half-starting a game on the error path, which
    // would drop the guesses of the round already in progress.
    localStorage.setItem(STORAGE_KEY, session())
    await renderApp()
    await screen.findByText('RZVM-X6N69Q')

    fetchAnimal.mockRejectedValueOnce(new Error('nope'))
    fireEvent.click(screen.getByRole('button', { name: /new animal/i }))

    // Wait for the rejection to settle, then the same round must still be here.
    await waitFor(() => expect(fetchAnimal).toHaveBeenCalled())
    expect(await screen.findByText('RZVM-X6N69Q')).toBeTruthy()
    expect(screen.getByText('Tiger')).toBeTruthy()
  })
})

describe('guessing', () => {
  it('sends every guess so far, not just the newest', async () => {
    // The API returns the whole display tree rather than a per-guess report, so
    // it needs the full list each time. Sending only the latest would collapse
    // the tree to a single branch on every guess.
    localStorage.setItem(STORAGE_KEY, session({ guesses: [] }))
    await renderApp()
    await screen.findByText('RZVM-X6N69Q')

    nextGuess = 'tiger'
    fireEvent.click(screen.getByRole('button', { name: /submit guess/i }))
    await waitFor(() => expect(fetchGameState).toHaveBeenCalledTimes(1))

    nextGuess = 'grey wolf'
    fireEvent.click(screen.getByRole('button', { name: /submit guess/i }))
    await waitFor(() => expect(fetchGameState).toHaveBeenCalledTimes(2))

    expect(fetchGameState.mock.calls[1][1]).toEqual(['tiger', 'grey wolf'])
  })

  it('decides the win on the client, with no extra round trip', async () => {
    // /animal already hands the client the secret and localStorage keeps it, so
    // the win needs no API call to confirm. That is the same property that lets
    // giving up be entirely client-side.
    localStorage.setItem(STORAGE_KEY, session({ guesses: [] }))
    await renderApp()
    await screen.findByText('RZVM-X6N69Q')

    const callsBefore = fetchAnimal.mock.calls.length
    nextGuess = 'lion'          // the secret in the restored session
    fireEvent.click(screen.getByRole('button', { name: /submit guess/i }))

    expect(await screen.findByText(/you got it/i)).toBeTruthy()
    expect(fetchAnimal.mock.calls.length).toBe(callsBefore)
  })

  it('takes the input away once the round is over', async () => {
    localStorage.setItem(STORAGE_KEY, session({ guesses: ['tiger'], won: true }))
    await renderApp()
    await screen.findByText(/you got it/i)
    expect(screen.queryByRole('button', { name: /submit guess/i })).toBeNull()
  })
})

describe('restoring a session', () => {
  it('comes back to the round that was in progress', async () => {
    localStorage.setItem(STORAGE_KEY, session())
    await renderApp()
    expect(await screen.findByText('RZVM-X6N69Q')).toBeTruthy()
    expect(screen.getByText('Tiger')).toBeTruthy()   // capitalised for display
  })

  it('re-fetches the tree, because the tree is not persisted', async () => {
    localStorage.setItem(STORAGE_KEY, session({ guesses: ['tiger', 'grey wolf'] }))
    await renderApp()
    await waitFor(() => expect(fetchGameState).toHaveBeenCalled())
    expect(fetchGameState).toHaveBeenCalledWith('lion', ['tiger', 'grey wolf'], '')
  })

  it('does not ask for a state with no guesses', async () => {
    // get_game_state(secret, []) returns null, because the union of no lineages
    // prunes the root away. The frontend guards on guesses.length > 0 rather
    // than the API special-casing it, so the guard is what has to hold.
    localStorage.setItem(STORAGE_KEY, session({ guesses: [] }))
    await renderApp()
    await screen.findByText('RZVM-X6N69Q')
    expect(fetchGameState).not.toHaveBeenCalled()
  })

  it('drops a daily round from a previous day', async () => {
    // Today's daily is the same for everyone; yesterday's is not today's. A
    // stale daily must land on the mode picker rather than resuming.
    localStorage.setItem(STORAGE_KEY, session({ mode: 'daily', date: '2020-01-01' }))
    await renderApp()
    expect(screen.getByRole('button', { name: /today.s animal/i })).toBeTruthy()
  })

  it('keeps a practice round from a previous day', async () => {
    // Practice is not tied to a date, so the date check must not catch it.
    localStorage.setItem(STORAGE_KEY, session({ mode: 'practice', date: '2020-01-01' }))
    await renderApp()
    expect(await screen.findByText('RZVM-X6N69Q')).toBeTruthy()
  })

  it('starts fresh rather than crashing on unreadable storage', async () => {
    // localStorage is shared with whatever else the origin has ever stored, and
    // an older build's shape must not white-screen the app.
    localStorage.setItem(STORAGE_KEY, '{not json')
    await renderApp()
    expect(screen.getByRole('button', { name: /today.s animal/i })).toBeTruthy()
  })
})

describe('giving up', () => {
  it('asks first, because it cannot be undone', async () => {
    localStorage.setItem(STORAGE_KEY, session())
    await renderApp()
    fireEvent.click(await screen.findByRole('button', { name: /give up/i }))
    expect(screen.getByText(/give up and see the answer/i)).toBeTruthy()
  })

  it('reveals the answer and takes the input away', async () => {
    localStorage.setItem(STORAGE_KEY, session())
    await renderApp()
    fireEvent.click(await screen.findByRole('button', { name: /give up/i }))
    fireEvent.click(screen.getByRole('button', { name: /show me/i }))

    expect(await screen.findByText(/the answer was/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /give up/i })).toBeNull()
  })

  it('stays given up across a reload', async () => {
    // Persisted with the session, or a reload hands the round back with its
    // answer already spent.
    localStorage.setItem(STORAGE_KEY, session({ revealed: true }))
    await renderApp()
    expect(await screen.findByText(/the answer was/i)).toBeTruthy()
  })

  it('reads a session saved before giving up existed as not given up', async () => {
    // `revealed` is absent in those, and absent must mean false — the round is
    // still playable, which is the right answer for them.
    const old = JSON.parse(session()) as Record<string, unknown>
    delete old.revealed
    localStorage.setItem(STORAGE_KEY, JSON.stringify(old))
    await renderApp()
    expect(await screen.findByRole('button', { name: /give up/i })).toBeTruthy()
  })
})

describe('changing mode', () => {
  it('forgets the round, so the next one does not resume it', async () => {
    localStorage.setItem(STORAGE_KEY, session())
    await renderApp()
    fireEvent.click(await screen.findByRole('button', { name: /change mode/i }))
    expect(screen.getByRole('button', { name: /today.s animal/i })).toBeTruthy()
  })
})

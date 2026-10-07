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
  default: ({ onGuess, onBulkGuess, bulk, disabled }: {
    onGuess: (a: string) => void
    onBulkGuess?: (a: string[]) => void
    bulk?: { clade: string } | null
    disabled?: boolean
  }) => (
    <>
      <button disabled={disabled} onClick={() => onGuess(nextGuess)}>submit guess</button>
      <button disabled={disabled} onClick={() => onBulkGuess?.(nextBulk)}>submit bulk</button>
      <span data-testid="bulk">{bulk ? bulk.clade : 'locked'}</span>
    </>
  ),
}))

/** What the stubbed GuessInput will hand to App on the next click. */
let nextGuess = 'tiger'
/** What the stubbed GuessInput hands over as a bulk guess. */
let nextBulk = ['cheetah', 'lion']

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

/** Lion is the secret; the one guess shares `lcaRank` with it. */
function closeTree(lcaName: string, lcaRank: string, lcaWarmth: number, canHint = true) {
  return { ...TREE, children: [{
    name: lcaName, label: lcaName, rank: lcaRank, node_type: 'ancestor', warmth: lcaWarmth,
    depth: 1, on_secret_path: true, children: [
      { name: 'Panthera tigris', label: 'tiger', rank: 'Species', node_type: 'guess', warmth: 1,
        depth: 2, on_secret_path: false, lca_depth: 1, lca_warmth: lcaWarmth, children: [] },
      { name: null, label: '???', rank: '', node_type: 'secret', warmth: lcaWarmth,
        depth: 2, on_secret_path: true, can_hint: canHint, children: [] },
    ],
  }] }
}

async function renderApp() {
  const { default: App } = await import('./App')
  return render(<App />)
}

beforeEach(() => {
  nextGuess = 'tiger'
  nextBulk = ['cheetah', 'lion']
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
    expect(fetchGameState).toHaveBeenCalledWith('lion', ['tiger', 'grey wolf'], '', 0)
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

describe('the end of a round', () => {
  it('says how many guesses a win took', async () => {
    localStorage.setItem(STORAGE_KEY, session({ guesses: [] }))
    await renderApp()
    await screen.findByText('RZVM-X6N69Q')
    nextGuess = 'tiger'
    fireEvent.click(screen.getByRole('button', { name: /submit guess/i }))
    await waitFor(() => expect(fetchGameState).toHaveBeenCalledTimes(1))
    nextGuess = 'lion'
    fireEvent.click(screen.getByRole('button', { name: /submit guess/i }))
    expect(await screen.findByText(/you got it in 2 guesses/i)).toBeTruthy()
  })

  it('scores a give-up by the closest guess and the group it shared', async () => {
    fetchGameState.mockResolvedValue(closeTree('Carnivora', 'Order', 0.5))
    localStorage.setItem(STORAGE_KEY, session())
    await renderApp()
    fireEvent.click(await screen.findByRole('button', { name: /give up/i }))
    fireEvent.click(screen.getByRole('button', { name: /show me/i }))
    expect(await screen.findByText(/closest guess, Tiger, shared the order Carnivora — 50% of the way/)).toBeTruthy()
  })

  it('keeps bulk guessing locked above an order, and opens it at one', async () => {
    fetchGameState.mockResolvedValue(closeTree('Batomorphi', 'Superorder', 0.49))
    localStorage.setItem(STORAGE_KEY, session())
    await renderApp()
    await waitFor(() => expect(fetchGameState).toHaveBeenCalled())
    expect((await screen.findByTestId('bulk')).textContent).toBe('locked')

    cleanup()
    fetchGameState.mockResolvedValue(closeTree('Myliobatiformes', 'Order', 0.5))
    await renderApp()
    await waitFor(() => expect(screen.getByTestId('bulk').textContent).toBe('Myliobatiformes'))
  })

  it('counts every species in a bulk guess, and wins if one is the answer', async () => {
    localStorage.setItem(STORAGE_KEY, session({ guesses: ['tiger'] }))
    await renderApp()
    await screen.findByText('RZVM-X6N69Q')
    nextBulk = ['cheetah', 'lion']
    fireEvent.click(screen.getByRole('button', { name: /submit bulk/i }))
    await waitFor(() => expect(fetchGameState).toHaveBeenLastCalledWith('lion', ['tiger', 'cheetah', 'lion'], '', 0))
    expect(await screen.findByText(/you got it in 3 guesses/i)).toBeTruthy()
  })
})

describe('hints', () => {
  it('cost the score again, at least 10, and count in the win', async () => {
    fetchGameState.mockResolvedValue(closeTree('Carnivora', 'Order', 0.5))
    localStorage.setItem(STORAGE_KEY, session({ guesses: ['tiger'] }))
    await renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Hint +10' }))
    expect(screen.getByText(/adds 10 to your score: 1 → 11/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal (+10)' }))
    await waitFor(() => expect(fetchGameState).toHaveBeenLastCalledWith('lion', ['tiger'], '', 1))
    // The score is now 11, so the next hint doubles it.
    expect(await screen.findByRole('button', { name: 'Hint +11' })).toBeTruthy()

    nextGuess = 'lion'
    fireEvent.click(screen.getByRole('button', { name: /submit guess/i }))
    expect(await screen.findByText(/you got it in 12 \(2 guesses \+ 10 for a hint\)/i)).toBeTruthy()
  })

  it('keep their count and cost across a reload, and the tree they revealed', async () => {
    localStorage.setItem(STORAGE_KEY, session({ guesses: [], hints: 2, hintPoints: 30 }))
    await renderApp()
    // A round with hints and no guesses still has a tree to fetch.
    await waitFor(() => expect(fetchGameState).toHaveBeenCalledWith('lion', [], '', 2))
    expect(await screen.findByRole('button', { name: 'Hint +30' })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ hints: 2, hintPoints: 30 })
  })

  it('can be taken before the first guess', async () => {
    localStorage.setItem(STORAGE_KEY, session({ guesses: [] }))
    await renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Hint +10' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal (+10)' }))
    await waitFor(() => expect(fetchGameState).toHaveBeenLastCalledWith('lion', [], '', 1))
  })

  it('are disabled once only the answer is left below the ??? node', async () => {
    fetchGameState.mockResolvedValue(closeTree('Panthera', 'Genus', 5 / 6, false))
    localStorage.setItem(STORAGE_KEY, session())
    await renderApp()
    await waitFor(() => expect(fetchGameState).toHaveBeenCalled())
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /^Hint/ }) as HTMLButtonElement).disabled).toBe(true))
  })
})

describe('shared links', () => {
  /** Arrive at the page the way a tapped link does. */
  const arriveAt = (search: string) => window.history.replaceState(null, '', `/${search}`)
  afterEach(() => arriveAt(''))

  it('copies a link to the round, not only the code', async () => {
    // A bare code has to be pasted into a box on a site the friend must find;
    // a link is one tap.
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /practice/i }))
    fireEvent.click(await screen.findByRole('button', { name: /link to this round/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?seed=RZVM-X6N69Q`))
    vi.unstubAllGlobals()
  })

  it("starts the link's round, and takes the seed out of the address", async () => {
    // Left in, a reload would offer to restart the round being played.
    arriveAt('?seed=RZVM-X6N69Q')
    await renderApp()
    await waitFor(() => expect(fetchAnimal).toHaveBeenCalledWith(expect.objectContaining({ seed: 'RZVM-X6N69Q' })))
    expect(await screen.findByText('RZVM-X6N69Q')).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('asks before a link replaces a round in progress', async () => {
    // Opening a link is not a decision to throw away a daily half-played.
    localStorage.setItem(STORAGE_KEY, session({ mode: 'daily' }))
    arriveAt('?seed=J3XF-ABC234')
    await renderApp()
    fireEvent.click(await screen.findByRole('button', { name: /keep my round/i }))
    expect(fetchAnimal).not.toHaveBeenCalled()
    expect(screen.getByText('RZVM-X6N69Q')).toBeTruthy()
  })

  it('replaces it when told to', async () => {
    localStorage.setItem(STORAGE_KEY, session())
    arriveAt('?seed=J3XF-ABC234')
    await renderApp()
    fireEvent.click(await screen.findByRole('button', { name: /play the link/i }))
    await waitFor(() => expect(fetchAnimal).toHaveBeenCalledWith(expect.objectContaining({ seed: 'J3XF-ABC234' })))
  })

  it('just resumes when the link is the round already being played', async () => {
    // The sender opening their own link, or a reload before the address was cleaned.
    localStorage.setItem(STORAGE_KEY, session())
    arriveAt('?seed=rzvm x6n69q')
    await renderApp()
    expect(await screen.findByText('Tiger')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /play the link/i })).toBeNull()
    expect(fetchAnimal).not.toHaveBeenCalled()
  })

  it('points a seed from the other site at that site', async () => {
    await renderApp()
    fetchAnimal.mockRejectedValueOnce(new Error('Seed is for a different dataset'))
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '08NY-VMYV01' } })
    fireEvent.click(screen.getByRole('button', { name: /play seed/i }))
    const link = await screen.findByRole('link', { name: /play it on taxoquiz full/i })
    expect(link.getAttribute('href')).toBe('https://markharley12.github.io/TaxoQuiz/full/?seed=08NY-VMYV01')
  })
})

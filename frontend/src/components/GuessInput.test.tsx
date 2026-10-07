/**
 * The bulk-guess row heading the suggestions.
 *
 * This drives MUI's Autocomplete through the DOM, which App.test.tsx avoids as
 * "a test of MUI". Here the subject is the component's own addition — whether
 * the row is offered, what it names, and what submitting it hands over — and a
 * stub would test nothing of that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ExploreNode } from '../api'

const fetchAutocomplete = vi.fn()
const fetchExplore = vi.fn()

vi.mock('../api', () => ({
  fetchAutocomplete: (...a: unknown[]) => fetchAutocomplete(...a),
  fetchExplore: (...a: unknown[]) => fetchExplore(...a),
}))

function species(name: string): ExploreNode {
  return { name, common_name: name, rank: 'Species', depth: 3, warmth: 1, child_count: 0,
           species_count: 1, node_count: 1, truncated: false, children: [] }
}

function group(name: string, names: string[]): ExploreNode {
  return { name, rank: 'Genus', depth: 2, warmth: 5 / 6, child_count: names.length,
           species_count: names.length, node_count: names.length + 1, truncated: false,
           children: names.map(species) }
}

const PANTHERA = group('Panthera', ['lion', 'tiger', 'leopard', 'snow leopard', 'jaguar'])

async function renderInput(props: { bulk?: { clade: string; rank: string } | null; exclude?: string[] } = {}) {
  const { default: GuessInput } = await import('./GuessInput')
  const onGuess = vi.fn()
  const onBulkGuess = vi.fn()
  render(
    <GuessInput onGuess={onGuess} onBulkGuess={onBulkGuess} disabled={false}
                bulk={props.bulk === undefined ? { clade: 'Panthera', rank: 'Genus' } : props.bulk}
                exclude={props.exclude ?? ['tiger']} />,
  )
  return { onGuess, onBulkGuess, input: screen.getByLabelText('Enter your guess') }
}

beforeEach(() => {
  fetchAutocomplete.mockResolvedValue(['leopard', 'snow leopard'])
  fetchExplore.mockResolvedValue(PANTHERA)
})

afterEach(cleanup)

describe('bulk guessing in the suggestions', () => {
  it('heads the list with the row, and submitting it guesses every matching species', async () => {
    const { input, onBulkGuess, onGuess } = await renderInput()
    fireEvent.change(input, { target: { value: 'leopard' } })

    const row = await screen.findByText('Guess all 2 named "leopard" in Panthera')
    // Above every suggestion, where it cannot be missed — it was the last row,
    // under as many as 50 names.
    const first = screen.getAllByRole('option')[0]
    expect(row.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.mouseDown(row)
    fireEvent.click(screen.getByRole('button', { name: 'Guess all 2' }))
    expect(onBulkGuess).toHaveBeenCalledWith(['leopard', 'snow leopard'])
    expect(onGuess).not.toHaveBeenCalled()
    // The group's species came from explore, confined to the reached group.
    expect(fetchExplore).toHaveBeenCalledWith('Panthera', -1, '')
  })

  it('leaves Enter on the first species, never on the bulk row', async () => {
    // As the first *option* the row would be highlighted, and Enter would have
    // spent a guess per species instead of one on the name typed.
    const { input, onBulkGuess, onGuess } = await renderInput()
    fireEvent.change(input, { target: { value: 'leopard' } })
    await screen.findByText('Guess all 2 named "leopard" in Panthera')

    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Guess' }))
    expect(onGuess).toHaveBeenCalledWith('leopard')
    expect(onBulkGuess).not.toHaveBeenCalled()
  })

  it('offers nothing while bulk guessing is locked', async () => {
    const { input } = await renderInput({ bulk: null })
    fireEvent.change(input, { target: { value: 'leopard' } })
    expect(await screen.findByText('Leopard')).toBeTruthy()
    expect(screen.queryByText(/Guess all/)).toBeNull()
    expect(fetchExplore).not.toHaveBeenCalled()
  })

  it('shows a word with too many species, but will not guess them', async () => {
    const owls = Array.from({ length: 101 }, (_, i) => `owl number ${i + 1}`)
    fetchExplore.mockResolvedValue(group('Strigidae', owls))
    fetchAutocomplete.mockResolvedValue(owls.slice(0, 3))
    const { input } = await renderInput({ bulk: { clade: 'Strigidae', rank: 'Family' }, exclude: [] })
    fireEvent.change(input, { target: { value: 'owl' } })

    const row = await screen.findByText(/101 named "owl" in Strigidae — too many at once \(max 100\)/)
    expect(row.getAttribute('aria-disabled')).toBe('true')
    fireEvent.mouseDown(row)
    expect(screen.getByRole('button', { name: 'Guess' })).toBeTruthy()
  })

  it('offers no row for a single match, which is an ordinary guess already listed', async () => {
    fetchAutocomplete.mockResolvedValue(['jaguar'])
    const { input } = await renderInput()
    fireEvent.change(input, { target: { value: 'jaguar' } })
    expect(await screen.findByText('Jaguar')).toBeTruthy()
    await waitFor(() => expect(fetchExplore).toHaveBeenCalled())
    expect(screen.queryByText(/Guess all/)).toBeNull()
  })
})

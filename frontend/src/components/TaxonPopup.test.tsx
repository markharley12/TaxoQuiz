import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import TaxonPopup from './TaxonPopup'
import type { TaxonInfo } from '../api'

const INFO: Record<string, TaxonInfo> = {
  Lissonycteris: {
    rank: 'Genus', common_name: '', qid: 'Q1', image_url: '',
    description: 'The Angolan fruit bat (Myonycteris angolensis) is a species of megabat.',
    wikipedia_url: 'https://en.wikipedia.org/wiki/Angolan_fruit_bat',
    wikipedia_title: 'Angolan fruit bat',
  },
  'Panthera leo': {
    rank: 'Species', common_name: 'lion', qid: 'Q140', image_url: '',
    description: 'The lion is a large cat.',
    wikipedia_url: 'https://en.wikipedia.org/wiki/Lion', wikipedia_title: 'Lion',
  },
}

vi.mock('../taxonCache', () => ({
  loadTaxonInfo: (name: string) => Promise.resolve(INFO[name] ?? null),
}))

afterEach(cleanup)

describe('TaxonPopup', () => {
  it('names the article when the text is about another taxon', async () => {
    // An obsolete genus redirected to its species: without the title, the
    // popup reads as having the wrong animal.
    render(<TaxonPopup names={['Lissonycteris']} onClose={() => {}} />)
    expect(await screen.findByText(/article “Angolan fruit bat”/)).toBeTruthy()
  })

  it('says only "From Wikipedia" when the article is the node\'s own', async () => {
    render(<TaxonPopup names={['Panthera leo']} onClose={() => {}} />)
    expect(await screen.findByText('From Wikipedia')).toBeTruthy()
    expect(screen.queryByText(/article “/)).toBeNull()
  })
})

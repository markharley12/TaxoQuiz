import { useRef, useState } from 'react'
import { Autocomplete, TextField, Button, Box } from '@mui/material'
import { fetchAutocomplete, fetchExplore, type ExploreNode } from '../api'
import { useSettings } from '../settings'
import { displayName } from '../names'
import { BULK_CAP, bulkMatches, isBulkQuery } from '../endgame'

/** The last row of the suggestions once bulk guessing has unlocked: every
 *  species in the reached group named with the typed word. See endgame.ts. */
interface BulkOption {
  kind: 'bulk'
  word: string
  names: string[]
  clade: string
}

type Option = string | BulkOption

interface Props {
  onGuess: (animal: string) => void
  /** Guess several names at once. No bulk row is offered without it. */
  onBulkGuess?: (animals: string[]) => void
  /** Where a bulk guess may reach; null while it is locked. */
  bulk?: { clade: string; rank: string } | null
  disabled: boolean
  exclude?: string[]
}

/** How many suggestions to ask for. It was 30, and in tree order, so on the
 *  41k-species dataset "cat" put the domestic cat at 128th; ranking is the fix
 *  (exact, then whole word — see matchTier), and a longer list helps a word
 *  with many whole-word matches like "crow", which has 56. */
const SUGGESTIONS = 50

const isBulk = (option: Option | null): option is BulkOption =>
  typeof option === 'object' && option !== null

function speciesNames(node: ExploreNode, out: string[] = []): string[] {
  if (node.child_count === 0 && node.common_name) out.push(node.common_name)
  for (const child of node.children) speciesNames(child, out)
  return out
}

export default function GuessInput({ onGuess, onBulkGuess, bulk, disabled, exclude = [] }: Props) {
  const [options, setOptions] = useState<Option[]>([])
  const [value, setValue] = useState<Option | null>(null)
  const [inputValue, setInputValue] = useState('')
  const { dataset } = useSettings()
  // The species under a group, fetched once per group rather than per keystroke.
  // An order can run to a few thousand names; the cap applies after.
  const groups = useRef(new Map<string, Promise<string[]>>())

  function namesUnder(clade: string): Promise<string[]> {
    const key = `${dataset}\u0000${clade}`
    let pending = groups.current.get(key)
    if (!pending) {
      pending = fetchExplore(clade, -1, dataset).then((tree) => speciesNames(tree))
      pending.catch(() => groups.current.delete(key))   // a failure is retried, not kept
      groups.current.set(key, pending)
    }
    return pending
  }

  async function handleInputChange(_: unknown, newInput: string) {
    setInputValue(newInput)
    const query = newInput.trim()
    if (query.length < 2) {
      setOptions([])
      return
    }
    const results: Option[] = await fetchAutocomplete(query, SUGGESTIONS, exclude, dataset)
    if (bulk && onBulkGuess && isBulkQuery(query)) {
      try {
        const names = bulkMatches(await namesUnder(bulk.clade), query, exclude)
        // One match is an ordinary guess, already in the list above.
        if (names.length > 1) results.push({ kind: 'bulk', word: query, names, clade: bulk.clade })
      } catch {
        // The ordinary suggestions still stand without the bulk row.
      }
    }
    setOptions(results)
  }

  function label(option: Option): string {
    // Display only for a species. The option *value* stays the dataset's own
    // name, which is what gets submitted — the API matches a guess exactly and
    // answers "Unknown animal: 'Lion'" otherwise.
    if (!isBulk(option)) return displayName(option)
    const count = option.names.length
    return count > BULK_CAP
      ? `${count} named "${option.word}" in ${option.clade} — too many at once (max ${BULK_CAP})`
      : `Guess all ${count} named "${option.word}" in ${option.clade}`
  }

  const tooMany = (option: Option | null) => isBulk(option) && option.names.length > BULK_CAP

  function handleSubmit() {
    if (isBulk(value)) {
      if (!tooMany(value)) onBulkGuess?.(value.names)
    } else {
      const trimmed = (value ?? '').trim()
      if (!trimmed) return
      onGuess(trimmed)
    }
    setValue(null)
    setInputValue('')
    setOptions([])
  }

  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Autocomplete<Option, false, false, false>
        options={options}
        value={value}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onChange={(_, newValue) => setValue(newValue)}
        filterOptions={(x) => x}
        getOptionLabel={label}
        getOptionDisabled={tooMany}
        isOptionEqualToValue={(a, b) => a === b}
        disabled={disabled}
        autoHighlight
        autoSelect
        sx={{ width: 300 }}
        renderInput={(params) => (
          <TextField {...params} label="Enter your guess" size="small" />
        )}
      />
      <Button
        variant="contained"
        onClick={handleSubmit}
        disabled={disabled || !value || tooMany(value)}
        sx={{ whiteSpace: 'nowrap' }}
      >
        {isBulk(value) ? `Guess all ${value.names.length}` : 'Guess'}
      </Button>
    </Box>
  )
}

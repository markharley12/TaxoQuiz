import { useRef, useState, type ReactNode } from 'react'
import { Autocomplete, TextField, Button, Box, ButtonBase, Paper, type PaperProps } from '@mui/material'
import { fetchAutocomplete, fetchExplore, type ExploreNode } from '../api'
import { useSettings } from '../settings'
import { displayName } from '../names'
import { BULK_CAP, bulkMatches, isBulkQuery } from '../endgame'

/** The row heading the suggestions once bulk guessing has unlocked: every
 *  species in the reached group named with the typed word. See endgame.ts. */
interface BulkOption {
  kind: 'bulk'
  word: string
  names: string[]
  clade: string
}

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

/** The suggestions' paper with the bulk row on top. A header rather than an
 *  option: see the note on the bulk row below. */
function SuggestionsPaper({ header, children, ...rest }: PaperProps & { header?: ReactNode }) {
  return <Paper {...rest}>{header}{children}</Paper>
}

function speciesNames(node: ExploreNode, out: string[] = []): string[] {
  if (node.child_count === 0 && node.common_name) out.push(node.common_name)
  for (const child of node.children) speciesNames(child, out)
  return out
}

export default function GuessInput({ onGuess, onBulkGuess, bulk, disabled, exclude = [] }: Props) {
  const [options, setOptions] = useState<string[]>([])
  const [value, setValue] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  // The bulk row on offer for what is typed, and the one chosen, if any. Kept
  // out of the Autocomplete's options and value — see the bulk row below.
  const [offer, setOffer] = useState<BulkOption | null>(null)
  const [chosen, setChosen] = useState<BulkOption | null>(null)
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

  async function handleInputChange(_: unknown, newInput: string, reason: string) {
    setInputValue(newInput)
    // Typing again un-chooses the bulk row; the reset MUI does on its own
    // after a choice does not.
    if (reason !== 'input') return
    setChosen(null)
    const query = newInput.trim()
    if (query.length < 2) {
      setOptions([])
      setOffer(null)
      return
    }
    const results = await fetchAutocomplete(query, SUGGESTIONS, exclude, dataset)
    let next: BulkOption | null = null
    if (bulk && onBulkGuess && isBulkQuery(query)) {
      try {
        const names = bulkMatches(await namesUnder(bulk.clade), query, exclude)
        // One match is an ordinary guess, already in the list below it.
        if (names.length > 1) next = { kind: 'bulk', word: query, names, clade: bulk.clade }
      } catch {
        // The ordinary suggestions still stand without the bulk row.
      }
    }
    setOptions(results)
    setOffer(next)
  }

  function bulkLabel(option: BulkOption): string {
    const count = option.names.length
    return count > BULK_CAP
      ? `${count} named "${option.word}" in ${option.clade} — too many at once (max ${BULK_CAP})`
      : `Guess all ${count} named "${option.word}" in ${option.clade}`
  }

  const tooMany = (option: BulkOption | null) => option !== null && option.names.length > BULK_CAP

  function chooseBulk(option: BulkOption) {
    setChosen(option)
    setValue(null)
    setInputValue(bulkLabel(option))
    setOpen(false)
  }

  function handleSubmit() {
    if (chosen) {
      if (!tooMany(chosen)) onBulkGuess?.(chosen.names)
    } else {
      const trimmed = (value ?? '').trim()
      if (!trimmed) return
      onGuess(trimmed)
    }
    setValue(null)
    setChosen(null)
    setOffer(null)
    setInputValue('')
    setOptions([])
  }

  // The bulk row heads the list, so it is the first thing seen once a bulk
  // guess is possible (it was the last row, below up to 50 names, and easy to
  // miss). It is a header and not an option because the list highlights its
  // first option and Enter, or tapping away, takes the highlighted one: as the
  // first option, typing "lion" and pressing Enter would have guessed every
  // lion in the group, up to a hundred guesses on the score. Choosing it still
  // only arms the Guess button, as before.
  const header = offer && (
    <ButtonBase
      component="div"
      role="button"
      aria-disabled={tooMany(offer)}
      disabled={tooMany(offer)}
      // mousedown, not click: the input must keep focus, or the list closes
      // and takes the row with it before the click lands.
      onMouseDown={(e) => {
        e.preventDefault()
        if (!tooMany(offer)) chooseBulk(offer)
      }}
      sx={{
        display: 'block', width: '100%', textAlign: 'left',
        px: 2, py: 1.25, fontWeight: 600, fontSize: '0.9rem',
        color: tooMany(offer) ? 'text.disabled' : 'primary.contrastText',
        bgcolor: tooMany(offer) ? 'action.disabledBackground' : 'primary.main',
        '&:hover': { bgcolor: tooMany(offer) ? undefined : 'primary.dark' },
      }}
    >
      {bulkLabel(offer)}
    </ButtonBase>
  )

  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Autocomplete<string, false, false, false>
        options={options}
        value={value}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onChange={(_, newValue) => { setValue(newValue); setChosen(null) }}
        open={open && (options.length > 0 || offer !== null)}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        filterOptions={(x) => x}
        // Display only. The option *value* stays the dataset's own name, which
        // is what gets submitted — the API matches a guess exactly and answers
        // "Unknown animal: 'Lion'" otherwise.
        getOptionLabel={displayName}
        isOptionEqualToValue={(a, b) => a === b}
        disabled={disabled}
        autoHighlight
        autoSelect
        // A chosen bulk row is not the value, so blurring to press Guess must
        // not clear the text that says what is about to be guessed.
        clearOnBlur={!chosen}
        slots={{ paper: SuggestionsPaper }}
        slotProps={{ paper: { header } as PaperProps }}
        sx={{ width: 300 }}
        renderInput={(params) => (
          <TextField {...params} label="Enter your guess" size="small" />
        )}
      />
      <Button
        variant="contained"
        onClick={handleSubmit}
        disabled={disabled || (chosen ? tooMany(chosen) : !value)}
        sx={{ whiteSpace: 'nowrap' }}
      >
        {chosen ? `Guess all ${chosen.names.length}` : 'Guess'}
      </Button>
    </Box>
  )
}

import { useState } from 'react'
import { Autocomplete, TextField, Button, Box } from '@mui/material'
import { fetchAutocomplete } from '../api'
import { useSettings } from '../settings'

interface Props {
  onGuess: (animal: string) => void
  disabled: boolean
  exclude?: string[]
}

export default function GuessInput({ onGuess, disabled, exclude = [] }: Props) {
  const [options, setOptions] = useState<string[]>([])
  const [value, setValue] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const { dataset } = useSettings()

  async function handleInputChange(_: unknown, newInput: string) {
    setInputValue(newInput)
    if (newInput.trim().length < 2) {
      setOptions([])
      return
    }
    const results = await fetchAutocomplete(newInput.trim(), 30, exclude, dataset)
    setOptions(results)
  }

  function handleSubmit() {
    const trimmed = (value ?? '').trim()
    if (!trimmed) return
    onGuess(trimmed)
    setValue(null)
    setInputValue('')
    setOptions([])
  }

  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Autocomplete
        options={options}
        value={value}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onChange={(_, newValue) => setValue(newValue)}
        filterOptions={(x) => x}
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
        disabled={disabled || !value}
      >
        Guess
      </Button>
    </Box>
  )
}

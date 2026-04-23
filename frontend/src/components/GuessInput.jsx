import { useState } from 'react'
import { Autocomplete, TextField, Button, Box } from '@mui/material'
import { fetchAutocomplete } from '../api'

export default function GuessInput({ onGuess, disabled }) {
  const [options, setOptions] = useState([])
  const [value, setValue] = useState(null)
  const [inputValue, setInputValue] = useState('')

  async function handleInputChange(_, newInput) {
    setInputValue(newInput)
    if (newInput.length < 2) {
      setOptions([])
      return
    }
    const results = await fetchAutocomplete(newInput)
    setOptions(results)
  }

  function handleSubmit() {
    if (!value) return
    onGuess(value)
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

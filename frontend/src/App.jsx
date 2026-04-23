import { useState, useEffect } from 'react'
import { Box, Typography, Chip, Stack, CircularProgress } from '@mui/material'
import GuessInput from './components/GuessInput'
import GameTree from './components/GameTree'
import { fetchRandomAnimal, fetchGameState } from './api'

export default function App() {
  const [secret, setSecret] = useState(null)
  const [guesses, setGuesses] = useState([])
  const [treeData, setTreeData] = useState(null)
  const [won, setWon] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRandomAnimal(true).then((name) => {
      setSecret(name)
      setLoading(false)
    })
  }, [])

  async function handleGuess(animal) {
    const nextGuesses = [...guesses, animal]
    setGuesses(nextGuesses)

    const state = await fetchGameState(secret, nextGuesses)
    setTreeData(state)

    if (animal === secret) setWon(true)
  }

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
      <CircularProgress />
    </Box>
  )

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>TaxoQuiz</Typography>

      {!won && <GuessInput onGuess={handleGuess} disabled={won} />}
      {won && (
        <Typography variant="h6" color="success.main">
          You got it — the answer was {secret}!
        </Typography>
      )}

      {guesses.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
          {guesses.map((g) => (
            <Chip
              key={g}
              label={g}
              variant={g === secret ? 'filled' : 'outlined'}
              color={g === secret ? 'success' : 'default'}
            />
          ))}
        </Stack>
      )}

      <Box sx={{ mt: 3 }}>
        <GameTree treeData={treeData} />
      </Box>
    </Box>
  )
}

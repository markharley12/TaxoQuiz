import { useState } from 'react'
import { Box, Typography, Chip, Stack, CircularProgress, Button } from '@mui/material'
import GuessInput from './components/GuessInput'
import GameTree from './components/GameTree'
import { fetchRandomAnimal, fetchGameState, type TreeNode } from './api'

type Mode = 'daily' | 'practice'

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [guesses, setGuesses] = useState<string[]>([])
  const [treeData, setTreeData] = useState<TreeNode | null>(null)
  const [won, setWon] = useState(false)
  const [loading, setLoading] = useState(false)

  async function startGame(selectedMode: Mode) {
    setMode(selectedMode)
    setLoading(true)
    setGuesses([])
    setTreeData(null)
    setWon(false)
    const name = await fetchRandomAnimal(selectedMode === 'daily')
    setSecret(name)
    setLoading(false)
  }

  async function handleGuess(animal: string) {
    const nextGuesses = [...guesses, animal]
    setGuesses(nextGuesses)
    const state = await fetchGameState(secret!, nextGuesses)
    setTreeData(state)
    if (animal === secret) setWon(true)
  }

  if (mode === null) return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>TaxoQuiz</Typography>
      <Typography variant="body1" sx={{ mb: 3, color: 'text.secondary' }}>
        Guess the secret animal by its place in the tree of life.
      </Typography>
      <Stack direction="row" spacing={2}>
        <Button variant="contained" size="large" onClick={() => startGame('daily')}>
          Daily
        </Button>
        <Button variant="outlined" size="large" onClick={() => startGame('practice')}>
          Practice
        </Button>
      </Stack>
    </Box>
  )

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
      <CircularProgress />
    </Box>
  )

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center' }}>
        <Typography variant="h4">TaxoQuiz</Typography>
        <Chip label={mode === 'daily' ? 'Daily' : 'Practice'} size="small" />
        {mode === 'practice' && (
          <Button size="small" onClick={() => startGame('practice')}>
            New animal
          </Button>
        )}
        <Button size="small" variant="text" onClick={() => setMode(null)}>
          Change mode
        </Button>
      </Stack>

      {!won && <GuessInput onGuess={handleGuess} disabled={won} />}
      {won && (
        <Stack direction="row" spacing={2} sx={{ mt: 1, alignItems: 'center' }}>
          <Typography variant="h6" color="success.main">
            You got it — the answer was {secret}!
          </Typography>
          {mode === 'practice' && (
            <Button variant="outlined" onClick={() => startGame('practice')}>
              New animal
            </Button>
          )}
        </Stack>
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

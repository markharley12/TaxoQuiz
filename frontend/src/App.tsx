import { useState, useEffect } from 'react'
import { Box, Typography, Chip, Stack, CircularProgress, Button } from '@mui/material'
import GuessInput from './components/GuessInput'
import GameTree from './components/GameTree'
import { fetchRandomAnimal, fetchGameState, type TreeNode } from './api'

type Mode = 'daily' | 'practice'

const STORAGE_KEY = 'taxoquiz_session'

interface SavedSession {
  mode: Mode
  secret: string
  guesses: string[]
  won: boolean
  date: string
}

function readSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved: SavedSession = JSON.parse(raw)
    const today = new Date().toISOString().slice(0, 10)
    if (saved.mode === 'daily' && saved.date !== today) return null
    return saved
  } catch {
    return null
  }
}

export default function App() {
  const [restored] = useState(() => readSession())
  const [mode, setMode] = useState<Mode | null>(restored?.mode ?? null)
  const [secret, setSecret] = useState<string | null>(restored?.secret ?? null)
  const [guesses, setGuesses] = useState<string[]>(restored?.guesses ?? [])
  const [treeData, setTreeData] = useState<TreeNode | null>(null)
  const [won, setWon] = useState(restored?.won ?? false)
  const [loading, setLoading] = useState(restored !== null && restored.guesses.length > 0)

  // On mount: re-fetch tree for restored session
  useEffect(() => {
    if (restored && restored.guesses.length > 0) {
      fetchGameState(restored.secret, restored.guesses)
        .then(setTreeData)
        .finally(() => setLoading(false))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist session whenever key state changes
  useEffect(() => {
    if (mode && secret) {
      const session: SavedSession = {
        mode, secret, guesses, won,
        date: new Date().toISOString().slice(0, 10),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    }
  }, [mode, secret, guesses, won])

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

  function handleChangeMode() {
    localStorage.removeItem(STORAGE_KEY)
    setMode(null)
    setSecret(null)
    setGuesses([])
    setTreeData(null)
    setWon(false)
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
      <Stack direction="row" spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2, alignItems: 'center' }}>
        <Typography variant="h4" sx={{ fontSize: { xs: '1.5rem', sm: '2.125rem' } }}>TaxoQuiz</Typography>
        <Chip label={mode === 'daily' ? 'Daily' : 'Practice'} size="small" />
        {mode === 'practice' && (
          <Button size="small" onClick={() => startGame('practice')}>New animal</Button>
        )}
        <Button size="small" variant="text" onClick={handleChangeMode}>Change mode</Button>
      </Stack>

      {!won && <GuessInput onGuess={handleGuess} disabled={won} exclude={guesses} />}
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

      <Box sx={{ mt: 3, mx: -3 }}>
        <GameTree treeData={treeData} />
      </Box>
    </Box>
  )
}

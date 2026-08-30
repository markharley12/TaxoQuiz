import { useState, useEffect } from 'react'
import { Box, Typography, Chip, Stack, CircularProgress, Button, TextField, Tooltip, Alert } from '@mui/material'
import GuessInput from './components/GuessInput'
import GameTree from './components/GameTree'
import ExploreTree from './components/ExploreTree'
import { fetchAnimal, fetchGameState, type TreeNode } from './api'

type Mode = 'daily' | 'practice' | 'explore'

const STORAGE_KEY = 'taxoquiz_session'

interface SavedSession {
  mode: Mode
  secret: string
  seed: string
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
  const [seed, setSeed] = useState<string>(restored?.seed ?? '')
  const [seedInput, setSeedInput] = useState('')
  const [seedError, setSeedError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [guesses, setGuesses] = useState<string[]>(restored?.guesses ?? [])
  const [treeData, setTreeData] = useState<TreeNode | null>(null)
  const [won, setWon] = useState(restored?.won ?? false)
  const [loading, setLoading] = useState(restored !== null && restored.guesses.length > 0)

  // On mount: re-fetch tree for restored session
  useEffect(() => {
    if (restored && restored.mode !== 'explore' && restored.guesses.length > 0) {
      fetchGameState(restored.secret, restored.guesses)
        .then(setTreeData)
        .finally(() => setLoading(false))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist session whenever key state changes
  useEffect(() => {
    if (mode === 'explore') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode, secret: '', seed: '', guesses: [], won: false,
        date: new Date().toISOString().slice(0, 10),
      }))
      return
    }
    if (mode && secret) {
      const session: SavedSession = {
        mode, secret, seed, guesses, won,
        date: new Date().toISOString().slice(0, 10),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    }
  }, [mode, secret, seed, guesses, won])

  async function startGame(selectedMode: Mode, sharedSeed?: string) {
    setSeedError(null)
    setLoading(true)
    try {
      const game = await fetchAnimal({ daily: selectedMode === 'daily', seed: sharedSeed })
      setMode(selectedMode)
      setGuesses([])
      setTreeData(null)
      setWon(false)
      setSecret(game.animal)
      setSeed(game.seed)
    } catch (e) {
      // A rejected seed must leave the current game alone rather than half-start one.
      setSeedError(e instanceof Error ? e.message : 'Could not start that game')
    } finally {
      setLoading(false)
    }
  }

  async function handleGuess(animal: string) {
    const nextGuesses = [...guesses, animal]
    setGuesses(nextGuesses)
    const state = await fetchGameState(secret!, nextGuesses)
    setTreeData(state)
    if (animal === secret) setWon(true)
  }

  async function copySeed() {
    try {
      await navigator.clipboard.writeText(seed)
    } catch {
      return   // clipboard is blocked outside a secure context; the seed is on screen anyway
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function handleChangeMode() {
    localStorage.removeItem(STORAGE_KEY)
    setMode(null)
    setSecret(null)
    setSeed('')
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
        <Button variant="outlined" size="large" onClick={() => setMode('explore')}>
          Explore
        </Button>
      </Stack>
      <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary' }}>
        Explore has no secret and nothing to guess — open the tree wherever you like and read your way around it.
      </Typography>

      <Typography variant="body2" sx={{ mt: 4, mb: 1, color: 'text.secondary' }}>
        Got a seed from someone? Play their exact round.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          placeholder="ABCD-234567"
          value={seedInput}
          onChange={(e) => { setSeedInput(e.target.value); setSeedError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && seedInput.trim()) startGame('practice', seedInput.trim()) }}
          error={Boolean(seedError)}
          slotProps={{ htmlInput: { 'aria-label': 'Seed', spellCheck: false, style: { fontFamily: 'monospace' } } }}
          sx={{ width: 200 }}
        />
        <Button
          variant="outlined"
          disabled={!seedInput.trim()}
          onClick={() => startGame('practice', seedInput.trim())}
          sx={{ height: 40 }}
        >
          Play seed
        </Button>
      </Stack>
      {seedError && <Alert severity="error" sx={{ mt: 2, maxWidth: 560 }}>{seedError}</Alert>}
    </Box>
  )

  if (mode === 'explore') return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2, alignItems: 'center' }}>
        <Typography variant="h4" sx={{ fontSize: { xs: '1.5rem', sm: '2.125rem' } }}>TaxoQuiz</Typography>
        <Chip label="Explore" size="small" />
        <Button size="small" variant="text" onClick={handleChangeMode}>Change mode</Button>
      </Stack>
      <ExploreTree />
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

      {seed && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Seed</Typography>
          <Chip
            label={seed}
            size="small"
            sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}
          />
          <Tooltip title={copied ? 'Copied' : 'Copy seed'} open={copied || undefined}>
            <Button size="small" onClick={copySeed}>{copied ? 'Copied' : 'Copy'}</Button>
          </Tooltip>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            share this to let someone play the same round
          </Typography>
        </Stack>
      )}

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

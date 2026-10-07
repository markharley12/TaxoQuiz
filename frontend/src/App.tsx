import { useState, useEffect } from 'react'
import {
  Box, Typography, Chip, Stack, CircularProgress, Button, TextField, Tooltip, Alert,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, IconButton, Link,
} from '@mui/material'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import { useNarrow } from './media'
import GuessInput from './components/GuessInput'
import GuessList from './components/GuessList'
import GameTree from './components/GameTree'
import ExploreTree from './components/ExploreTree'
import SettingsMenu from './components/SettingsMenu'
import { fetchAnimal, fetchGameState, type TreeNode } from './api'
import { useSettings, setSetting } from './settings'
import { FONT_DISPLAY } from './theme'
import { displayName } from './names'
import { useCloseOnBack } from './backButton'
import { bulkScope, closestGuess, describeClosest, hintAvailable, hintCost } from './endgame'
import { BUNDLED, storageKey } from './engine/local'

type Mode = 'daily' | 'practice' | 'explore'

const STORAGE_KEY = storageKey('taxoquiz_session')

/** The website is two builds side by side, the example at the root and the
 *  full scrape under full/, and each links to the other from its front page.
 *  The address is set only by the Pages build (`build:pages`), so the Android
 *  apps and any other build carry no link to a site that may not be there. */
const OTHER_SITE = import.meta.env.VITE_OTHER_SITE

interface SavedSession {
  mode: Mode
  secret: string
  seed: string
  guesses: string[]
  won: boolean
  /** Gave up and asked for the answer. Persisted, or a reload would hand the
   *  round back with the answer already spent. Absent in sessions saved before
   *  giving up existed, which reads as false — the right answer for them. */
  revealed: boolean
  /** Hints bought, and what they added to the score. Kept apart because a
   *  hint's cost depends on the score when it was taken, so the total cannot be
   *  worked out from the count. Absent in older sessions, which reads as none. */
  hints?: number
  hintPoints?: number
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
  const narrow = useNarrow()
  const [seedError, setSeedError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [guesses, setGuesses] = useState<string[]>(restored?.guesses ?? [])
  const [treeData, setTreeData] = useState<TreeNode | null>(null)
  const [won, setWon] = useState(restored?.won ?? false)
  const [revealed, setRevealed] = useState(restored?.revealed ?? false)
  const [confirmGiveUp, setConfirmGiveUp] = useState(false)
  const [hints, setHints] = useState(restored?.hints ?? 0)
  const [hintPoints, setHintPoints] = useState(restored?.hintPoints ?? 0)
  const [confirmHint, setConfirmHint] = useState(false)
  // What the tree should bring into view when it changes: the newest guess, or
  // after a hint the ??? node, which is what the hint moved.
  const [hintFocus, setHintFocus] = useState(false)
  // A round with only hints has a tree too, so it needs fetching on reload.
  const restoredHasTree = restored !== null && (restored.guesses.length > 0 || (restored.hints ?? 0) > 0)
  const [loading, setLoading] = useState(restoredHasTree)
  const [pendingDataset, setPendingDataset] = useState<string | null>(null)
  const { dataset } = useSettings()
  useCloseOnBack(confirmGiveUp, () => setConfirmGiveUp(false))
  useCloseOnBack(confirmHint, () => setConfirmHint(false))

  // On mount: re-fetch tree for restored session
  useEffect(() => {
    if (restored && restored.mode !== 'explore' && restoredHasTree) {
      fetchGameState(restored.secret, restored.guesses, dataset, restored.hints ?? 0)
        .then(setTreeData)
        .finally(() => setLoading(false))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist session whenever key state changes
  useEffect(() => {
    if (mode === 'explore') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode, secret: '', seed: '', guesses: [], won: false, revealed: false,
        date: new Date().toISOString().slice(0, 10),
      }))
      return
    }
    if (mode && secret) {
      const session: SavedSession = {
        mode, secret, seed, guesses, won, revealed, hints, hintPoints,
        date: new Date().toISOString().slice(0, 10),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    }
  }, [mode, secret, seed, guesses, won, revealed, hints, hintPoints])

  async function startGame(selectedMode: Mode, sharedSeed?: string) {
    setSeedError(null)
    setLoading(true)
    try {
      const game = await fetchAnimal({ daily: selectedMode === 'daily', seed: sharedSeed, dataset })
      setMode(selectedMode)
      setGuesses([])
      setTreeData(null)
      setWon(false)
      setRevealed(false)
      setHints(0)
      setHintPoints(0)
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
    await guessAll([animal])
  }

  // A bulk guess is every species it names, each one counted: the shortcut is a
  // trade against the guess count, not a free move. See endgame.ts.
  async function guessAll(animals: string[]) {
    const nextGuesses = [...guesses, ...animals]
    setGuesses(nextGuesses)
    setHintFocus(false)
    const state = await fetchGameState(secret!, nextGuesses, dataset, hints)
    setTreeData(state)
    if (secret !== null && animals.includes(secret)) setWon(true)
  }

  // A hint shows one more node of the answer's lineage, and costs the score again
  // (at least 10). The count goes to the game logic; the points stay here, since
  // only the client knows what the score was when each hint was bought.
  async function takeHint() {
    setConfirmHint(false)
    setHintFocus(true)
    const next = hints + 1
    setHintPoints(hintPoints + hintCost(guesses.length + hintPoints))
    setHints(next)
    setTreeData(await fetchGameState(secret!, guesses, dataset, next))
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
    setRevealed(false)
    setHints(0)
    setHintPoints(0)
  }

  // Switching dataset mid-game invalidates the current secret/guesses (they're
  // only meaningful for the dataset they were fetched against), so anywhere
  // other than the mode-select screen this needs confirming first — losing
  // guesses with no warning would be worse than the existing "wrong dataset"
  // seed rejection this game already goes out of its way to avoid.
  function handleSelectDataset(name: string) {
    if (name === dataset) return
    if (mode === null) {
      setSetting('dataset', name)
      return
    }
    setPendingDataset(name)
  }

  function confirmDatasetSwitch() {
    if (pendingDataset !== null) setSetting('dataset', pendingDataset)
    setPendingDataset(null)
    handleChangeMode()
  }

  if (mode === null) return (
    // Centred and measured, rather than flush against the top-left corner. The
    // landing screen holds about fifteen words and four controls; ranged left
    // across a 1280px window they sat in the corner of an empty page and the
    // whole app read as unfinished before it had done anything.
    <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 2, sm: 3 } }}>
      <Box sx={{ width: '100%', maxWidth: 620 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', mb: 0.5 }}>
          <Typography variant="h2" sx={{ fontSize: { xs: '2.6rem', sm: '3.4rem' } }}>TaxoQuiz</Typography>
          <SettingsMenu onSelectDataset={handleSelectDataset} />
        </Stack>
        <Typography
          sx={{
            textAlign: 'center', color: 'text.secondary', mb: 4,
            fontFamily: FONT_DISPLAY, fontStyle: 'italic', fontSize: '1.15rem',
          }}
        >
          Guess the secret animal by its place in the tree of life.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'center' }}>
          <Button variant="contained" size="large" onClick={() => startGame('daily')}>
            Today’s animal
          </Button>
          <Button variant="outlined" size="large" onClick={() => startGame('practice')}>
            Practice
          </Button>
          <Button variant="outlined" size="large" onClick={() => setMode('explore')}>
            Explore
          </Button>
        </Stack>
        <Typography variant="body2" sx={{ mt: 2, textAlign: 'center', color: 'text.secondary' }}>
          Explore has no secret and nothing to guess — open the tree wherever you
          like and read your way around it.
        </Typography>

        {OTHER_SITE && (
          <Typography variant="body2" sx={{ mt: 1.5, textAlign: 'center' }}>
            <Link href={OTHER_SITE}>
              {BUNDLED === 'example'
                ? 'Play the full tree of life — over 40,000 species'
                : 'Play the smaller set of 530 well-known species'}
            </Link>
          </Typography>
        )}

        {/* Set apart rather than merely further down the page: it is a different
          * job from starting a game, and as a plain fourth paragraph it read as
          * one more instruction to get past. */}
        <Box sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ mb: 1.5, textAlign: 'center', color: 'text.secondary' }}>
            Got a seed from someone? Play their exact round.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', alignItems: 'flex-start' }}>
            <TextField
              size="small"
              placeholder="ABCD-234567"
              value={seedInput}
              onChange={(e) => { setSeedInput(e.target.value); setSeedError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && seedInput.trim()) startGame('practice', seedInput.trim()) }}
              error={Boolean(seedError)}
              slotProps={{ htmlInput: { 'aria-label': 'Seed', spellCheck: false, style: { fontFamily: 'ui-monospace, monospace', letterSpacing: '0.06em' } } }}
              sx={{ width: 210 }}
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
          {seedError && <Alert severity="error" sx={{ mt: 2 }}>{seedError}</Alert>}
        </Box>
      </Box>
    </Box>
  )

  if (mode === 'explore') return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Stack direction="row" spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2, alignItems: 'center' }}>
        <Typography variant="h4" sx={{ fontSize: { xs: '1.5rem', sm: '2rem' } }}>TaxoQuiz</Typography>
        <Chip label="Explore" size="small" variant="outlined" />
        <Button size="small" variant="text" onClick={handleChangeMode}>Change mode</Button>
        <SettingsMenu onSelectDataset={handleSelectDataset} />
      </Stack>
      <ExploreTree />
      <DatasetSwitchDialog
        pendingDataset={pendingDataset}
        onCancel={() => setPendingDataset(null)}
        onConfirm={confirmDatasetSwitch}
      />
    </Box>
  )

  // Won or gave up: either way the round is finished and nothing more can be
  // guessed.
  const over = won || revealed
  const closest = closestGuess(treeData)
  // Every species guessed, plus what the hints cost.
  const score = guesses.length + hintPoints
  const nextHintCost = hintCost(score)

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
      <CircularProgress />
    </Box>
  )

  return (
    // A column exactly the screen's height, so the tree can take whatever the
    // controls above it leave rather than a guess at it. Nothing else shrinks:
    // on a screen too short for everything the page scrolls, as it did before,
    // instead of squashing the guess list (which clips, and so would give way
    // first).
    <Box sx={{
      p: { xs: 1, sm: 3 }, height: '100dvh', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', '& > *': { flexShrink: 0 },
    }}>
      {/* One row on a phone. It wrapped "Change mode" and the cog onto a second
        * line, a row of screen spent above the tree on two controls pressed once
        * a round. The spacer holds them at the far end, and on a phone "Change
        * mode" is an icon, which is what makes the row fit 412px. */}
      <Stack
        direction="row"
        spacing={{ xs: 0.5, sm: 2 }}
        sx={{ mb: { xs: 1, sm: 2 }, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
      >
        <Typography variant="h4" sx={{ fontSize: { xs: '1.5rem', sm: '2rem' } }}>TaxoQuiz</Typography>
        <Chip label={mode === 'daily' ? 'Daily' : 'Practice'} size="small" variant="outlined" />
        {mode === 'practice' && (
          <Button size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => startGame('practice')}>
            New animal
          </Button>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }} />
        {narrow ? (
          <Tooltip title="Change mode">
            <IconButton size="small" aria-label="Change mode" onClick={handleChangeMode}>
              <HomeOutlinedIcon />
            </IconButton>
          </Tooltip>
        ) : (
          <Button size="small" variant="text" sx={{ whiteSpace: 'nowrap' }} onClick={handleChangeMode}>
            Change mode
          </Button>
        )}
        <SettingsMenu onSelectDataset={handleSelectDataset} />
      </Stack>

      {(seed || !over) && (
        <Stack direction="row" spacing={1} sx={{ mb: { xs: 1, sm: 2 }, alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          {seed && <>
            <Typography variant="caption" sx={{ color: 'text.secondary', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Seed
            </Typography>
            <Chip
              label={seed}
              size="small"
              variant="outlined"
              sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, letterSpacing: '0.06em' }}
            />
            <Tooltip title={copied ? 'Copied' : 'Copy seed'} open={copied || undefined}>
              <Button size="small" onClick={copySeed}>{copied ? 'Copied' : 'Copy'}</Button>
            </Tooltip>
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary', display: { xs: 'none', sm: 'inline' },
                fontFamily: FONT_DISPLAY, fontStyle: 'italic', fontSize: '0.85rem',
              }}
            >
              share this to let someone play the same round
            </Typography>
          </>}
          {/* Pushed to the far end of the seed row rather than given a line of
            * its own under the guess bar, which is what it cost on a phone: a
            * whole row of screen for the control you press once a game, above
            * the tree the game is played on. The spacer, not `ml: auto`,
            * because Stack sets its own left margin on every child. */}
          <Box sx={{ flex: 1, minWidth: 0 }} />
          {/* Shows its price, since it is dear, and stays in place disabled once
            * there is nothing left to reveal rather than vanishing from the row. */}
          {!over && (
            <Button
              size="small" variant="text" sx={{ whiteSpace: 'nowrap' }}
              disabled={!hintAvailable(treeData)} onClick={() => setConfirmHint(true)}
            >
              Hint +{nextHintCost}
            </Button>
          )}
          {!over && (
            <Button size="small" variant="text" onClick={() => setConfirmGiveUp(true)}>
              Give up
            </Button>
          )}
        </Stack>
      )}

      {/* A round ends two ways and only one of them is a win. Both hide the
        * input and both say what the animal was; the difference is the tone
        * and, for a win, the colour. */}
      {!over && (
        <GuessInput
          onGuess={handleGuess}
          onBulkGuess={guessAll}
          bulk={bulkScope(treeData)}
          disabled={over}
          exclude={guesses}
        />
      )}
      {won && (
        <Stack direction="row" spacing={2} sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="h5" sx={{ color: 'success.dark' }}>
            You got it in {score} {hintPoints > 0
              ? `(${guesses.length} ${guesses.length === 1 ? 'guess' : 'guesses'} + ${hintPoints} for ${hints === 1 ? 'a hint' : `${hints} hints`})`
              : guesses.length === 1 ? 'guess' : 'guesses'} — the answer was{' '}
            <Box component="em" sx={{ fontStyle: 'italic' }}>{displayName(secret ?? '')}</Box>
          </Typography>
          {mode === 'practice' && (
            <Button variant="outlined" onClick={() => startGame('practice')}>
              New animal
            </Button>
          )}
        </Stack>
      )}
      {revealed && !won && (
        <Stack direction="row" spacing={2} sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          {/* Stated, not celebrated. Success green here would congratulate you
            * for the one outcome that is not a success. */}
          <Typography variant="h5" sx={{ color: 'text.secondary' }}>
            The answer was{' '}
            <Box component="em" sx={{ fontStyle: 'italic', color: 'text.primary' }}>{displayName(secret ?? '')}</Box>
          </Typography>
          {mode === 'practice' && (
            <Button variant="outlined" onClick={() => startGame('practice')}>
              New animal
            </Button>
          )}
        </Stack>
      )}

      {/* How close a given-up round got, from the best guess's shared group. A win
        * needs no such line: it is 100% and says so already. */}
      {revealed && !won && closest && (
        <Typography variant="body1" sx={{ mt: 0.5, color: 'text.secondary' }}>
          {describeClosest(closest)}
        </Typography>
      )}

      <GuessList guesses={guesses} secret={secret} />

      {/* Full-bleed: cancels the page's own padding, which is 1 on a phone. A
        * flat -3 overhung a 412px screen by 16px a side and scrolled the page. */}
      <Box sx={{ mt: { xs: 1, sm: 3 }, mx: { xs: -1, sm: -3 }, flex: '1 0 0', minHeight: { xs: 300, sm: 400 } }}>
        <GameTree
          treeData={treeData}
          focusLabel={hintFocus ? '???' : guesses[guesses.length - 1] ?? null}
          newestLabel={guesses[guesses.length - 1] ?? null}
        />
      </Box>
      <DatasetSwitchDialog
        pendingDataset={pendingDataset}
        onCancel={() => setPendingDataset(null)}
        onConfirm={confirmDatasetSwitch}
      />
      {/* Confirmed rather than immediate: on a daily there is no second go, and
        * the button sits a few pixels from the one you press all game. */}
      <Dialog open={confirmGiveUp} onClose={() => setConfirmGiveUp(false)}>
        <DialogTitle>Give up and see the answer?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirmGiveUp(false)}>Keep playing</Button>
          <Button onClick={() => { setRevealed(true); setConfirmGiveUp(false) }} autoFocus>
            Show me
          </Button>
        </DialogActions>
      </Dialog>
      {/* Confirmed for the same reason, and because it is dear: the price and the
        * score it leaves are stated before anything is spent. */}
      <Dialog open={confirmHint} onClose={() => setConfirmHint(false)}>
        <DialogTitle>Take a hint?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            It reveals the next group the answer belongs to, and adds {nextHintCost} to
            your score: {score} → {score + nextHintCost}.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmHint(false)}>Keep playing</Button>
          <Button onClick={takeHint} autoFocus>Reveal (+{nextHintCost})</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function DatasetSwitchDialog(
  { pendingDataset, onCancel, onConfirm }:
  { pendingDataset: string | null; onCancel: () => void; onConfirm: () => void },
) {
  useCloseOnBack(pendingDataset !== null, onCancel)
  return (
    <Dialog open={pendingDataset !== null} onClose={onCancel}>
      <DialogTitle>
        Switch to {pendingDataset}? This ends your current game.
      </DialogTitle>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm} autoFocus>Switch</Button>
      </DialogActions>
    </Dialog>
  )
}

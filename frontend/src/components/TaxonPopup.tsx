import { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Chip, Typography, Box, CircularProgress, Link,
} from '@mui/material'
import { fetchTaxonInfo, type TaxonInfo } from '../api'

interface Props {
  names: string[]   // one or more taxon names (compressed nodes have multiple)
  onClose: () => void
}

interface Entry {
  name: string
  info: TaxonInfo | null
}

const COLLAPSED_CHARS = 480

/** Shorten a Wikipedia intro for the popup. Display-only — the stored text is
 *  untouched, and "Show more" gives it back.
 *
 *  Cutting at the first paragraph break is the main move (Animalia's intro is
 *  five paragraphs), but ~9% of entries have a single first paragraph that is
 *  still overlong, so anything past the budget is then clamped at a sentence
 *  boundary. An abbreviation mid-sentence can fool that; it only costs a
 *  slightly early cut on a preview you can expand. */
function shorten(text: string): string {
  const firstPara = text.split('\n')[0]
  if (firstPara.length <= COLLAPSED_CHARS) return firstPara
  const window = firstPara.slice(0, COLLAPSED_CHARS)
  const sentence = window.lastIndexOf('. ')
  if (sentence > COLLAPSED_CHARS / 2) return window.slice(0, sentence + 1)
  const space = window.lastIndexOf(' ')
  return `${window.slice(0, space > 0 ? space : COLLAPSED_CHARS)}…`
}

function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const short = shorten(text)
  const truncated = short.length < text.length
  // Paragraph breaks are newlines, which HTML would collapse into one wall of
  // text — so split rather than relying on the browser.
  const paragraphs = (expanded ? text.split('\n') : [short]).filter((p) => p.trim())

  return (
    <>
      {paragraphs.map((paragraph, i) => (
        <Typography key={i} variant="body2" sx={{ mb: i < paragraphs.length - 1 ? 1.25 : 0 }}>
          {paragraph}
        </Typography>
      ))}
      {truncated && (
        <Link
          component="button"
          type="button"
          variant="caption"
          underline="hover"
          onClick={() => setExpanded((e) => !e)}
          sx={{ display: 'block', mt: 1 }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Link>
      )}
    </>
  )
}

export default function TaxonPopup({ names, onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setEntries([])
    Promise.all(names.map(async (name) => ({ name, info: await fetchTaxonInfo(name) })))
      .then((results) => {
        if (!cancelled) {
          setEntries(results)
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [names])

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <>
          {entries.map(({ name, info }, i) => (
            <Box key={name} sx={i > 0 ? { borderTop: 1, borderColor: 'divider' } : {}}>
              {/* Species lead with the common name — you clicked "lion", so
                  being answered by "Panthera leo" reads as the wrong article.
                  The scientific name still shows, underneath. */}
              <DialogTitle sx={{ pb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Box component="span" sx={{ textTransform: info?.common_name ? 'capitalize' : 'none' }}>
                    {info?.common_name || name}
                  </Box>
                  {info?.rank && <Chip label={info.rank} size="small" />}
                </Box>
                {info?.common_name && (
                  <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                    {name}
                  </Typography>
                )}
              </DialogTitle>

              <DialogContent>
                {info?.description ? (
                  <>
                    {info.image_url && (
                      <Box
                        component="img"
                        src={info.image_url}
                        alt={name}
                        sx={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 1, mb: 1.5 }}
                      />
                    )}
                    <Description text={info.description} />
                    {info.wikipedia_url && (
                      <Link
                        href={info.wikipedia_url}
                        target="_blank"
                        rel="noopener"
                        variant="caption"
                        sx={{ display: 'block', mt: 1 }}
                      >
                        From Wikipedia
                      </Link>
                    )}
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No information available.
                  </Typography>
                )}
              </DialogContent>
            </Box>
          ))}

          <DialogActions>
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}

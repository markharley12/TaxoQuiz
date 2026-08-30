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
                    <Typography variant="body2">{info.description}</Typography>
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

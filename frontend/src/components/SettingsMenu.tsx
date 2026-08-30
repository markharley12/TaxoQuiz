import { useState } from 'react'
import { IconButton, Menu, MenuItem, ListItemText, ListSubheader, Box, Tooltip } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import CheckIcon from '@mui/icons-material/Check'
import { COLOR_SCHEMES, schemeGradient, type ColorScheme } from '../colors'
import { useSettings, setSetting } from '../settings'

export default function SettingsMenu() {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const { colorScheme } = useSettings()

  function choose(scheme: ColorScheme) {
    setSetting('colorScheme', scheme)
    setAnchor(null)
  }

  return (
    <>
      <Tooltip title="Settings">
        <IconButton
          size="small"
          aria-label="Settings"
          aria-haspopup="menu"
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { dense: true, subheader: <ListSubheader>Colour scale</ListSubheader> } }}
      >
        {(Object.keys(COLOR_SCHEMES) as ColorScheme[]).map((scheme) => (
          <MenuItem key={scheme} selected={scheme === colorScheme} onClick={() => choose(scheme)}>
            {/* The gradient is the actual scale, generated from the same
                function the trees use — so it cannot describe a scheme the
                trees do not draw. */}
            <Box
              sx={{
                width: 56, height: 14, mr: 1.5, borderRadius: 0.5, flexShrink: 0,
                background: schemeGradient(scheme),
              }}
            />
            <ListItemText
              primary={COLOR_SCHEMES[scheme].label}
              secondary={COLOR_SCHEMES[scheme].hint}
              slotProps={{ secondary: { variant: 'caption' } }}
            />
            <CheckIcon
              fontSize="small"
              sx={{ ml: 2, visibility: scheme === colorScheme ? 'visible' : 'hidden' }}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

import { useState } from 'react'
import { IconButton, Menu, MenuItem, ListItemText, ListSubheader, Divider, Box, Tooltip } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import CheckIcon from '@mui/icons-material/Check'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import { COLOR_SCHEMES, schemeGradient, type ColorScheme } from '../colors'
import { useSettings, setSetting, ORIENTATIONS, type Orientation, type Settings } from '../settings'

const ORIENTATION_ICON = {
  horizontal: ArrowForwardIcon,
  vertical: ArrowDownwardIcon,
} as const

export default function SettingsMenu() {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const { colorScheme, orientation } = useSettings()

  function choose<K extends 'colorScheme' | 'orientation'>(key: K, value: Settings[K]) {
    setSetting(key, value)
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
        slotProps={{ list: { dense: true } }}
      >
        <ListSubheader>Colour scale</ListSubheader>
        {(Object.keys(COLOR_SCHEMES) as ColorScheme[]).map((scheme) => (
          <MenuItem
            key={scheme}
            selected={scheme === colorScheme}
            onClick={() => choose('colorScheme', scheme)}
          >
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

        <Divider />
        <ListSubheader>Tree layout</ListSubheader>
        {(Object.keys(ORIENTATIONS) as Orientation[]).map((value) => {
          const Icon = ORIENTATION_ICON[value]
          return (
            <MenuItem
              key={value}
              selected={value === orientation}
              onClick={() => choose('orientation', value)}
            >
              <Box sx={{ width: 56, mr: 1.5, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                <Icon fontSize="small" />
              </Box>
              <ListItemText
                primary={ORIENTATIONS[value].label}
                secondary={ORIENTATIONS[value].hint}
                slotProps={{ secondary: { variant: 'caption' } }}
              />
              <CheckIcon
                fontSize="small"
                sx={{ ml: 2, visibility: value === orientation ? 'visible' : 'hidden' }}
              />
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}

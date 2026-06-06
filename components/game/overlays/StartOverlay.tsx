// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — components/game/overlays/StartOverlay.tsx
// File 19 of 48
//
// Start screen overlay. Shown on first load before any session exists.
// Pure presentational — receives one callback: onPlay.
// ═══════════════════════════════════════════════════════════════════════════

'use client'

import { useEffect, useState } from 'react'
import { getCityForLevel } from '@/lib/game/cities'

interface StartOverlayProps {
  onPlay: () => void
}

export function StartOverlay({ onPlay }: StartOverlayProps) {
  // Subtle blink on the play button
  const [blink, setBlink] = useState(true)

  useEffect(() => {
    const id = setInterval(() => setBlink(b => !b), 600)
    return () => clearInterval(id)
  }, [])

  const city = getCityForLevel(0) // Miami

  return (
    <div style={styles.overlay}>
      {/* Title */}
      <h1 style={styles.title}>
        PALM<br />GALAXY
      </h1>

      {/* Tagline */}
      <p style={styles.sub}>
        DODGE THE LASERS<br />SURVIVE EACH CITY
      </p>

      {/* City label */}
      <div style={{ ...styles.cityLabel, color: '#00eeff', textShadow: '0 0 12px #00eeff' }}>
        MIAMI · LEVEL 1
      </div>

      {/* Play button */}
      <button
        onClick={onPlay}
        style={{
          ...styles.btn,
          opacity: blink ? 1 : 0.7,
        }}
        aria-label="Play Palm Galaxy"
      >
        ► PLAY
      </button>

      {/* Controls hint */}
      <div style={styles.hint}>
        KEYBOARD: ← → ARROWS OR A / D<br />
        TOUCH: DRAG LEFT / RIGHT<br />
        TAP LEFT / RIGHT HALF TO NUDGE
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position:       'absolute',
    top: 0, left: 0,
    width:          '100%',
    height:         '100%',
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    background:     'rgba(0,0,0,0.82)',
    zIndex:         20,
    pointerEvents:  'all',
    gap:            0,
  },
  title: {
    fontFamily:   '"Press Start 2P", monospace',
    color:        '#00ff88',
    fontSize:     20,
    margin:       '0 0 10px',
    textShadow:   '0 0 20px #00ff88, 0 0 40px #00ff88',
    textAlign:    'center',
    lineHeight:   1.5,
    letterSpacing: 2,
  },
  sub: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#ff00ff',
    fontSize:    8,
    margin:      '0 0 20px',
    textShadow:  '0 0 10px #ff00ff',
    textAlign:   'center',
    lineHeight:  2,
  },
  cityLabel: {
    fontFamily:    '"Orbitron", sans-serif',
    fontSize:      11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom:  22,
  },
  btn: {
    fontFamily:   '"Press Start 2P", monospace',
    background:   'none',
    border:       '2px solid #00ff88',
    color:        '#00ff88',
    padding:      '10px 22px',
    fontSize:     9,
    cursor:       'pointer',
    textShadow:   '0 0 8px #00ff88',
    boxShadow:    '0 0 16px #00ff88',
    letterSpacing: 1,
    marginBottom: 16,
    transition:   'background 0.15s, box-shadow 0.15s',
  },
  hint: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#555',
    fontSize:    7,
    textAlign:   'center',
    lineHeight:  2.2,
    marginTop:   6,
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — components/game/overlays/GameOverOverlay.tsx
// File 20 of 48
//
// Game-over screen. Shows final score, city reached, and two CTAs:
//   - Continue (→ email capture or share)
//   - Retry    (→ new game immediately)
// ═══════════════════════════════════════════════════════════════════════════

'use client'

import { useEffect, useState } from 'react'
import type { GameState } from '@/lib/game/types'
import { formatScore } from '@/lib/game/engine'

interface GameOverOverlayProps {
  state:       GameState
  onContinue:  () => void
  onRetry:     () => void
}

export function GameOverOverlay({ state, onContinue, onRetry }: GameOverOverlayProps) {
  const [visible, setVisible] = useState(false)

  // Fade in after mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const cityName = state.currentRun.maxCity.toUpperCase()

  return (
    <div
      style={{
        ...styles.overlay,
        opacity:    visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}
    >
      <h1 style={styles.title}>GAME OVER</h1>

      <p style={styles.sub}>
        YOU SURVIVED THE LASERS<br />FOR A MOMENT…
      </p>

      <div style={styles.cityLabel}>
        FINAL CITY: {cityName}
      </div>

      <div style={styles.scoreBox}>
        SCORE: {formatScore(state.score)}
      </div>

      {/* Primary CTA — goes to email capture if score > 0 */}
      <button
        onClick={onContinue}
        style={styles.btnPrimary}
        aria-label="Continue to share or save score"
      >
        ► CONTINUE
      </button>

      {/* Secondary CTA — instant retry */}
      <button
        onClick={onRetry}
        style={styles.btnSecondary}
        aria-label="Play again"
      >
        ↺ RETRY
      </button>
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
    background:     'rgba(0,0,0,0.86)',
    zIndex:         20,
    pointerEvents:  'all',
  },
  title: {
    fontFamily:    '"Press Start 2P", monospace',
    color:         '#ff3aff',
    fontSize:      20,
    margin:        '0 0 10px',
    textShadow:    '0 0 20px #ff3aff, 0 0 40px #ff3aff',
    textAlign:     'center',
    letterSpacing: 2,
  },
  sub: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#888',
    fontSize:    7,
    margin:      '0 0 18px',
    textAlign:   'center',
    lineHeight:  2,
  },
  cityLabel: {
    fontFamily:    '"Orbitron", sans-serif',
    color:         '#00eeff',
    fontSize:      10,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom:  14,
    textShadow:    '0 0 10px #00eeff',
  },
  scoreBox: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#ffff00',
    fontSize:    11,
    textShadow:  '0 0 12px #ffff00',
    margin:      '0 0 24px',
  },
  btnPrimary: {
    fontFamily:    '"Press Start 2P", monospace',
    background:    'none',
    border:        '2px solid #00ff88',
    color:         '#00ff88',
    padding:       '10px 22px',
    fontSize:      9,
    cursor:        'pointer',
    textShadow:    '0 0 8px #00ff88',
    boxShadow:     '0 0 16px #00ff88',
    letterSpacing: 1,
    marginBottom:  10,
  },
  btnSecondary: {
    fontFamily:    '"Press Start 2P", monospace',
    background:    'none',
    border:        '2px solid #444',
    color:         '#666',
    padding:       '8px 18px',
    fontSize:      8,
    cursor:        'pointer',
    letterSpacing: 1,
  },
}

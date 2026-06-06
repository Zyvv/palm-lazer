// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — components/game/overlays/EmailCapture.tsx
// File 21 of 48
//
// Email capture overlay shown after game over.
// POSTs to /api/email/capture on submit.
// Calls onSubmitted or onDismiss when done — GameShell advances overlay state.
// ═══════════════════════════════════════════════════════════════════════════

'use client'

import { useState, useRef, useEffect } from 'react'
import type { GameState } from '@/lib/game/types'
import { formatScore } from '@/lib/game/engine'

interface EmailCaptureProps {
  state:       GameState
  sessionId:   string | null
  onSubmitted: () => void
  onDismiss:   () => void
}

export function EmailCapture({
  state,
  sessionId,
  onSubmitted,
  onDismiss,
}: EmailCaptureProps) {
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus input on mount
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(id)
  }, [])

  const handleSubmit = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/email/capture', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          email:      trimmed,
          trigger:    'game_over',
          score:      state.score,
          level:      state.level,
          city:       state.currentRun.maxCity,
        }),
      })

      if (!res.ok) throw new Error('server')

      setSubmitted(true)
      setTimeout(onSubmitted, 900)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
  }

  return (
    <div style={styles.overlay}>
      {submitted ? (
        <div style={styles.successBox}>
          <div style={styles.successIcon}>✓</div>
          <div style={styles.successText}>SCORE SAVED</div>
          <div style={styles.successSub}>Check your inbox 🌴</div>
        </div>
      ) : (
        <>
          <h2 style={styles.title}>SAVE YOUR SCORE</h2>

          <div style={styles.scoreDisplay}>
            {formatScore(state.score)}
          </div>

          <p style={styles.sub}>
            GET YOUR SCORE CARD<br />+ CHALLENGE A FRIEND
          </p>

          <div style={styles.inputRow}>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(null) }}
              onKeyDown={handleKeyDown}
              placeholder="your@email.com"
              autoComplete="email"
              style={{
                ...styles.input,
                borderColor: error ? '#ff3a3a' : '#333',
              }}
              aria-label="Email address"
              disabled={loading}
            />
          </div>

          {error && (
            <div style={styles.errorText}>{error}</div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              ...styles.btnSubmit,
              opacity: loading ? 0.6 : 1,
            }}
            aria-label="Submit email"
          >
            {loading ? 'SAVING…' : '► SAVE SCORE'}
          </button>

          <button
            onClick={onDismiss}
            style={styles.btnSkip}
            disabled={loading}
            aria-label="Skip email capture"
          >
            SKIP →
          </button>

          <div style={styles.privacyNote}>
            No spam. Unsubscribe any time.
          </div>
        </>
      )}
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
    background:     'rgba(0,0,0,0.90)',
    zIndex:         20,
    pointerEvents:  'all',
    padding:        '0 24px',
    boxSizing:      'border-box',
  },
  title: {
    fontFamily:    '"Press Start 2P", monospace',
    color:         '#00ff88',
    fontSize:      12,
    margin:        '0 0 10px',
    textShadow:    '0 0 12px #00ff88',
    textAlign:     'center',
    letterSpacing: 1,
  },
  scoreDisplay: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#ffff00',
    fontSize:    22,
    textShadow:  '0 0 16px #ffff00',
    margin:      '0 0 12px',
  },
  sub: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#666',
    fontSize:    7,
    margin:      '0 0 20px',
    textAlign:   'center',
    lineHeight:  2,
  },
  inputRow: {
    width:       '100%',
    maxWidth:    320,
    marginBottom: 8,
  },
  input: {
    width:           '100%',
    background:      '#0a0a0a',
    border:          '1px solid #333',
    color:           '#fff',
    fontFamily:      '"Press Start 2P", monospace',
    fontSize:        8,
    padding:         '10px 12px',
    outline:         'none',
    boxSizing:       'border-box',
    letterSpacing:   0.5,
  },
  errorText: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#ff3a3a',
    fontSize:    7,
    marginBottom: 10,
    textAlign:   'center',
  },
  btnSubmit: {
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
    marginTop:     4,
  },
  btnSkip: {
    fontFamily:    '"Press Start 2P", monospace',
    background:    'none',
    border:        'none',
    color:         '#444',
    fontSize:      7,
    cursor:        'pointer',
    letterSpacing: 1,
    marginBottom:  12,
  },
  privacyNote: {
    fontFamily: '"Press Start 2P", monospace',
    color:      '#2a2a2a',
    fontSize:   6,
    textAlign:  'center',
  },
  successBox: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    gap:            10,
  },
  successIcon: {
    fontFamily: '"Press Start 2P", monospace',
    color:      '#00ff88',
    fontSize:   28,
    textShadow: '0 0 20px #00ff88',
  },
  successText: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#00ff88',
    fontSize:    12,
    textShadow:  '0 0 10px #00ff88',
    letterSpacing: 2,
  },
  successSub: {
    fontFamily: '"Press Start 2P", monospace',
    color:      '#555',
    fontSize:   7,
  },
}

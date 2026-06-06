// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — components/game/overlays/ShareBar.tsx
// File 22 of 48
//
// Post-game share overlay. Four share mechanisms:
//   TikTok · X (Twitter) · Email to friend · Copy link
//
// Each share action:
//   1. Fires a share_clicked game event (via onEventPush)
//   2. Updates session share flags (via /api/session/event batch)
//   3. Opens the platform intent URL
//
// Email-to-friend uses a modal input (inline, not a separate overlay).
// ═══════════════════════════════════════════════════════════════════════════

'use client'

import { useState } from 'react'
import type { GameEventPayload, GameState } from '@/lib/game/types'
import { formatScore } from '@/lib/game/engine'
import { GAME_CONSTANTS } from '@/lib/game/cities'

const APP_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'https://palmgalaxy.app'

interface ShareBarProps {
  state:       GameState
  sessionId:   string | null
  onRetry:     () => void
  onEventPush: (payload: GameEventPayload) => void
}

export function ShareBar({ state, sessionId, onRetry, onEventPush }: ShareBarProps) {
  const [emailModalOpen,   setEmailModalOpen]   = useState(false)
  const [recipientEmail,   setRecipientEmail]   = useState('')
  const [emailSending,     setEmailSending]     = useState(false)
  const [emailSent,        setEmailSent]        = useState(false)
  const [emailError,       setEmailError]       = useState<string | null>(null)
  const [linkCopied,       setLinkCopied]       = useState(false)

  const score    = formatScore(state.score)
  const cityName = state.currentRun.maxCity
  const shareUrl = `${APP_URL}/?utm_source=share&utm_content=${sessionId ?? ''}`

  // ── TikTok ────────────────────────────────────────────────────────────────
  const handleTikTok = () => {
    onEventPush({ event_type: 'share_clicked', share_platform: 'tiktok' })
    const caption = encodeURIComponent(
      `I scored ${score} on Palm Galaxy 🌴⚡ dodging lasers across ${cityName}. Can you beat me? ${shareUrl}`,
    )
    window.open(`https://www.tiktok.com/share?url=${encodeURIComponent(shareUrl)}&title=${caption}`, '_blank')
  }

  // ── X / Twitter ───────────────────────────────────────────────────────────
  const handleX = () => {
    onEventPush({ event_type: 'share_clicked', share_platform: 'x' })
    const text = encodeURIComponent(
      `Level ${state.level + 1} · ${score} pts on Palm Galaxy 🌴⚡\nDodge the lasers. Can you survive ${cityName}?\n${shareUrl}`,
    )
    window.open(`https://x.com/intent/tweet?text=${text}`, '_blank')
  }

  // ── Copy link ─────────────────────────────────────────────────────────────
  const handleCopy = async () => {
    onEventPush({ event_type: 'share_clicked', share_platform: 'copy' })
    try {
      await navigator.clipboard.writeText(shareUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // Fallback — select a hidden input
    }
  }

  // ── Email to friend ───────────────────────────────────────────────────────
  const handleEmailSend = async () => {
    const trimmed = recipientEmail.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address')
      return
    }

    setEmailSending(true)
    setEmailError(null)

    try {
      const res = await fetch('/api/share/email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          session_id:      sessionId,
          recipient_email: trimmed,
          score:           state.score,
          level:           state.level,
          city:            cityName,
        }),
      })

      if (!res.ok) throw new Error('server')

      onEventPush({
        event_type:             'share_clicked',
        share_platform:         'email',
        share_recipient_email:  trimmed,
      })

      setEmailSent(true)
      setTimeout(() => {
        setEmailModalOpen(false)
        setEmailSent(false)
        setRecipientEmail('')
      }, 1800)
    } catch {
      setEmailError('Could not send. Try again.')
    } finally {
      setEmailSending(false)
    }
  }

  return (
    <div style={styles.overlay}>
      {/* Score recap */}
      <div style={styles.scoreRecap}>
        {score}
        <span style={styles.scoreLabel}> PTS</span>
      </div>

      <div style={styles.cityReached}>
        {cityName.toUpperCase()} · LEVEL {state.level + 1}
      </div>

      <p style={styles.callout}>
        SHARE THE PAIN 🌴
      </p>

      {/* Share buttons grid */}
      <div style={styles.btnGrid}>
        <ShareButton
          label="TIKTOK"
          color="#ff006a"
          onClick={handleTikTok}
        />
        <ShareButton
          label="POST ON X"
          color="#ffffff"
          onClick={handleX}
        />
        <ShareButton
          label={linkCopied ? '✓ COPIED!' : 'COPY LINK'}
          color="#00eeff"
          onClick={handleCopy}
        />
        <ShareButton
          label="SEND TO FRIEND"
          color="#ffaa00"
          onClick={() => setEmailModalOpen(true)}
        />
      </div>

      {/* Email to friend modal */}
      {emailModalOpen && (
        <div style={styles.emailModal}>
          {emailSent ? (
            <div style={styles.sentMsg}>✓ INVITE SENT!</div>
          ) : (
            <>
              <div style={styles.emailModalLabel}>FRIEND'S EMAIL</div>
              <input
                type="email"
                value={recipientEmail}
                onChange={e => { setRecipientEmail(e.target.value); setEmailError(null) }}
                onKeyDown={e => e.key === 'Enter' && handleEmailSend()}
                placeholder="friend@email.com"
                autoFocus
                style={{
                  ...styles.emailInput,
                  borderColor: emailError ? '#ff3a3a' : '#333',
                }}
                disabled={emailSending}
              />
              {emailError && <div style={styles.emailError}>{emailError}</div>}
              <div style={styles.emailModalBtns}>
                <button
                  onClick={handleEmailSend}
                  disabled={emailSending}
                  style={{ ...styles.btnSendEmail, opacity: emailSending ? 0.6 : 1 }}
                >
                  {emailSending ? 'SENDING…' : '► SEND'}
                </button>
                <button
                  onClick={() => { setEmailModalOpen(false); setEmailError(null) }}
                  style={styles.btnCancelEmail}
                >
                  CANCEL
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Play again */}
      <button onClick={onRetry} style={styles.retryBtn}>
        ↺ PLAY AGAIN
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARE BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function ShareButton({
  label,
  color,
  onClick,
}: {
  label:   string
  color:   string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily:    '"Press Start 2P", monospace',
        background:    'none',
        border:        `1px solid ${color}55`,
        color,
        padding:       '8px 10px',
        fontSize:      7,
        cursor:        'pointer',
        letterSpacing: 0.5,
        textShadow:    `0 0 6px ${color}`,
        whiteSpace:    'nowrap',
        transition:    'border-color 0.15s',
      }}
    >
      {label}
    </button>
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
    padding:        '0 20px',
    boxSizing:      'border-box',
  },
  scoreRecap: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#ffff00',
    fontSize:    26,
    textShadow:  '0 0 18px #ffff00',
    marginBottom: 4,
  },
  scoreLabel: {
    fontSize: 12,
    color:    '#ffff0088',
  },
  cityReached: {
    fontFamily:    '"Orbitron", sans-serif',
    color:         '#00eeff',
    fontSize:      9,
    letterSpacing: 3,
    marginBottom:  14,
    textShadow:    '0 0 8px #00eeff',
  },
  callout: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#ff00ff',
    fontSize:    8,
    margin:      '0 0 18px',
    textShadow:  '0 0 8px #ff00ff',
  },
  btnGrid: {
    display:             'grid',
    gridTemplateColumns: '1fr 1fr',
    gap:                 8,
    width:               '100%',
    maxWidth:            300,
    marginBottom:        16,
  },
  emailModal: {
    width:          '100%',
    maxWidth:       300,
    background:     '#0a0a0a',
    border:         '1px solid #333',
    padding:        12,
    marginBottom:   14,
    display:        'flex',
    flexDirection:  'column',
    gap:            8,
    boxSizing:      'border-box',
  },
  emailModalLabel: {
    fontFamily:    '"Press Start 2P", monospace',
    color:         '#ffaa00',
    fontSize:      7,
    letterSpacing: 1,
  },
  emailInput: {
    background:  '#000',
    border:      '1px solid #333',
    color:       '#fff',
    fontFamily:  '"Press Start 2P", monospace',
    fontSize:    7,
    padding:     '8px 10px',
    outline:     'none',
    width:       '100%',
    boxSizing:   'border-box',
  },
  emailError: {
    fontFamily: '"Press Start 2P", monospace',
    color:      '#ff3a3a',
    fontSize:   6,
  },
  emailModalBtns: {
    display: 'flex',
    gap:     8,
  },
  btnSendEmail: {
    fontFamily:    '"Press Start 2P", monospace',
    background:    'none',
    border:        '1px solid #ffaa00',
    color:         '#ffaa00',
    padding:       '7px 12px',
    fontSize:      7,
    cursor:        'pointer',
    letterSpacing: 0.5,
  },
  btnCancelEmail: {
    fontFamily:    '"Press Start 2P", monospace',
    background:    'none',
    border:        '1px solid #333',
    color:         '#444',
    padding:       '7px 12px',
    fontSize:      7,
    cursor:        'pointer',
    letterSpacing: 0.5,
  },
  sentMsg: {
    fontFamily:  '"Press Start 2P", monospace',
    color:       '#00ff88',
    fontSize:    9,
    textAlign:   'center',
    textShadow:  '0 0 8px #00ff88',
    padding:     '8px 0',
  },
  retryBtn: {
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
  },
}

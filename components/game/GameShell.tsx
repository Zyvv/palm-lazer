// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — components/game/GameShell.tsx
// File 18 of 48
//
// Top-level client component. Owns:
//   - useGameEngine hook (canvas + RAF loop)
//   - useSession hook (API lifecycle + event batching)
//   - TickEvent → session event relay
//   - Overlay state machine (start / gameover / email_capture / share)
//   - Groq churn check scheduling (30s / 60s / 90s)
//   - data-city attribute on wrapper div (CSS var theming)
//   - DOM HUD sync (score / level / lives text nodes)
//
// All sub-overlays live in components/game/overlays/.
// ═══════════════════════════════════════════════════════════════════════════

'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import type { GameState, OverlayView, RunSummary, UtmData } from '@/lib/game/types'
import { GAME_CONSTANTS, getCityForLevel } from '@/lib/game/cities'
import { formatScore, formatLives } from '@/lib/game/engine'
import type { TickEvent } from '@/lib/game/engine'

import { useGameEngine } from '@/hooks/useGameEngine'
import {
  useSession,
  makeGameStartEvent,
  makeGameOverEvent,
  makeLevelUpEvent,
  makeLaserDodgedEvent,
  makeLaserHitEvent,
  makeLifeLostEvent,
} from '@/hooks/useSession'

import { StartOverlay }     from '@/components/game/overlays/StartOverlay'
import { GameOverOverlay }  from '@/components/game/overlays/GameOverOverlay'
import { EmailCapture }     from '@/components/game/overlays/EmailCapture'
import { ShareBar }         from '@/components/game/overlays/ShareBar'

const {
  STARTING_LIVES,
  EMAIL_PROMPT_DELAY_MS,
  CHURN_CHECK_INTERVALS_MS,
  ZYVV_BRIDGE_MIN_LEVEL,
  CANVAS_HEIGHT,
} = GAME_CONSTANTS

// ─────────────────────────────────────────────────────────────────────────────
// PROPS
// ─────────────────────────────────────────────────────────────────────────────

interface GameShellProps {
  utmData: UtmData
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function GameShell({ utmData }: GameShellProps) {
  // ── Overlay state machine ─────────────────────────────────────────────────
  const [overlay, setOverlay]         = useState<OverlayView>('start')
  const [finalState, setFinalState]   = useState<GameState | null>(null)

  // Accumulated run summaries for the current session
  const runsRef     = useRef<RunSummary[]>([])
  const runStartRef = useRef<number>(Date.now())

  // Churn check timeout handles
  const churnTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // DOM refs for HUD text — updated directly to avoid re-renders at 60fps
  const scoreElRef = useRef<HTMLSpanElement>(null)
  const levelElRef = useRef<HTMLSpanElement>(null)
  const livesElRef = useRef<HTMLSpanElement>(null)

  // ── Session hook ──────────────────────────────────────────────────────────
  const { startSession, pushEvent, endSession, sessionId } = useSession({ utmData })

  // ── TickEvent relay ───────────────────────────────────────────────────────
  const handleTick = useCallback((events: TickEvent[]) => {
    for (const ev of events) {
      switch (ev.type) {

        case 'laser_dodged':
          // We don't have the full state here — GameShell reads it via gameState
          // below. For near-miss events we push a minimal payload.
          pushEvent({
            event_type: 'laser_dodged',
            laser_side:  ev.laser.side,
            laser_y:     Math.round(ev.laser.y),
            laser_speed: Math.abs(ev.laser.speed),
          })
          break

        case 'laser_hit':
          pushEvent({
            event_type:      'laser_hit',
            palm_x_position: Math.round(ev.palmX),
            laser_side:      ev.laser.side,
            laser_y:         Math.round(ev.laser.y),
            laser_speed:     Math.abs(ev.laser.speed),
          })
          break

        case 'life_lost':
          pushEvent({
            event_type:      'life_lost',
            lives_remaining: ev.livesRemaining,
          })
          break

        case 'level_up':
          pushEvent({
            event_type:   'level_up',
            level_number: ev.level,
            city_name:    ev.cityName,
          })
          break

        case 'game_over':
          // Handled in onGameOver callback — needs full state
          break
      }
    }
  }, [pushEvent])

  // ── Game over callback ────────────────────────────────────────────────────
  const handleGameOver = useCallback((state: GameState) => {
    setFinalState(state)

    // Record run summary
    const durationSeconds = Math.round((Date.now() - runStartRef.current) / 1000)
    const run: RunSummary = {
      run_number:          state.runNumber,
      duration_seconds:    durationSeconds,
      final_score:         state.score,
      max_level_reached:   state.currentRun.maxLevel,
      max_city_reached:    state.currentRun.maxCity,
      total_lasers_dodged: state.currentRun.lasersDoged,
      total_lives_lost:    state.currentRun.livesLost,
      end_reason:          'laser_hit',
    }
    runsRef.current = [...runsRef.current, run]

    // Push game_over event — this also triggers immediate batch flush
    pushEvent(makeGameOverEvent(state))

    // Clear churn timers
    churnTimersRef.current.forEach(t => clearTimeout(t))
    churnTimersRef.current = []

    // End session (async — fire and forget from UI perspective)
    endSession(state, runsRef.current)

    // Show game-over overlay after brief death flash
    setTimeout(() => {
      setOverlay('gameover')
    }, EMAIL_PROMPT_DELAY_MS)
  }, [pushEvent, endSession])

  // ── Level-up callback ─────────────────────────────────────────────────────
  const handleLevelUp = useCallback((_level: number, cityName: string) => {
    // CSS theming: data-city drives city-specific CSS variables
    const wrapper = document.getElementById('pg-shell')
    if (wrapper) wrapper.dataset.city = cityName.toLowerCase()
  }, [])

  // ── Engine hook ───────────────────────────────────────────────────────────
  const { canvasRef, gameState, play, pause, resume } = useGameEngine({
    onTick:     handleTick,
    onGameOver: handleGameOver,
    onLevelUp:  handleLevelUp,
  })

  // ── DOM HUD sync — direct DOM writes avoid 60fps setState ────────────────
  useEffect(() => {
    if (scoreElRef.current) scoreElRef.current.textContent = formatScore(gameState.score)
    if (levelElRef.current) {
      const city = getCityForLevel(gameState.level)
      levelElRef.current.textContent = city.name.toUpperCase()
    }
    if (livesElRef.current) {
      livesElRef.current.textContent = formatLives(gameState.lives, STARTING_LIVES)
    }
  })   // intentionally no dep array — runs after every render / engine sync

  // ── Churn check scheduling ────────────────────────────────────────────────
  const scheduleChurnChecks = useCallback(() => {
    churnTimersRef.current.forEach(t => clearTimeout(t))
    churnTimersRef.current = CHURN_CHECK_INTERVALS_MS.map(ms =>
      setTimeout(async () => {
        const sid = sessionId()
        if (!sid) return
        // Fire churn check server-side — result may trigger email prompt
        try {
          await fetch('/api/intelligence/churn', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              session_id:    sid,
              elapsed_ms:    ms,
              current_score: gameState.score,
              current_level: gameState.level,
            }),
          })
        } catch {
          // Non-critical — ignore
        }
      }, ms),
    )
  }, [sessionId, gameState.score, gameState.level])

  // ── PLAY handler ──────────────────────────────────────────────────────────
  const handlePlay = useCallback(async () => {
    runsRef.current  = []
    runStartRef.current = Date.now()

    setOverlay('none')
    setFinalState(null)

    await startSession()

    play()

    // Push game_start event after engine initialises
    // Small delay so gameState.phase is 'playing' before we read it
    setTimeout(() => {
      pushEvent(makeGameStartEvent(gameState))
    }, 50)

    scheduleChurnChecks()
  }, [startSession, play, pushEvent, gameState, scheduleChurnChecks])

  // ── RETRY handler ─────────────────────────────────────────────────────────
  const handleRetry = useCallback(async () => {
    runStartRef.current = Date.now()

    setOverlay('none')
    setFinalState(null)

    // Start a fresh session for the retry
    await startSession()

    play()

    setTimeout(() => {
      pushEvent(makeGameStartEvent(gameState))
    }, 50)

    scheduleChurnChecks()
  }, [startSession, play, pushEvent, gameState, scheduleChurnChecks])

  // ── Email capture submitted ───────────────────────────────────────────────
  const handleEmailSubmitted = useCallback(() => {
    pushEvent({ event_type: 'email_submitted' })
    setOverlay('share')
  }, [pushEvent])

  // ── Email capture dismissed ───────────────────────────────────────────────
  const handleEmailDismissed = useCallback(() => {
    pushEvent({ event_type: 'email_dismissed' })
    setOverlay('share')
  }, [pushEvent])

  // ── Share prompt seen ─────────────────────────────────────────────────────
  useEffect(() => {
    if (overlay === 'share') {
      pushEvent({ event_type: 'share_prompt_seen' })
    }
  }, [overlay, pushEvent])

  // ── Game over → maybe show email capture first ────────────────────────────
  const handleGameOverContinue = useCallback(() => {
    const state = finalState
    if (!state) return

    // Show email capture if score > 0 and not already submitted
    if (state.score > 0) {
      pushEvent({ event_type: 'email_prompt_seen' })
      setOverlay('email_capture')
    } else {
      setOverlay('share')
    }
  }, [finalState, pushEvent])

  // ── City CSS var on level change ──────────────────────────────────────────
  useEffect(() => {
    const wrapper = document.getElementById('pg-shell')
    if (!wrapper) return
    const city = getCityForLevel(gameState.level)
    wrapper.dataset.city = city.key
  }, [gameState.level])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      id="pg-shell"
      data-city="miami"
      style={{
        position:   'relative',
        width:      '100%',
        background: '#000',
        borderRadius: '8px',
        overflow:   'hidden',
        fontFamily: '"Press Start 2P", monospace',
      }}
    >
      {/* ── Canvas ──────────────────────────────────────────────────────── */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width:   '100%',
          height:  `${CANVAS_HEIGHT}px`,
        }}
      />

      {/* ── CRT scanlines overlay (CSS only — no JS) ────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position:   'absolute',
          top: 0, left: 0,
          width:      '100%',
          height:     '100%',
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px)',
          pointerEvents: 'none',
          zIndex:     10,
          borderRadius: '8px',
        }}
      />

      {/* ── DOM HUD — for accessibility / screen-reader sync ─────────────── */}
      <div
        aria-live="polite"
        style={{
          position:      'absolute',
          top: 0, left: 0,
          width:         '100%',
          height:        '100%',
          pointerEvents: 'none',
          zIndex:        5,
        }}
      >
        <div style={{ position: 'absolute', top: 12, left: 16, color: '#00ff88', fontSize: 9, letterSpacing: 1, textShadow: '0 0 8px #00ff88' }}>
          SCORE: <span ref={scoreElRef}>0</span>
        </div>
        <div style={{ position: 'absolute', top: 12, right: 16, color: '#ff00ff', fontSize: 9, letterSpacing: 1, textShadow: '0 0 8px #ff00ff' }}>
          <span ref={levelElRef}>MIAMI</span>
        </div>
        <div style={{ position: 'absolute', top: 32, left: 16, color: '#ffff00', fontSize: 8, textShadow: '0 0 6px #ffff00' }}>
          <span ref={livesElRef}>♥♥♥</span>
        </div>
      </div>

      {/* ── Overlays ─────────────────────────────────────────────────────── */}

      {overlay === 'start' && (
        <StartOverlay onPlay={handlePlay} />
      )}

      {overlay === 'gameover' && finalState && (
        <GameOverOverlay
          state={finalState}
          onContinue={handleGameOverContinue}
          onRetry={handleRetry}
        />
      )}

      {overlay === 'email_capture' && finalState && (
        <EmailCapture
          state={finalState}
          sessionId={sessionId()}
          onSubmitted={handleEmailSubmitted}
          onDismiss={handleEmailDismissed}
        />
      )}

      {overlay === 'share' && finalState && (
        <ShareBar
          state={finalState}
          sessionId={sessionId()}
          onRetry={handleRetry}
          onEventPush={pushEvent}
        />
      )}
    </div>
  )
}

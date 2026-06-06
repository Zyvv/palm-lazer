// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — hooks/useSession.ts
// File 17 of 48
//
// Owns the full session lifecycle:
//   - POST /api/session/start  → stores session_id in a ref
//   - POST /api/session/event  → batched, 500ms debounce, max 20 events
//   - POST /api/session/end    → flushes remaining events, closes session
//
// Rules:
//   - session_id never touches React state — it lives in a ref
//   - Groq is called server-side only; this hook never calls Groq directly
//   - Event batch is flushed on game_over regardless of debounce timer
//   - All fetch calls are fire-and-forget with error swallowing —
//     a network failure must never crash the game
// ═══════════════════════════════════════════════════════════════════════════

'use client'

import { useCallback, useEffect, useRef } from 'react'

import type {
  GameEventPayload,
  GameEventType,
  GameState,
  RunSummary,
  SessionStartRequest,
  SessionStartResponse,
  SessionEventRequest,
  SessionEndRequest,
  UtmData,
} from '@/lib/game/types'
import { GAME_CONSTANTS } from '@/lib/game/cities'

const {
  EVENT_BATCH_INTERVAL_MS,
  EVENT_BATCH_MAX_SIZE,
} = GAME_CONSTANTS

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface UseSessionOptions {
  utmData: UtmData
}

export interface UseSessionReturn {
  /** Call once when the user clicks Play */
  startSession:  () => Promise<void>
  /** Queue a game event for batched delivery */
  pushEvent:     (payload: GameEventPayload) => void
  /** Call on game_over — flushes batch, closes session */
  endSession:    (finalState: GameState, runs: RunSummary[]) => Promise<void>
  /** Current session ID (null until startSession resolves) */
  sessionId:     () => string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// FINGERPRINT — lightweight browser fingerprint, no external lib required
// ─────────────────────────────────────────────────────────────────────────────

function getBrowserFingerprint(): string {
  try {
    const parts = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.hardwareConcurrency ?? '',
    ]
    // Simple non-cryptographic hash — good enough for session dedup
    let hash = 0
    const str = parts.join('|')
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash).toString(36)
  } catch {
    return 'unknown'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

export function useSession({ utmData }: UseSessionOptions): UseSessionReturn {
  const sessionIdRef      = useRef<string | null>(null)
  const sessionStartedAt  = useRef<number>(0)
  const batchRef          = useRef<GameEventPayload[]>([])
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFlushing        = useRef<boolean>(false)

  // ── Flush batch to API ────────────────────────────────────────────────────

  const flushBatch = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) return
    if (batchRef.current.length === 0) return
    if (isFlushing.current) return

    isFlushing.current = true
    const events = batchRef.current.splice(0)   // drain atomically

    try {
      const body: SessionEventRequest = { session_id: sid, events }
      await fetch('/api/session/event', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
    } catch {
      // Network failure — silently discard. Game must never crash.
    } finally {
      isFlushing.current = false
    }
  }, [])

  // ── Schedule debounced flush ──────────────────────────────────────────────

  const scheduleBatchFlush = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      flushBatch()
    }, EVENT_BATCH_INTERVAL_MS)
  }, [flushBatch])

  // ── Push event into batch ─────────────────────────────────────────────────

  const pushEvent = useCallback((payload: GameEventPayload) => {
    batchRef.current.push(payload)

    // Force-flush if batch is at capacity
    if (batchRef.current.length >= EVENT_BATCH_MAX_SIZE) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      flushBatch()
      return
    }

    // Also force-flush immediately on game_over — don't wait for debounce
    if (payload.event_type === 'game_over') {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      flushBatch()
      return
    }

    scheduleBatchFlush()
  }, [flushBatch, scheduleBatchFlush])

  // ── Start session ─────────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    sessionStartedAt.current = Date.now()

    const body: SessionStartRequest = {
      fingerprint:   getBrowserFingerprint(),
      screen_w:      window.screen.width,
      screen_h:      window.screen.height,
      referrer:      document.referrer || null,
      utm_source:    utmData.utm_source,
      utm_medium:    utmData.utm_medium,
      utm_campaign:  utmData.utm_campaign,
      utm_content:   utmData.utm_content,
      landing_url:   window.location.href,
      device_type:   /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
      os:            navigator.platform ?? null,
      browser:       navigator.userAgent.split(' ').pop() ?? null,
      lang:          navigator.language ?? null,
      tz:            Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    }

    try {
      const res  = await fetch('/api/session/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data: SessionStartResponse = await res.json()
      sessionIdRef.current = data.session_id
    } catch {
      // If session creation fails, gameplay continues untracked.
      // A local fallback ID keeps pushEvent from silently no-oping.
      sessionIdRef.current = `local_${Date.now().toString(36)}`
    }
  }, [utmData])

  // ── End session ───────────────────────────────────────────────────────────

  const endSession = useCallback(async (
    finalState: GameState,
    runs:       RunSummary[],
  ) => {
    const sid = sessionIdRef.current
    if (!sid) return

    // Cancel pending debounce — we're flushing synchronously below
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    // Flush any remaining events first
    await flushBatch()

    const durationSeconds = Math.round(
      (Date.now() - sessionStartedAt.current) / 1000,
    )

    const body: SessionEndRequest = {
      session_id:               sid,
      session_duration_seconds: durationSeconds,
      final_score:              finalState.score,
      max_level_reached:        finalState.level,
      runs,
    }

    try {
      await fetch('/api/session/end', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
    } catch {
      // Silent failure — game is already over, nothing to recover
    }
  }, [flushBatch])

  // ── Flush on page unload ──────────────────────────────────────────────────
  // Use sendBeacon so the flush survives the page closing.

  useEffect(() => {
    const handleUnload = () => {
      const sid = sessionIdRef.current
      if (!sid || batchRef.current.length === 0) return

      try {
        const body: SessionEventRequest = {
          session_id: sid,
          events:     batchRef.current.splice(0),
        }
        navigator.sendBeacon(
          '/api/session/event',
          new Blob([JSON.stringify(body)], { type: 'application/json' }),
        )
      } catch {
        // Best-effort only
      }
    }

    window.addEventListener('pagehide',         handleUnload)
    window.addEventListener('beforeunload',      handleUnload)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) handleUnload()
    })

    return () => {
      window.removeEventListener('pagehide',    handleUnload)
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [])

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  // ── Public accessor for session ID ───────────────────────────────────────

  const sessionId = useCallback(() => sessionIdRef.current, [])

  return { startSession, pushEvent, endSession, sessionId }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — build typed GameEventPayload objects
// Callers use these to avoid hand-writing the same field mapping everywhere.
// ─────────────────────────────────────────────────────────────────────────────

export function makeGameStartEvent(state: GameState): GameEventPayload {
  return {
    event_type:    'game_start',
    score:         0,
    level_number:  0,
    city_name:     'Miami',
    lives_remaining: state.lives,
    frame_number:  0,
  }
}

export function makeGameOverEvent(state: GameState): GameEventPayload {
  return {
    event_type:     'game_over',
    score:          state.score,
    level_number:   state.level,
    city_name:      state.currentRun.maxCity,
    lives_remaining: 0,
    frame_number:   state.frame,
  }
}

export function makeLevelUpEvent(
  state:    GameState,
  cityName: string,
): GameEventPayload {
  return {
    event_type:    'level_up',
    score:         state.score,
    level_number:  state.level,
    city_name:     cityName,
    lives_remaining: state.lives,
    frame_number:  state.frame,
  }
}

export function makeLaserDodgedEvent(state: GameState): GameEventPayload {
  return {
    event_type:    'lazer_dodged',
    score:         state.score,
    level_number:  state.level,
    city_name:     state.currentRun.maxCity,
    lives_remaining: state.lives,
    palm_x_position: Math.round(state.palmX),
    frame_number:  state.frame,
  }
}

export function makeLaserHitEvent(state: GameState): GameEventPayload {
  // Most recent laser that was active — engine already tagged it inactive
  const hitLaser = state.lasers.find(l => !l.active)
  return {
    event_type:      'lazer_hit',
    score:           state.score,
    level_number:    state.level,
    city_name:       state.currentRun.maxCity,
    lives_remaining: state.lives,
    palm_x_position: Math.round(state.palmX),
    frame_number:    state.frame,
    lazer_side:      hitLaser?.side ?? undefined,
    lazer_y:         hitLaser ? Math.round(hitLaser.y) : undefined,
    lazer_speed:     hitLaser ? Math.abs(hitLaser.speed) : undefined,
  }
}

export function makeLifeLostEvent(
  state:          GameState,
  livesRemaining: number,
): GameEventPayload {
  return {
    event_type:      'life_lost',
    score:           state.score,
    level_number:    state.level,
    city_name:       state.currentRun.maxCity,
    lives_remaining: livesRemaining,
    frame_number:    state.frame,
  }
}

export function makePauseEvent(state: GameState): GameEventPayload {
  return {
    event_type:    'pause',
    score:         state.score,
    level_number:  state.level,
    city_name:     state.currentRun.maxCity,
    frame_number:  state.frame,
  }
}

export function makeResumeEvent(state: GameState): GameEventPayload {
  return {
    event_type:    'resume',
    score:         state.score,
    level_number:  state.level,
    city_name:     state.currentRun.maxCity,
    frame_number:  state.frame,
  }
}

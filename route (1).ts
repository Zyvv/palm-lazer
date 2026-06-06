// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/session/event/route.ts
// File 25 of 48
//
// POST /api/session/event
//
// Receives a batch of GameEventPayload objects from useSession (500ms debounce,
// max 20 events per batch). Bulk-inserts into game_events and updates
// sessions.last_active_at. Also updates share flags on share_clicked events.
//
// Rules:
//   - Accepts sendBeacon payloads (Content-Type: text/plain with JSON body)
//     in addition to application/json — browsers use sendBeacon on page unload
//   - session_id is validated as a non-empty string; no UUID format check
//     (avoids rejecting local_* fallback IDs from useSession)
//   - Silently drops events with unrecognised event_type rather than 400ing —
//     a bad event must never crash the batch
//   - share_clicked events trigger a session UPDATE for share flags
//   - Returns { inserted: N } — count of successfully inserted rows
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import type {
  SessionEventRequest,
  SessionEventResponse,
  GameEventPayload,
} from '@/lib/game/types'

// ─────────────────────────────────────────────────────────────────────────────
// VALID EVENT TYPES — drop anything not in this set
// ─────────────────────────────────────────────────────────────────────────────

const VALID_EVENT_TYPES = new Set([
  'game_start',
  'game_over',
  'level_up',
  'laser_dodged',
  'laser_hit',
  'life_lost',
  'pause',
  'resume',
  'share_prompt_seen',
  'share_clicked',
  'email_prompt_seen',
  'email_submitted',
  'email_dismissed',
])

// ─────────────────────────────────────────────────────────────────────────────
// SHARE FLAG MAP — which DB column to set true for each platform
// ─────────────────────────────────────────────────────────────────────────────

const SHARE_FLAG_MAP: Record<string, string> = {
  tiktok: 'shared_tiktok',
  x:      'shared_x',
  email:  'shared_email',
  copy:   'shared_link_copied',
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY PARSER — handles both application/json and text/plain (sendBeacon)
// ─────────────────────────────────────────────────────────────────────────────

async function parseBody(req: NextRequest): Promise<SessionEventRequest | null> {
  try {
    const contentType = req.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      return await req.json()
    }

    // sendBeacon sends Content-Type: text/plain; charset=UTF-8
    // but body is still JSON-encoded
    const text = await req.text()
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse body ─────────────────────────────────────────────────────────────
  const body = await parseBody(req)

  if (!body || typeof body.session_id !== 'string' || !body.session_id) {
    return NextResponse.json(
      { error: 'session_id is required' },
      { status: 400 },
    )
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json<SessionEventResponse>({ inserted: 0 })
  }

  const { session_id, events } = body

  // ── Sanitise and map events to DB rows ────────────────────────────────────
  const rows = events
    .filter((e: GameEventPayload) => VALID_EVENT_TYPES.has(e.event_type))
    .map((e: GameEventPayload) => ({
      session_id,
      event_type:            e.event_type,
      score:                 e.score                 ?? null,
      level_number:          e.level_number          ?? null,
      city_name:             e.city_name             ?? null,
      lives_remaining:       e.lives_remaining       ?? null,
      frame_number:          e.frame_number          ?? null,
      palm_x_position:       e.palm_x_position       ?? null,
      laser_side:            e.laser_side            ?? null,
      laser_y:               e.laser_y               ?? null,
      laser_speed:           e.laser_speed           ?? null,
      share_platform:        e.share_platform        ?? null,
      share_recipient_email: e.share_recipient_email ?? null,
      occurred_at:           new Date().toISOString(),
    }))

  if (rows.length === 0) {
    return NextResponse.json<SessionEventResponse>({ inserted: 0 })
  }

  try {
    const supabase = createServerClient()

    // ── Bulk insert events ──────────────────────────────────────────────────
    const { error: insertError } = await supabase
      .from('game_events')
      .insert(rows)

    if (insertError) {
      console.error('[session/event] Insert error:', insertError.message)
      // Don't 500 — return partial success count as 0 and let game continue
      return NextResponse.json<SessionEventResponse>({ inserted: 0 }, { status: 200 })
    }

    // ── Update last_active_at on the session ────────────────────────────────
    // Fire-and-forget — don't await or fail the response on this
    supabase
      .from('sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', session_id)
      .then(({ error }) => {
        if (error) console.error('[session/event] last_active_at update error:', error.message)
      })

    // ── Handle share_clicked events — update share flags ───────────────────
    const shareEvents = events.filter(
      (e: GameEventPayload) => e.event_type === 'share_clicked' && e.share_platform,
    )

    if (shareEvents.length > 0) {
      // Collect all platforms clicked in this batch (could be multiple)
      const flagUpdates: Record<string, boolean | string> = {
        share_clicked_at: new Date().toISOString(),
      }

      shareEvents.forEach((e: GameEventPayload) => {
        const col = SHARE_FLAG_MAP[e.share_platform ?? '']
        if (col) flagUpdates[col] = true
      })

      // Fire-and-forget
      supabase
        .from('sessions')
        .update(flagUpdates)
        .eq('id', session_id)
        .then(({ error }) => {
          if (error) console.error('[session/event] share flag update error:', error.message)
        })
    }

    return NextResponse.json<SessionEventResponse>({ inserted: rows.length })

  } catch (err) {
    console.error('[session/event] Unexpected error:', err)
    // Silent 200 — a network failure must never crash the game client
    return NextResponse.json<SessionEventResponse>({ inserted: 0 }, { status: 200 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

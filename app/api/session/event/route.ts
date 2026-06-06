// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — app/api/session/event/route.ts
// File 40 of 48
//
// POST /api/session/event
//
// Receives batched GameEventPayload[] from the client (useSession hook,
// 500ms debounce, max 20 events per batch). Bulk-inserts into game_events
// and updates sessions.last_active_at. Handles share_clicked events by
// setting the corresponding share flag columns on the session row.
//
// Also accepts sendBeacon payloads (Content-Type: text/plain with JSON body)
// so events are never lost on page unload.
//
// Runtime: edge
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface GameEventPayload {
  event_type:             string
  score?:                 number | null
  level_number?:          number | null
  city_name?:             string | null
  lives_remaining?:       number | null
  frame_number?:          number | null
  palm_x_position?:       number | null
  laser_side?:            string | null
  laser_y?:               number | null
  laser_speed?:           number | null
  share_platform?:        string | null
  share_recipient_email?: string | null
}

interface EventBatchBody {
  session_id: string
  events:     GameEventPayload[]
}

// ─────────────────────────────────────────────────────────────────────────────
// VALID EVENT TYPES — drop anything not in this set
// ─────────────────────────────────────────────────────────────────────────────

const VALID_EVENT_TYPES = new Set([
  'game_start',
  'game_over',
  'level_up',
  'lazer_dodged',   // Palm Lazer spelling — always Lazer
  'lazer_hit',
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
// SHARE FLAG MAP — which column to set true per platform
// ─────────────────────────────────────────────────────────────────────────────

const SHARE_FLAG_MAP: Record<string, string> = {
  tiktok: 'shared_tiktok',
  x:      'shared_x',
  email:  'shared_email',
  copy:   'shared_link_copied',
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT
// ─────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY PARSER — handles application/json AND text/plain (sendBeacon)
// ─────────────────────────────────────────────────────────────────────────────

async function parseBody(req: NextRequest): Promise<EventBatchBody | null> {
  try {
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      return await req.json()
    }
    // sendBeacon sends text/plain but body is JSON-encoded
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
  // ── Parse ──────────────────────────────────────────────────────────────────
  const body = await parseBody(req)

  if (!body || typeof body.session_id !== 'string' || !body.session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ inserted: 0 }, { status: 200 })
  }

  const { session_id, events } = body

  // ── Sanitise — drop invalid event types ───────────────────────────────────
  const now  = new Date().toISOString()
  const rows = events
    .filter(e => typeof e.event_type === 'string' && VALID_EVENT_TYPES.has(e.event_type))
    .map(e => ({
      session_id,
      event_type:             e.event_type,
      score:                  e.score                  ?? null,
      level_number:           e.level_number           ?? null,
      city_name:              e.city_name              ?? null,
      lives_remaining:        e.lives_remaining        ?? null,
      frame_number:           e.frame_number           ?? null,
      palm_x_position:        e.palm_x_position        ?? null,
      laser_side:             e.laser_side             ?? null,
      laser_y:                e.laser_y                ?? null,
      laser_speed:            e.laser_speed            ?? null,
      share_platform:         e.share_platform         ?? null,
      share_recipient_email:  e.share_recipient_email  ?? null,
      occurred_at:            now,
    }))

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 }, { status: 200 })
  }

  try {
    const supabase = getSupabase()

    // ── Bulk insert game_events ────────────────────────────────────────────
    const { error: insertError } = await supabase
      .from('game_events')
      .insert(rows)

    if (insertError) {
      console.error('[session/event] insert error:', insertError.message)
      // Return 200 — client must never crash on a telemetry failure
      return NextResponse.json({ inserted: 0 }, { status: 200 })
    }

    // ── Update last_active_at (fire-and-forget) ────────────────────────────
    supabase
      .from('sessions')
      .update({ last_active_at: now })
      .eq('id', session_id)
      .then(({ error }) => {
        if (error) console.error('[session/event] last_active_at error:', error.message)
      })

    // ── Handle share_clicked — set share flag columns ──────────────────────
    const shareEvents = events.filter(
      e => e.event_type === 'share_clicked' && e.share_platform,
    )

    if (shareEvents.length > 0) {
      const flagUpdate: Record<string, boolean | string> = {
        share_clicked_at: now,
      }
      shareEvents.forEach(e => {
        const col = SHARE_FLAG_MAP[e.share_platform ?? '']
        if (col) flagUpdate[col] = true
      })

      supabase
        .from('sessions')
        .update(flagUpdate)
        .eq('id', session_id)
        .then(({ error }) => {
          if (error) console.error('[session/event] share flag error:', error.message)
        })
    }

    return NextResponse.json({ inserted: rows.length }, { status: 200 })

  } catch (err) {
    console.error('[session/event] unexpected error:', err)
    // Always 200 — telemetry must never crash the game
    return NextResponse.json({ inserted: 0 }, { status: 200 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

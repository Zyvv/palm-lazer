// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — app/api/session/end/route.ts
// File 41 of 48
//
// POST /api/session/end
//
// Called by useSession.endSession() on game_over, tab close, or page unload.
//
// Steps:
//   1. Close the session row (ended_at, duration, final_score, max_level_reached)
//   2. Bulk-insert runs[] into the runs table
//   3. Fire-and-forget Groq session summary (llama-3.3-70b)
//      — triggered 5s after last event, never awaited by client
//
// Rules:
//   - Always returns 200 — client is fire-and-forget after game over
//   - Groq called server-side only, never awaited by client
//   - runs[] may be empty (tab closed before first game_over) — no-op
//   - product_source: 'palm_lazer' on every session row
//   - Runtime: edge
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface RunSummary {
  run_number:          number
  duration_seconds:    number
  final_score:         number
  max_level_reached:   number
  max_city_reached:    string
  total_lazers_dodged: number
  total_lives_lost:    number
  end_reason:          'lazer_hit' | 'quit' | 'tab_closed'
}

interface SessionEndBody {
  session_id:               string
  session_duration_seconds: number
  final_score:              number
  max_level_reached:        number
  runs:                     RunSummary[]
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
// GROQ — fire-and-forget session behavioral summary
// Model: llama-3.3-70b
// Never awaited by the route handler — queued via EdgeRuntime's waitUntil
// pattern (Promise chain detached from the response).
// ─────────────────────────────────────────────────────────────────────────────

async function queueGroqSessionSummary(
  sessionId:     string,
  finalScore:    number,
  maxLevel:      number,
  totalRuns:     number,
  emailCaptured: boolean,
  shared:        boolean,
): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return

  const supabase = getSupabase()
  const startMs  = Date.now()

  // Fetch recent events for this session
  const { data: events } = await supabase
    .from('game_events')
    .select('event_type')
    .eq('session_id', sessionId)
    .order('occurred_at', { ascending: true })
    .limit(200)

  const eventBreakdown = (events ?? []).reduce((acc: Record<string, number>, e: { event_type: string }) => {
    acc[e.event_type] = (acc[e.event_type] ?? 0) + 1
    return acc
  }, {})

  const CITIES = ['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza']
  const cityName = CITIES[Math.min(maxLevel, 4)] ?? 'Miami'

  const prompt = `You are a game analytics engine for Palm Lazer, a retro browser arcade game.
Analyze this session and return a JSON object only — no markdown, no preamble.

Session data:
- session_id: ${sessionId}
- final_score: ${finalScore}
- max_level_reached: ${maxLevel} (city: ${cityName})
- total_runs: ${totalRuns}
- email_captured: ${emailCaptured}
- shared: ${shared}
- event_breakdown: ${JSON.stringify(eventBreakdown)}

Return ONLY valid JSON:
{
  "summary": "<2-3 sentence behavioral summary>",
  "engagement_score": <number 0-10, one decimal>,
  "notable_behavior": "<one specific observation>",
  "churn_risk": "low" | "medium" | "high",
  "share_propensity": "low" | "medium" | "high"
}`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        max_tokens:  300,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const latencyMs = Date.now() - startMs

    if (!res.ok) {
      console.error('[session/end] Groq HTTP error:', res.status)
      return
    }

    const json       = await res.json()
    const rawContent = json.choices?.[0]?.message?.content ?? ''
    const tokensUsed = json.usage?.total_tokens ?? 0

    let parsed: Record<string, unknown> | null = null
    try {
      const clean = rawContent.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      console.error('[session/end] Groq parse failed:', rawContent)
    }

    // Log to ai_analysis_log
    await supabase.from('ai_analysis_log').insert({
      session_id:     sessionId,
      analysis_type:  'session_behavior',
      input_payload:  { final_score: finalScore, max_level: maxLevel, total_runs: totalRuns, event_breakdown: eventBreakdown },
      output_payload: parsed ?? { raw: rawContent },
      tokens_used:    tokensUsed,
      latency_ms:     latencyMs,
      model_used:     'llama-3.3-70b-versatile',
      created_at:     new Date().toISOString(),
    })

    // Write enrichment back to session row
    if (parsed) {
      await supabase
        .from('sessions')
        .update({
          groq_session_summary: parsed.summary          as string ?? null,
          engagement_score:     parsed.engagement_score as number ?? null,
          churn_risk:           parsed.churn_risk       as string ?? null,
          share_propensity:     parsed.share_propensity as string ?? null,
        })
        .eq('id', sessionId)
    }

  } catch (err) {
    console.error('[session/end] Groq error:', err)
    // Silent — Groq is enrichment, not core
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: SessionEndBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  if (typeof body.session_id !== 'string' || !body.session_id) {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  const {
    session_id,
    session_duration_seconds,
    final_score,
    max_level_reached,
    runs,
  } = body

  const supabase = getSupabase()
  const now      = new Date().toISOString()

  // ── 1. Close session row ──────────────────────────────────────────────────
  const { error: sessionError } = await supabase
    .from('sessions')
    .update({
      ended_at:                 now,
      last_active_at:           now,
      session_duration_seconds: session_duration_seconds ?? null,
      final_score:              final_score              ?? 0,
      max_level_reached:        max_level_reached        ?? 0,
      runs_json:                runs                     ?? null,
    })
    .eq('id', session_id)

  if (sessionError) {
    console.error('[session/end] session update error:', sessionError.message)
    // Continue — still try to insert runs
  }

  // ── 2. Bulk-insert runs ───────────────────────────────────────────────────
  if (Array.isArray(runs) && runs.length > 0) {
    const runRows = runs.map(r => ({
      session_id,
      run_number:           r.run_number,
      duration_seconds:     r.duration_seconds,
      final_score:          r.final_score,
      max_level_reached:    r.max_level_reached,
      max_city_reached:     r.max_city_reached,
      total_lazers_dodged:  r.total_lazers_dodged,
      total_lives_lost:     r.total_lives_lost,
      end_reason:           r.end_reason,
      ended_at:             now,
    }))

    const { error: runsError } = await supabase
      .from('runs')
      .insert(runRows)

    if (runsError) {
      console.error('[session/end] runs insert error:', runsError.message)
    }
  }

  // ── 3. Fire-and-forget Groq session summary ───────────────────────────────
  // Fetch share/email flags needed for Groq input, then detach
  supabase
    .from('sessions')
    .select('email, shared_tiktok, shared_x, shared_email, shared_link_copied')
    .eq('id', session_id)
    .single()
    .then(({ data }) => {
      const emailCaptured = !!data?.email
      const shared = !!(
        data?.shared_tiktok   ||
        data?.shared_x        ||
        data?.shared_email    ||
        data?.shared_link_copied
      )
      // Detached — not awaited
      queueGroqSessionSummary(
        session_id,
        final_score      ?? 0,
        max_level_reached ?? 0,
        runs?.length      ?? 0,
        emailCaptured,
        shared,
      ).catch(err => console.error('[session/end] Groq queue error:', err))
    })
    .catch(err => console.error('[session/end] session fetch error:', err))

  return NextResponse.json({ ok: true }, { status: 200 })
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

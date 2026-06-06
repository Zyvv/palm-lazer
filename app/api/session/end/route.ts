// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/session/end/route.ts
// File 26 of 48
//
// POST /api/session/end
//
// Called by useSession.endSession() on game_over, tab close, or page unload.
// Responsibilities:
//   1. Close the session row (ended_at, duration, final_score, max_level)
//   2. Bulk-insert runs[] into the runs table
//   3. Trigger Groq end-of-session behavioral summary — async, fire-and-forget
//      (game is already over; the player must never wait for this)
//
// Rules:
//   - Always returns 200 — the client is fire-and-forget after game over
//   - Groq is called server-side only, never awaited by the client
//   - runs[] may be empty (e.g. tab closed before first game_over) — no-op
//   - session_id validated as non-empty string (supports local_* fallback IDs)
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createServerClient } from '@/lib/supabase/server'
import type {
  SessionEndRequest,
  SessionEndResponse,
  GroqSessionSummaryInput,
  GroqSessionSummaryOutput,
} from '@/lib/game/types'

// ─────────────────────────────────────────────────────────────────────────────
// GROQ — end-of-session behavioral summary
// Queued async after the session row is closed. Never awaited by the client.
// ─────────────────────────────────────────────────────────────────────────────

async function queueGroqSessionSummary(
  sessionId:   string,
  input:       GroqSessionSummaryInput,
): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return   // Groq not configured — skip silently

  const supabase = createServerClient()
  const startMs  = Date.now()

  try {
    const groq = new Groq({ apiKey })

    const prompt = `
You are a game analytics engine. Analyze this arcade game session and return a JSON object.

Session data:
- Session ID: ${input.session_id}
- Total runs: ${input.total_runs}
- Final score: ${input.final_score}
- Max level reached: ${input.max_level}
- Email captured: ${input.email_captured}
- Shared the game: ${input.shared}
- Total events: ${input.events.length}
- Event breakdown: ${JSON.stringify(
  input.events.reduce((acc: Record<string, number>, e) => {
    acc[e.event_type] = (acc[e.event_type] ?? 0) + 1
    return acc
  }, {}),
)}

Return ONLY valid JSON matching this exact structure:
{
  "summary": "<2-3 sentence behavioral summary of this session>",
  "engagement_score": <number 0-10, one decimal place>,
  "notable_behavior": "<one specific observation about this player's pattern>",
  "churn_risk": "low" | "medium" | "high",
  "share_propensity": "low" | "medium" | "high"
}
`.trim()

    const completion = await groq.chat.completions.create({
      model:       'llama-3.1-70b-versatile',
      max_tokens:  300,
      temperature: 0.3,
      messages: [
        { role: 'user', content: prompt },
      ],
    })

    const latencyMs  = Date.now() - startMs
    const rawContent = completion.choices[0]?.message?.content ?? ''
    const tokensUsed = completion.usage?.total_tokens ?? 0

    // Parse Groq output
    let parsed: GroqSessionSummaryOutput | null = null
    try {
      const clean = rawContent.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      console.error('[session/end] Groq parse failed:', rawContent)
    }

    // Log to ai_analysis_log regardless of parse success
    await supabase
      .from('ai_analysis_log')
      .insert({
        session_id:     sessionId,
        analysis_type:  'session_behavior',
        input_payload:  input as unknown as Record<string, unknown>,
        output_payload: parsed as unknown as Record<string, unknown> ?? { raw: rawContent },
        tokens_used:    tokensUsed,
        latency_ms:     latencyMs,
        model_used:     'llama-3.1-70b-versatile',
        created_at:     new Date().toISOString(),
      })

    // Write results back to the session row if parse succeeded
    if (parsed) {
      await supabase
        .from('sessions')
        .update({
          groq_session_summary: parsed.summary,
          engagement_score:     parsed.engagement_score,
          churn_risk:           parsed.churn_risk,
          share_propensity:     parsed.share_propensity,
        })
        .eq('id', sessionId)
    }

  } catch (err) {
    console.error('[session/end] Groq error:', err)
    // Silent failure — Groq is enrichment, not core functionality
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: SessionEndRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.session_id !== 'string' || !body.session_id) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
  }

  const {
    session_id,
    session_duration_seconds,
    final_score,
    max_level_reached,
    runs,
  } = body

  const supabase = createServerClient()
  const now      = new Date().toISOString()

  try {
    // ── 1. Close the session row ──────────────────────────────────────────
    const { error: sessionError } = await supabase
      .from('sessions')
      .update({
        ended_at:                 now,
        last_active_at:           now,
        session_duration_seconds: session_duration_seconds ?? null,
        final_score:              final_score              ?? null,
        max_level_reached:        max_level_reached        ?? null,
        runs_json:                runs                     ?? null,
      })
      .eq('id', session_id)

    if (sessionError) {
      console.error('[session/end] Session update error:', sessionError.message)
      // Continue — still try to insert runs
    }

    // ── 2. Bulk-insert runs ───────────────────────────────────────────────
    if (Array.isArray(runs) && runs.length > 0) {
      const runRows = runs.map(r => ({
        session_id,
        run_number:           r.run_number,
        duration_seconds:     r.duration_seconds,
        final_score:          r.final_score,
        max_level_reached:    r.max_level_reached,
        max_city_reached:     r.max_city_reached,
        total_lasers_dodged:  r.total_lasers_dodged,
        total_lives_lost:     r.total_lives_lost,
        end_reason:           r.end_reason,
        ended_at:             now,
        email_captured_this_run: false,   // updated retroactively by /api/email/capture
      }))

      const { error: runsError } = await supabase
        .from('runs')
        .insert(runRows)

      if (runsError) {
        console.error('[session/end] Runs insert error:', runsError.message)
      }
    }

    // ── 3. Fetch session metadata needed for Groq input ───────────────────
    // Fire-and-forget — resolve immediately, queue Groq in background
    const groqApiKey = process.env.GROQ_API_KEY
    if (groqApiKey) {
      // Fetch recent events for this session to build Groq input
      // Non-blocking: we don't await queueGroqSessionSummary
      supabase
        .from('game_events')
        .select('event_type, score, level_number, city_name, share_platform')
        .eq('session_id', session_id)
        .order('occurred_at', { ascending: true })
        .limit(200)
        .then(({ data: events }) => {
          // Fetch session share/email flags
          return supabase
            .from('sessions')
            .select('email, shared_tiktok, shared_x, shared_email, shared_link_copied')
            .eq('id', session_id)
            .single()
            .then(({ data: sessionData }) => {
              const shared =
                sessionData?.shared_tiktok   ||
                sessionData?.shared_x        ||
                sessionData?.shared_email    ||
                sessionData?.shared_link_copied ||
                false

              const groqInput: GroqSessionSummaryInput = {
                session_id,
                events:         (events ?? []) as GroqSessionSummaryInput['events'],
                total_runs:     runs?.length ?? 0,
                email_captured: !!sessionData?.email,
                shared:         !!shared,
                final_score:    final_score      ?? 0,
                max_level:      max_level_reached ?? 0,
              }

              queueGroqSessionSummary(session_id, groqInput)
            })
        })
        .catch(err => {
          console.error('[session/end] Groq pre-fetch error:', err)
        })
    }

    const response: SessionEndResponse = {
      ok:               true,
      analysis_queued:  !!groqApiKey,
    }

    return NextResponse.json(response, { status: 200 })

  } catch (err) {
    console.error('[session/end] Unexpected error:', err)
    // Always return 200 — client is fire-and-forget
    return NextResponse.json<SessionEndResponse>(
      { ok: false, analysis_queued: false },
      { status: 200 },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

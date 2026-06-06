// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/intelligence/churn/route.ts
// File 31 of 48
//
// POST /api/intelligence/churn
//
// Mid-session churn prediction. Called by GameShell at defined intervals
// (CHURN_CHECK_INTERVALS_MS: 30s, 60s, 90s) during an active session.
// Sends recent event window to Groq, receives churn_risk + recommended action,
// updates the session row, and optionally triggers an early email prompt.
//
// Responsibilities:
//   1. Validate session_id + events payload
//   2. Call Groq with a churn prediction prompt
//   3. Parse and validate Groq's JSON response
//   4. Update sessions.churn_risk in Supabase
//   5. Log to ai_analysis_log
//   6. Return { churn_risk, action } to the client
//
// Client contract:
//   GameShell receives { churn_risk, action } and acts on action:
//     'none'           → do nothing
//     'show_email_prompt' → show EmailCapture overlay early (before game over)
//     'show_share_prompt' → show ShareBar teaser
//
// Rules:
//   - Groq errors degrade gracefully — return { churn_risk: 'unknown', action: 'none' }
//   - This route is never on the critical path — game must not wait for it
//   - GROQ_API_KEY absence returns 200 with degraded response
//   - session_id accepted as non-empty string (supports local_* fallback)
//   - Events array is capped at 50 — send only the most recent window
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createServerClient } from '@/lib/supabase/server'
import type { GameEventPayload } from '@/lib/game/types'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type ChurnRisk   = 'low' | 'medium' | 'high' | 'unknown'
type ChurnAction = 'none' | 'show_email_prompt' | 'show_share_prompt'

interface ChurnRequest {
  session_id:      string
  events:          GameEventPayload[]
  current_score:   number
  current_level:   number
  lives_remaining: number
  elapsed_seconds: number
  run_number:      number
}

interface ChurnResponse {
  churn_risk:  ChurnRisk
  action:      ChurnAction
  reasoning?:  string   // dev-mode only — not shown to user
}

interface GroqChurnOutput {
  churn_risk:    ChurnRisk
  action:        ChurnAction
  reasoning:     string
  confidence:    number
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ CHURN PROMPT
// ─────────────────────────────────────────────────────────────────────────────

function buildChurnPrompt(body: ChurnRequest): string {
  const eventSummary = body.events.reduce((acc: Record<string, number>, e) => {
    acc[e.event_type] = (acc[e.event_type] ?? 0) + 1
    return acc
  }, {})

  const recentEvents = body.events
    .slice(-10)
    .map(e => e.event_type)
    .join(', ')

  return `
You are a real-time churn prediction engine for a browser arcade game called Palm Galaxy.
The player dodges lasers across neon cities. Analyze this mid-session snapshot and predict churn risk.

Current session snapshot:
- Score: ${body.current_score}
- Level: ${body.current_level + 1} (city: ${['Miami','Tokyo','NYC','Dubai','Ibiza'][body.current_level] ?? 'Miami'})
- Lives remaining: ${body.lives_remaining} / 3
- Session elapsed: ${body.elapsed_seconds}s
- Run number: ${body.run_number} (how many times they've played this session)
- Total events so far: ${body.events.length}
- Event breakdown: ${JSON.stringify(eventSummary)}
- Most recent 10 events: ${recentEvents}

Churn signals to consider:
- Repeated deaths with no improvement = high churn
- Rapid retry pattern after death = engaged (low churn)
- Low score + long elapsed time = disengaged
- Multiple runs (run_number > 2) = retained
- Pause events without resume = possible abandonment

Return ONLY valid JSON matching this exact structure (no markdown, no preamble):
{
  "churn_risk": "low" | "medium" | "high",
  "action": "none" | "show_email_prompt" | "show_share_prompt",
  "reasoning": "<one sentence explaining the prediction>",
  "confidence": <number 0.0–1.0>
}

Action guidelines:
- show_email_prompt: only if churn_risk is "high" AND no email has been captured yet (elapsed > 45s)
- show_share_prompt: only if churn_risk is "low" AND score is impressive (level >= 2)
- none: all other cases
`.trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: ChurnRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  // ── Validate ───────────────────────────────────────────────────────────────
  if (typeof body.session_id !== 'string' || !body.session_id) {
    return NextResponse.json(
      { error: 'session_id is required' },
      { status: 400 },
    )
  }

  if (!Array.isArray(body.events)) {
    return NextResponse.json(
      { error: 'events must be an array' },
      { status: 400 },
    )
  }

  // Cap events at 50 most recent — Groq context window is not infinite
  const cappedBody: ChurnRequest = {
    ...body,
    events: body.events.slice(-50),
  }

  // ── Degrade gracefully if Groq not configured ─────────────────────────────
  const groqApiKey = process.env.GROQ_API_KEY
  if (!groqApiKey) {
    const degraded: ChurnResponse = { churn_risk: 'unknown', action: 'none' }
    return NextResponse.json(degraded, { status: 200 })
  }

  const supabase = createServerClient()
  const startMs  = Date.now()

  try {
    const groq   = new Groq({ apiKey: groqApiKey })
    const prompt = buildChurnPrompt(cappedBody)

    const completion = await groq.chat.completions.create({
      model:       'llama-3.1-70b-versatile',
      max_tokens:  200,
      temperature: 0.2,   // Low temperature — we want consistent classification
      messages: [
        { role: 'user', content: prompt },
      ],
    })

    const latencyMs  = Date.now() - startMs
    const rawContent = completion.choices[0]?.message?.content ?? ''
    const tokensUsed = completion.usage?.total_tokens ?? 0

    // ── Parse Groq output ──────────────────────────────────────────────────
    let parsed: GroqChurnOutput | null = null
    try {
      const clean = rawContent.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      console.error('[intelligence/churn] Groq parse failed:', rawContent)
    }

    // ── Validate parsed output ────────────────────────────────────────────
    const VALID_RISKS:   ChurnRisk[]   = ['low', 'medium', 'high']
    const VALID_ACTIONS: ChurnAction[] = ['none', 'show_email_prompt', 'show_share_prompt']

    const churnRisk: ChurnRisk   = VALID_RISKS.includes(parsed?.churn_risk   as ChurnRisk)
      ? parsed!.churn_risk
      : 'unknown'
    const action: ChurnAction    = VALID_ACTIONS.includes(parsed?.action as ChurnAction)
      ? parsed!.action
      : 'none'

    // ── Log to ai_analysis_log (fire-and-forget) ─────────────────────────
    supabase
      .from('ai_analysis_log')
      .insert({
        session_id:     body.session_id,
        analysis_type:  'churn_prediction',
        input_payload:  {
          score:           body.current_score,
          level:           body.current_level,
          lives:           body.lives_remaining,
          elapsed_seconds: body.elapsed_seconds,
          run_number:      body.run_number,
          event_count:     body.events.length,
        } as unknown as Record<string, unknown>,
        output_payload: parsed as unknown as Record<string, unknown> ?? { raw: rawContent },
        tokens_used:    tokensUsed,
        latency_ms:     latencyMs,
        model_used:     'llama-3.1-70b-versatile',
        created_at:     new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) console.error('[intelligence/churn] ai_analysis_log insert error:', error.message)
      })

    // ── Update session churn_risk (fire-and-forget) ───────────────────────
    if (churnRisk !== 'unknown') {
      supabase
        .from('sessions')
        .update({
          churn_risk:     churnRisk,
          last_active_at: new Date().toISOString(),
        })
        .eq('id', body.session_id)
        .then(({ error }) => {
          if (error) console.error('[intelligence/churn] session update error:', error.message)
        })
    }

    // ── Return result to client ───────────────────────────────────────────
    const response: ChurnResponse = {
      churn_risk: churnRisk,
      action,
      // Include reasoning in dev mode only — never shown to player
      ...(process.env.NODE_ENV === 'development' && parsed?.reasoning
        ? { reasoning: parsed.reasoning }
        : {}),
    }

    return NextResponse.json(response, { status: 200 })

  } catch (err) {
    console.error('[intelligence/churn] Groq error:', err)

    // Graceful degradation — never fail the client
    const fallback: ChurnResponse = { churn_risk: 'unknown', action: 'none' }
    return NextResponse.json(fallback, { status: 200 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

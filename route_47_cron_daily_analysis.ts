// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — app/api/cron/daily-analysis/route.ts
// File 47 of 48
//
// GET /api/cron/daily-analysis
//
// Vercel Cron job — runs daily at 03:00 UTC (schedule in vercel.json).
// Orchestrates the full daily intelligence pipeline:
//
//   Step 1 — Pull last 24h cohort stats from sessions table
//   Step 2 — Pull city death counts from game_events
//   Step 3 — Run Groq cohort analysis (llama-3.3-70b-versatile)
//   Step 4 — Call /api/intelligence/batch internally
//   Step 5 — Send ZYVV bridge emails for eligible sessions
//   Step 6 — Log everything to ai_analysis_log
//
// Auth: Authorization: Bearer CRON_SECRET
// Always returns 200 — Vercel must not retry a best-effort analytics job.
// Runtime: edge
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { Resend }                    from 'resend'
import { render }                    from '@react-email/render'
import { ZyvvBridge }                from '@/emails/ZyvvBridge'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const APP_NAME  = process.env.NEXT_PUBLIC_APP_NAME ?? 'Palm Lazer'
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL  ?? 'https://palmlazer.com'
const ZYVV_URL  = process.env.ZYVV_APP_URL         ?? 'https://zyvv.app'
const FROM_EMAIL= process.env.RESEND_FROM_EMAIL    ?? 'play@palmlazer.com'
const CITIES    = ['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza'] as const

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface CohortStats {
  total_sessions:     number
  avg_duration:       number
  email_rate:         number
  share_rate:         number
  city_deaths:        Record<string, number>
}

interface GroqCohortOutput {
  cohort_summary:      string
  key_insight:         string
  recommended_action:  string
  retention_forecast:  'declining' | 'stable' | 'growing'
}

interface ZyvvCandidate {
  id:                string
  email:             string
  final_score:       number | null
  max_level_reached: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[cron/daily-analysis] Supabase env vars missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

function cityFromLevel(level: number): string {
  return CITIES[Math.min(level, CITIES.length - 1)] ?? 'Miami'
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  // Vercel Cron sets this header automatically — always trust it
  if (req.headers.get('x-vercel-cron') === '1') return true

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const authHeader = req.headers.get('authorization') ?? ''
  const token      = authHeader.replace(/^Bearer\s+/i, '').trim()
  return token === cronSecret
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ COHORT PROMPT
// Direct fetch — no SDK — edge compatible
// ─────────────────────────────────────────────────────────────────────────────

async function runGroqCohortAnalysis(
  stats:     CohortStats,
  dateLabel: string,
): Promise<GroqCohortOutput | null> {
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) {
    console.warn('[cron/daily-analysis] GROQ_API_KEY not set — skipping Groq')
    return null
  }

  const topCity = Object.entries(stats.city_deaths)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Miami'

  const prompt = `
You are a growth analytics engine for Palm Lazer, a retro browser arcade game.
Analyze today's player cohort and return strategic insights.

Date: ${dateLabel}
Total sessions: ${stats.total_sessions}
Avg session duration: ${Math.round(stats.avg_duration)}s
Email capture rate: ${(stats.email_rate * 100).toFixed(1)}%
Share rate: ${(stats.share_rate * 100).toFixed(1)}%
City death counts (where players died most): ${JSON.stringify(stats.city_deaths)}
Most lethal city today: ${topCity}

Return ONLY valid JSON — no markdown, no preamble:
{
  "cohort_summary": "<2-3 sentence summary of today's player cohort behavior>",
  "key_insight": "<single most actionable insight from today's data>",
  "recommended_action": "<one concrete product or marketing action to take>",
  "retention_forecast": "declining" | "stable" | "growing"
}
`.trim()

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        max_tokens:  300,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.error('[cron/daily-analysis] Groq HTTP error:', res.status)
      return null
    }

    const data = await res.json()
    const raw  = data?.choices?.[0]?.message?.content ?? ''
    const clean = raw.replace(/```json|```/g, '').trim()
    return JSON.parse(clean) as GroqCohortOutput

  } catch (err) {
    console.error('[cron/daily-analysis] Groq error:', err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ───────────────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dateLabel  = new Date().toISOString().slice(0, 10)
  const sinceDate  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const supabase   = getSupabase()
  const errors:    string[] = []

  let sessionsProcessed = 0
  let groqSummary:       GroqCohortOutput | null = null
  let zyvvSent           = 0

  // ── Step 1: Pull last 24h cohort stats ────────────────────────────────────
  let cohortStats: CohortStats = {
    total_sessions: 0,
    avg_duration:   0,
    email_rate:     0,
    share_rate:     0,
    city_deaths:    {},
  }

  try {
    const { data: sessions, error: sessionError } = await supabase
      .from('sessions')
      .select([
        'id',
        'session_duration_seconds',
        'email',
        'shared_tiktok',
        'shared_x',
        'shared_email',
        'shared_link_copied',
      ].join(','))
      .gte('started_at', sinceDate)
      .eq('product_source', 'palm_lazer')
      .limit(1000)

    if (sessionError) {
      errors.push(`sessions fetch: ${sessionError.message}`)
    } else {
      const rows = sessions ?? []
      sessionsProcessed = rows.length
      const n = rows.length || 1

      const totalDuration = rows.reduce(
        (s: number, r: { session_duration_seconds: number | null }) =>
          s + (r.session_duration_seconds ?? 0), 0
      )
      const emailCount = rows.filter((r: { email: string | null }) => !!r.email).length
      const shareCount = rows.filter((r: {
        shared_tiktok: boolean
        shared_x: boolean
        shared_email: boolean
        shared_link_copied: boolean
      }) =>
        r.shared_tiktok || r.shared_x || r.shared_email || r.shared_link_copied
      ).length

      cohortStats = {
        total_sessions: rows.length,
        avg_duration:   totalDuration / n,
        email_rate:     emailCount / n,
        share_rate:     shareCount / n,
        city_deaths:    {},   // populated in Step 2
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`sessions exception: ${msg}`)
  }

  // ── Step 2: Pull city death counts from game_events ───────────────────────
  try {
    const { data: deathEvents, error: deathError } = await supabase
      .from('game_events')
      .select('city_name')
      .eq('event_type', 'game_over')
      .gte('occurred_at', sinceDate)
      .limit(5000)

    if (deathError) {
      errors.push(`game_events fetch: ${deathError.message}`)
    } else {
      const cityDeaths: Record<string, number> = {}
      ;(deathEvents ?? []).forEach((e: { city_name: string | null }) => {
        const city = e.city_name ?? 'Unknown'
        cityDeaths[city] = (cityDeaths[city] ?? 0) + 1
      })
      cohortStats.city_deaths = cityDeaths
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`game_events exception: ${msg}`)
  }

  // ── Step 3: Groq cohort analysis ──────────────────────────────────────────
  if (cohortStats.total_sessions > 0) {
    try {
      groqSummary = await runGroqCohortAnalysis(cohortStats, dateLabel)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`groq: ${msg}`)
    }
  }

  // ── Step 4: Call /api/intelligence/batch ──────────────────────────────────
  try {
    const pythonSecret = process.env.PYTHON_API_SECRET ?? ''
    const batchRes = await fetch(`${APP_URL}/api/intelligence/batch`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${pythonSecret}`,
      },
      body: JSON.stringify({}),
    })

    if (!batchRes.ok) {
      errors.push(`intelligence/batch returned ${batchRes.status}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`intelligence/batch: ${msg}`)
  }

  // ── Step 5: Send ZYVV bridge emails ───────────────────────────────────────
  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    try {
      // Query eligible sessions: email captured, level >= 3, bridge not yet sent
      const { data: candidates, error: candidateError } = await supabase
        .from('sessions')
        .select('id, email, final_score, max_level_reached')
        .eq('product_source', 'palm_lazer')
        .eq('zyvv_bridge_sent', false)
        .not('email', 'is', null)
        .gte('max_level_reached', 3)
        .limit(100)

      if (candidateError) {
        errors.push(`zyvv candidates fetch: ${candidateError.message}`)
      } else {
        const resend = new Resend(resendKey)
        const eligible = (candidates ?? []) as ZyvvCandidate[]

        for (const candidate of eligible) {
          try {
            const level = candidate.max_level_reached ?? 3
            const city  = cityFromLevel(level)

            const html = await render(
              ZyvvBridge({
                score:     candidate.final_score ?? 0,
                level,
                city,
                zyvvUrl:   ZYVV_URL,
                appUrl:    APP_URL,
                appName:   APP_NAME,
                sessionId: candidate.id,
              })
            )

            const { error: sendError } = await resend.emails.send({
              from:    `${APP_NAME} <${FROM_EMAIL}>`,
              to:      [candidate.email],
              subject: `You qualified for something else ⚡`,
              html,
              tags: [
                { name: 'product',    value: 'palm_lazer'  },
                { name: 'email_type', value: 'zyvv_bridge' },
                { name: 'session_id', value: candidate.id  },
              ],
            })

            if (sendError) {
              console.error('[cron/daily-analysis] ZyvvBridge send error:', sendError)
              continue
            }

            // Mark bridge sent
            await supabase
              .from('sessions')
              .update({
                zyvv_bridge_sent:    true,
                zyvv_bridge_sent_at: new Date().toISOString(),
              })
              .eq('id', candidate.id)

            zyvvSent++

          } catch (err) {
            console.error('[cron/daily-analysis] ZyvvBridge loop error:', err)
            // Continue to next candidate — never abort the loop
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`zyvv bridge: ${msg}`)
    }
  }

  // ── Step 6: Log to ai_analysis_log ────────────────────────────────────────
  try {
    await supabase
      .from('ai_analysis_log')
      .insert({
        session_id:     null,
        analysis_type:  'cohort_daily',
        input_payload:  {
          date:          dateLabel,
          since:         sinceDate,
          cohort_stats:  cohortStats,
        },
        output_payload: {
          groq_summary:       groqSummary,
          zyvv_sent:          zyvvSent,
          sessions_processed: sessionsProcessed,
          errors,
        },
        tokens_used:    0,
        latency_ms:     0,
        model_used:     'llama-3.3-70b-versatile',
        created_at:     new Date().toISOString(),
      })
  } catch (err) {
    console.error('[cron/daily-analysis] ai_analysis_log insert error:', err)
    // Non-fatal
  }

  // ── Always return 200 ─────────────────────────────────────────────────────
  return NextResponse.json(
    {
      ok:                 true,
      date:               dateLabel,
      sessions_processed: sessionsProcessed,
      groq_summary:       groqSummary,
      zyvv_sent:          zyvvSent,
      errors,
    },
    { status: 200 },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

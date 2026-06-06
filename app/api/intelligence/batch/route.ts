// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/intelligence/batch/route.ts
// File 32 of 48
//
// POST /api/intelligence/batch
//
// Proxies a batch of session data to the Python FastAPI intelligence stub
// at PYTHON_INTELLIGENCE_URL, returns aggregated stats back to the caller.
//
// Called by:
//   - app/api/cron/daily-analysis/route.ts (Vercel Cron, 03:00 UTC)
//   - Manual POST from admin tooling
//
// Responsibilities:
//   1. Validate the request (CRON_SECRET bearer token)
//   2. Pull the last N sessions from Supabase (default: last 24h)
//   3. POST the batch to the Python /analyse/daily-batch endpoint
//   4. Store aggregated results back onto ai_analysis_log
//   5. Return { ok, stats } to the caller
//
// Python stub contract (python/main.py):
//   POST /analyse/daily-batch
//   Body: { sessions: SessionSummary[], date: string }
//   Returns: { total_sessions, avg_score, avg_level, churn_rate,
//              share_rate, email_capture_rate, top_city, cohort_label }
//
// Rules:
//   - PYTHON_INTELLIGENCE_URL absence degrades gracefully (returns local stats)
//   - Python timeout is 25s — Vercel function maxDuration is 30s
//   - Auth: CRON_SECRET in Authorization header (same secret as cron route)
//   - Never exposes raw PII — session rows are scrubbed before sending
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface SessionSummary {
  session_id:               string
  device_type:              string | null
  country:                  string | null
  final_score:              number | null
  max_level_reached:        number | null
  session_duration_seconds: number | null
  run_count:                number
  email_captured:           boolean
  shared:                   boolean
  churn_risk:               string | null
  share_propensity:         string | null
  engagement_score:         number | null
  utm_source:               string | null
  started_at:               string
}

interface PythonBatchResponse {
  total_sessions:      number
  avg_score:           number
  avg_level:           number
  churn_rate:          number
  share_rate:          number
  email_capture_rate:  number
  top_city:            string
  cohort_label:        string
  insight_summary?:    string
}

interface BatchResponse {
  ok:             boolean
  stats:          PythonBatchResponse | LocalStats
  python_used:    boolean
  sessions_sent:  number
  date:           string
  error?:         string
}

interface LocalStats {
  total_sessions:     number
  avg_score:          number
  avg_level:          number
  email_capture_rate: number
  share_rate:         number
  churn_rate:         number
  top_city:           string
  cohort_label:       string
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true   // No secret configured — allow in dev

  const authHeader = req.headers.get('authorization') ?? ''
  const token      = authHeader.replace(/^Bearer\s+/i, '').trim()
  return token === cronSecret
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL STATS FALLBACK
// Computes basic aggregates in-process when Python is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

function computeLocalStats(sessions: SessionSummary[]): LocalStats {
  if (sessions.length === 0) {
    return {
      total_sessions:     0,
      avg_score:          0,
      avg_level:          0,
      email_capture_rate: 0,
      share_rate:         0,
      churn_rate:         0,
      top_city:           'Miami',
      cohort_label:       'no_data',
    }
  }

  const n = sessions.length

  const avgScore = sessions.reduce((s, r) => s + (r.final_score ?? 0), 0) / n
  const avgLevel = sessions.reduce((s, r) => s + (r.max_level_reached ?? 0), 0) / n

  const emailRate = sessions.filter(r => r.email_captured).length / n
  const shareRate = sessions.filter(r => r.shared).length / n
  const churnRate = sessions.filter(r => r.churn_risk === 'high').length / n

  // Top city: derive from max_level_reached (level → city name)
  const CITY_NAMES = ['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza']
  const cityCounts: Record<string, number> = {}
  sessions.forEach(r => {
    const city = CITY_NAMES[Math.min(r.max_level_reached ?? 0, 4)] ?? 'Miami'
    cityCounts[city] = (cityCounts[city] ?? 0) + 1
  })
  const topCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Miami'

  // Simple cohort label based on engagement mix
  let cohortLabel = 'standard'
  if (emailRate > 0.3 && shareRate > 0.1) cohortLabel = 'high_value'
  else if (churnRate > 0.5)               cohortLabel = 'high_churn'
  else if (avgLevel >= 3)                 cohortLabel = 'power_players'
  else if (n < 10)                        cohortLabel = 'early_data'

  return {
    total_sessions:     n,
    avg_score:          Math.round(avgScore),
    avg_level:          Math.round(avgLevel * 10) / 10,
    email_capture_rate: Math.round(emailRate * 1000) / 1000,
    share_rate:         Math.round(shareRate * 1000) / 1000,
    churn_rate:         Math.round(churnRate * 1000) / 1000,
    top_city:           topCity,
    cohort_label:       cohortLabel,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRUB SESSION ROW — remove PII before sending to Python
// ─────────────────────────────────────────────────────────────────────────────

function scrubSession(row: Record<string, unknown>): SessionSummary {
  return {
    session_id:               row.id               as string,
    device_type:              (row.device_type      as string | null) ?? null,
    country:                  (row.country          as string | null) ?? null,
    final_score:              (row.final_score      as number | null) ?? null,
    max_level_reached:        (row.max_level_reached as number | null) ?? null,
    session_duration_seconds: (row.session_duration_seconds as number | null) ?? null,
    run_count:                Array.isArray(row.runs_json)
                                ? (row.runs_json as unknown[]).length
                                : 0,
    email_captured:           !!(row.email),
    shared:                   !!(row.shared_tiktok || row.shared_x || row.shared_email || row.shared_link_copied),
    churn_risk:               (row.churn_risk        as string | null) ?? null,
    share_propensity:         (row.share_propensity  as string | null) ?? null,
    engagement_score:         (row.engagement_score  as number | null) ?? null,
    utm_source:               (row.utm_source        as string | null) ?? null,
    started_at:               row.started_at         as string,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ───────────────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse optional body params ─────────────────────────────────────────────
  let lookbackHours = 24
  let dateLabel     = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD

  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body.lookback_hours === 'number') lookbackHours = body.lookback_hours
    if (typeof body.date           === 'string') dateLabel     = body.date
  } catch {
    // Body is optional — proceed with defaults
  }

  const supabase  = createServerClient()
  const sinceDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString()

  // ── Pull sessions from Supabase ────────────────────────────────────────────
  let rawSessions: Record<string, unknown>[] = []
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select([
        'id',
        'device_type',
        'country',
        'final_score',
        'max_level_reached',
        'session_duration_seconds',
        'runs_json',
        'email',
        'shared_tiktok',
        'shared_x',
        'shared_email',
        'shared_link_copied',
        'churn_risk',
        'share_propensity',
        'engagement_score',
        'utm_source',
        'started_at',
      ].join(','))
      .gte('started_at', sinceDate)
      .order('started_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('[intelligence/batch] Supabase select error:', error.message)
      return NextResponse.json<BatchResponse>(
        { ok: false, stats: computeLocalStats([]), python_used: false, sessions_sent: 0, date: dateLabel, error: error.message },
        { status: 500 },
      )
    }

    rawSessions = (data ?? []) as Record<string, unknown>[]
  } catch (err) {
    console.error('[intelligence/batch] Supabase fetch error:', err)
    return NextResponse.json<BatchResponse>(
      { ok: false, stats: computeLocalStats([]), python_used: false, sessions_sent: 0, date: dateLabel, error: 'DB fetch failed' },
      { status: 500 },
    )
  }

  const sessions = rawSessions.map(scrubSession)

  // ── Attempt Python batch ───────────────────────────────────────────────────
  const pythonUrl = process.env.PYTHON_INTELLIGENCE_URL
  let stats:       PythonBatchResponse | LocalStats
  let pythonUsed = false

  if (pythonUrl) {
    try {
      const controller = new AbortController()
      const timeout    = setTimeout(() => controller.abort(), 25_000)

      const res = await fetch(`${pythonUrl}/analyse/daily-batch`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessions, date: dateLabel }),
        signal:  controller.signal,
      })

      clearTimeout(timeout)

      if (res.ok) {
        stats      = await res.json() as PythonBatchResponse
        pythonUsed = true
      } else {
        console.warn('[intelligence/batch] Python returned non-OK:', res.status)
        stats = computeLocalStats(sessions)
      }
    } catch (err) {
      console.warn('[intelligence/batch] Python fetch failed, using local stats:', err)
      stats = computeLocalStats(sessions)
    }
  } else {
    stats = computeLocalStats(sessions)
  }

  // ── Persist results to ai_analysis_log ────────────────────────────────────
  supabase
    .from('ai_analysis_log')
    .insert({
      session_id:     null,
      analysis_type:  'daily_batch',
      input_payload:  { sessions_count: sessions.length, date: dateLabel, lookback_hours: lookbackHours } as unknown as Record<string, unknown>,
      output_payload: stats as unknown as Record<string, unknown>,
      tokens_used:    0,
      latency_ms:     0,
      model_used:     pythonUsed ? 'python_fastapi' : 'local_aggregation',
      created_at:     new Date().toISOString(),
    })
    .then(({ error }) => {
      if (error) console.error('[intelligence/batch] ai_analysis_log insert error:', error.message)
    })

  // ── Return ─────────────────────────────────────────────────────────────────
  const response: BatchResponse = {
    ok:            true,
    stats,
    python_used:   pythonUsed,
    sessions_sent: sessions.length,
    date:          dateLabel,
  }

  return NextResponse.json(response, { status: 200 })
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

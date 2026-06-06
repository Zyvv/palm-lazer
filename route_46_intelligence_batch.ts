// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — app/api/intelligence/batch/route.ts
// File 46 of 48
//
// POST /api/intelligence/batch
//
// Pulls sessions from last 24h where groq_session_summary IS NULL,
// POSTs each to Python /analyze, falls back to local JS aggregation
// if Python is unreachable. Logs result to ai_analysis_log.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CITIES = ['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza'] as const

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface SessionRow {
  id:                       string
  final_score:              number | null
  max_level_reached:        number | null
  session_duration_seconds: number | null
  email:                    string | null
  shared_tiktok:            boolean
  shared_x:                 boolean
  shared_email:             boolean
  shared_link_copied:       boolean
  churn_risk:               string | null
  engagement_score:         number | null
  device_type:              string | null
  country:                  string | null
  utm_source:               string | null
  started_at:               string
}

interface SessionSummary {
  session_id:        string
  duration_seconds:  number | null
  final_score:       number | null
  max_level_reached: number | null
  email_captured:    boolean
  shared:            boolean
}

interface PythonAnalyzeResponse {
  date:                 string
  total_sessions:       number
  avg_score:            number
  avg_level:            number
  churn_distribution:   { low: number; medium: number; high: number }
  share_rate:           number
  email_capture_rate:   number
  top_city:             string
  note:                 string
}

interface BatchSummary {
  date:               string
  total_sessions:     number
  avg_score:          number
  avg_level:          number
  email_capture_rate: number
  share_rate:         number
  python_used:        boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[intelligence/batch] Supabase env vars missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

function cityFromLevel(level: number): string {
  return CITIES[Math.min(level, CITIES.length - 1)] ?? 'Miami'
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL JS FALLBACK AGGREGATION
// Used when Python service is unreachable or returns non-2xx.
// ─────────────────────────────────────────────────────────────────────────────

function localAggregate(sessions: SessionRow[]): Omit<BatchSummary, 'date' | 'python_used'> {
  const n = sessions.length

  if (n === 0) {
    return {
      total_sessions:     0,
      avg_score:          0,
      avg_level:          0,
      email_capture_rate: 0,
      share_rate:         0,
    }
  }

  const avgScore = sessions.reduce((s, r) => s + (r.final_score ?? 0), 0) / n
  const avgLevel = sessions.reduce((s, r) => s + (r.max_level_reached ?? 0), 0) / n

  const emailCount = sessions.filter(r => !!r.email).length
  const shareCount = sessions.filter(r =>
    r.shared_tiktok || r.shared_x || r.shared_email || r.shared_link_copied
  ).length

  return {
    total_sessions:     n,
    avg_score:          Math.round(avgScore),
    avg_level:          Math.round(avgLevel * 10) / 10,
    email_capture_rate: Math.round((emailCount / n) * 1000) / 1000,
    share_rate:         Math.round((shareCount / n) * 1000) / 1000,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const pythonSecret = process.env.PYTHON_API_SECRET
  if (!pythonSecret) {
    console.error('[intelligence/batch] PYTHON_API_SECRET not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const token      = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (token !== pythonSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Setup ──────────────────────────────────────────────────────────────────
  const supabase  = getSupabase()
  const dateLabel = new Date().toISOString().slice(0, 10)
  const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // ── Pull sessions: last 24h, groq_session_summary IS NULL ─────────────────
  const { data: rawRows, error: fetchError } = await supabase
    .from('sessions')
    .select([
      'id',
      'final_score',
      'max_level_reached',
      'session_duration_seconds',
      'email',
      'shared_tiktok',
      'shared_x',
      'shared_email',
      'shared_link_copied',
      'churn_risk',
      'engagement_score',
      'device_type',
      'country',
      'utm_source',
      'started_at',
    ].join(','))
    .gte('started_at', sinceDate)
    .is('groq_session_summary', null)
    .eq('product_source', 'palm_lazer')
    .order('started_at', { ascending: false })
    .limit(500)

  if (fetchError) {
    console.error('[intelligence/batch] Supabase fetch error:', fetchError.message)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const sessions = (rawRows ?? []) as SessionRow[]

  // ── Build scrubbed payload for Python (no raw PII) ─────────────────────────
  const summaries: SessionSummary[] = sessions.map(r => ({
    session_id:        r.id,
    duration_seconds:  r.session_duration_seconds ?? null,
    final_score:       r.final_score              ?? null,
    max_level_reached: r.max_level_reached        ?? null,
    email_captured:    !!r.email,
    shared:            !!(r.shared_tiktok || r.shared_x || r.shared_email || r.shared_link_copied),
  }))

  // ── Attempt Python /analyze ────────────────────────────────────────────────
  const pythonUrl = process.env.PYTHON_API_URL
  let   summary:    BatchSummary
  let   pythonUsed  = false
  let   pythonOutput: PythonAnalyzeResponse | null = null

  if (pythonUrl && summaries.length > 0) {
    try {
      const controller = new AbortController()
      const timeoutId  = setTimeout(() => controller.abort(), 20_000)

      const res = await fetch(`${pythonUrl}/analyze`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'x-api-secret':  pythonSecret,
        },
        body:    JSON.stringify({ sessions: summaries }),
        signal:  controller.signal,
      })

      clearTimeout(timeoutId)

      if (res.ok) {
        pythonOutput = await res.json() as PythonAnalyzeResponse
        pythonUsed   = true
        summary = {
          date:               dateLabel,
          total_sessions:     pythonOutput.total_sessions,
          avg_score:          pythonOutput.avg_score,
          avg_level:          pythonOutput.avg_level,
          email_capture_rate: pythonOutput.email_capture_rate,
          share_rate:         pythonOutput.share_rate,
          python_used:        true,
        }
      } else {
        console.warn('[intelligence/batch] Python returned non-2xx:', res.status)
        summary = { date: dateLabel, python_used: false, ...localAggregate(sessions) }
      }
    } catch (err) {
      console.warn('[intelligence/batch] Python unreachable, using local fallback:', err)
      summary = { date: dateLabel, python_used: false, ...localAggregate(sessions) }
    }
  } else {
    summary = { date: dateLabel, python_used: false, ...localAggregate(sessions) }
  }

  // ── Log to ai_analysis_log ─────────────────────────────────────────────────
  const logPayload = {
    session_id:     null,
    analysis_type:  'cohort_pattern',
    input_payload:  {
      date:             dateLabel,
      sessions_count:   sessions.length,
      python_used:      pythonUsed,
      since:            sinceDate,
    },
    output_payload: pythonOutput
      ? (pythonOutput as unknown as Record<string, unknown>)
      : (summary     as unknown as Record<string, unknown>),
    tokens_used:    0,
    latency_ms:     0,
    model_used:     pythonUsed ? 'python_fastapi' : 'local_js_aggregation',
    created_at:     new Date().toISOString(),
  }

  const { error: logError } = await supabase
    .from('ai_analysis_log')
    .insert(logPayload)

  if (logError) {
    console.error('[intelligence/batch] ai_analysis_log insert error:', logError.message)
    // Non-fatal — continue
  }

  return NextResponse.json(summary, { status: 200 })
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

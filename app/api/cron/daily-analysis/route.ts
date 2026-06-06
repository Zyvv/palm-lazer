// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/cron/daily-analysis/route.ts
// File 33 of 48
//
// GET /api/cron/daily-analysis
//
// Vercel Cron job — runs daily at 03:00 UTC (schedule in vercel.json).
// Orchestrates the full daily intelligence pipeline:
//
//   Step 1 — Pull last 24h sessions from Supabase
//   Step 2 — Run Groq cohort analysis on the session batch
//   Step 3 — POST batch to /api/intelligence/batch (→ Python stub)
//   Step 4 — Write cohort summary back to ai_analysis_log
//   Step 5 — Return { ok, summary } (Vercel logs this response)
//
// Auth:
//   Vercel Cron sends Authorization: Bearer <CRON_SECRET> automatically.
//   We verify it. If CRON_SECRET is not set, the route rejects all requests
//   except those originating from Vercel's cron infrastructure
//   (x-vercel-cron: 1 header, trusted at the edge).
//
// Rules:
//   - maxDuration: 300s (set in vercel.json) — long enough for Groq + Python
//   - All steps are wrapped in try/catch — partial failure must not abort the job
//   - Groq cohort analysis is skipped gracefully if GROQ_API_KEY is absent
//   - Returns 200 even on partial failure so Vercel doesn't retry aggressively
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createServerClient } from '@/lib/supabase/server'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface CohortSummaryRow {
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
  run_count:                number
}

interface GroqCohortOutput {
  cohort_summary:      string
  key_insight:         string
  recommended_action:  string
  share_propensity:    'low' | 'medium' | 'high'
  retention_forecast:  'declining' | 'stable' | 'growing'
}

interface DailyAnalysisResult {
  ok:                  boolean
  date:                string
  sessions_analyzed:   number
  groq_cohort_done:    boolean
  batch_done:          boolean
  cohort_summary?:     string
  key_insight?:        string
  recommended_action?: string
  errors:              string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  // Vercel Cron infrastructure sets this header — trust it
  if (req.headers.get('x-vercel-cron') === '1') return true

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    // No secret configured — reject unless from Vercel cron
    console.warn('[cron/daily-analysis] CRON_SECRET not set — rejecting non-cron request')
    return false
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const token      = authHeader.replace(/^Bearer\s+/i, '').trim()
  return token === cronSecret
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ COHORT PROMPT
// ─────────────────────────────────────────────────────────────────────────────

function buildCohortPrompt(
  sessions:    CohortSummaryRow[],
  dateLabel:   string,
  localStats:  Record<string, unknown>,
): string {
  const n           = sessions.length
  const emailRate   = sessions.filter(s => s.email).length / Math.max(n, 1)
  const shareRate   = sessions.filter(s =>
    s.shared_tiktok || s.shared_x || s.shared_email || s.shared_link_copied,
  ).length / Math.max(n, 1)
  const highChurn   = sessions.filter(s => s.churn_risk === 'high').length
  const avgScore    = sessions.reduce((a, s) => a + (s.final_score ?? 0), 0) / Math.max(n, 1)
  const avgLevel    = sessions.reduce((a, s) => a + (s.max_level_reached ?? 0), 0) / Math.max(n, 1)

  const deviceBreakdown = sessions.reduce((acc: Record<string, number>, s) => {
    const d = s.device_type ?? 'unknown'
    acc[d] = (acc[d] ?? 0) + 1
    return acc
  }, {})

  const utmBreakdown = sessions.reduce((acc: Record<string, number>, s) => {
    const u = s.utm_source ?? 'direct'
    acc[u] = (acc[u] ?? 0) + 1
    return acc
  }, {})

  return `
You are a growth analytics engine for Palm Galaxy, a browser arcade game.
Analyze this daily cohort of sessions and return strategic insights.

Date: ${dateLabel}
Total sessions: ${n}
Average score: ${Math.round(avgScore)}
Average level reached: ${Math.round(avgLevel * 10) / 10}
Email capture rate: ${(emailRate * 100).toFixed(1)}%
Share rate: ${(shareRate * 100).toFixed(1)}%
High churn sessions: ${highChurn} (${n > 0 ? ((highChurn / n) * 100).toFixed(1) : 0}%)
Device breakdown: ${JSON.stringify(deviceBreakdown)}
UTM / acquisition sources: ${JSON.stringify(utmBreakdown)}
Additional stats: ${JSON.stringify(localStats)}

Return ONLY valid JSON matching this exact structure (no markdown, no preamble):
{
  "cohort_summary": "<2-3 sentence summary of today's player cohort behavior>",
  "key_insight": "<single most actionable insight from today's data>",
  "recommended_action": "<one concrete product or marketing action to take based on this data>",
  "share_propensity": "low" | "medium" | "high",
  "retention_forecast": "declining" | "stable" | "growing"
}
`.trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ───────────────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dateLabel = new Date().toISOString().slice(0, 10)
  const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const errors:   string[] = []

  const result: DailyAnalysisResult = {
    ok:                true,
    date:              dateLabel,
    sessions_analyzed: 0,
    groq_cohort_done:  false,
    batch_done:        false,
    errors,
  }

  const supabase = createServerClient()

  // ── Step 1: Pull last 24h sessions ────────────────────────────────────────
  let sessions: CohortSummaryRow[] = []
  try {
    const { data, error } = await supabase
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
        'runs_json',
      ].join(','))
      .gte('started_at', sinceDate)
      .order('started_at', { ascending: false })
      .limit(1000)

    if (error) {
      errors.push(`DB fetch: ${error.message}`)
      console.error('[cron/daily-analysis] DB fetch error:', error.message)
    } else {
      sessions = (data ?? []).map(row => ({
        ...row,
        run_count: Array.isArray(row.runs_json)
          ? (row.runs_json as unknown[]).length
          : 0,
      })) as CohortSummaryRow[]
      result.sessions_analyzed = sessions.length
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`DB fetch exception: ${msg}`)
    console.error('[cron/daily-analysis] DB exception:', err)
  }

  // ── Step 2: Groq cohort analysis ──────────────────────────────────────────
  const groqApiKey = process.env.GROQ_API_KEY
  if (groqApiKey && sessions.length > 0) {
    try {
      const groq      = new Groq({ apiKey: groqApiKey })
      const startMs   = Date.now()

      // Build local stats to enrich the prompt
      const n           = sessions.length
      const localStats  = {
        avg_score:          Math.round(sessions.reduce((a, s) => a + (s.final_score ?? 0), 0) / n),
        email_capture_rate: +(sessions.filter(s => s.email).length / n).toFixed(3),
        share_rate:         +(sessions.filter(s =>
          s.shared_tiktok || s.shared_x || s.shared_email || s.shared_link_copied,
        ).length / n).toFixed(3),
      }

      const prompt = buildCohortPrompt(sessions, dateLabel, localStats)

      const completion = await groq.chat.completions.create({
        model:       'llama-3.1-70b-versatile',
        max_tokens:  400,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      })

      const latencyMs  = Date.now() - startMs
      const rawContent = completion.choices[0]?.message?.content ?? ''
      const tokensUsed = completion.usage?.total_tokens ?? 0

      let parsed: GroqCohortOutput | null = null
      try {
        const clean = rawContent.replace(/```json|```/g, '').trim()
        parsed = JSON.parse(clean)
      } catch {
        errors.push('Groq cohort parse failed')
        console.error('[cron/daily-analysis] Groq parse failed:', rawContent)
      }

      // Log to ai_analysis_log
      await supabase
        .from('ai_analysis_log')
        .insert({
          session_id:     null,
          analysis_type:  'cohort_daily',
          input_payload:  { date: dateLabel, session_count: n, ...localStats } as unknown as Record<string, unknown>,
          output_payload: parsed as unknown as Record<string, unknown> ?? { raw: rawContent },
          tokens_used:    tokensUsed,
          latency_ms:     latencyMs,
          model_used:     'llama-3.1-70b-versatile',
          created_at:     new Date().toISOString(),
        })

      if (parsed) {
        result.groq_cohort_done  = true
        result.cohort_summary    = parsed.cohort_summary
        result.key_insight       = parsed.key_insight
        result.recommended_action = parsed.recommended_action
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Groq cohort: ${msg}`)
      console.error('[cron/daily-analysis] Groq error:', err)
    }
  }

  // ── Step 3: POST to /api/intelligence/batch ───────────────────────────────
  try {
    const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'https://palmgalaxy.app'
    const cronSecret = process.env.CRON_SECRET        ?? ''

    const batchRes = await fetch(`${appUrl}/api/intelligence/batch`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        lookback_hours: 24,
        date:           dateLabel,
      }),
    })

    if (batchRes.ok) {
      result.batch_done = true
    } else {
      errors.push(`Batch route returned ${batchRes.status}`)
      console.warn('[cron/daily-analysis] Batch route non-OK:', batchRes.status)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Batch POST: ${msg}`)
    console.error('[cron/daily-analysis] Batch POST error:', err)
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  result.ok     = errors.length === 0
  result.errors = errors

  console.log('[cron/daily-analysis] Complete:', {
    date:              result.date,
    sessions_analyzed: result.sessions_analyzed,
    groq_cohort_done:  result.groq_cohort_done,
    batch_done:        result.batch_done,
    error_count:       errors.length,
  })

  // Always return 200 — Vercel Cron retries on non-2xx, which we don't want
  // for a best-effort analytics job
  return NextResponse.json(result, { status: 200 })
}

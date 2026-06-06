// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/share/og/route.ts
// File 34 of 48
//
// GET /api/share/og?sid=<shareId>
//
// Alias / redirect handler for the /share/:shareId rewrite target defined in
// vercel.json:
//
//   { "source": "/share/:shareId", "destination": "/?ref=share&sid=:shareId" }
//
// This route is the companion to that rewrite — it is NOT the primary target
// of the rewrite (the homepage handles that) but provides a dedicated API
// endpoint for:
//
//   1. Validating that a shareId corresponds to a real session before any
//      redirect (bot / scraper path where they hit /api/share/og directly)
//   2. Serving a redirect to the correct personalised OG URL when the share
//      link is accessed programmatically (e.g. link-preview bots that follow
//      meta-refresh or Location headers rather than rendering JS)
//   3. Providing a JSON probe endpoint: GET /api/share/og?sid=<id>&format=json
//      returns { valid, score, city, level } — used by admin tooling and
//      the OG image route to avoid a second Supabase round-trip.
//
// Redirect chain for a share link:
//   /share/<id>  →  /?ref=share&sid=<id>  (vercel.json rewrite, in-place)
//   Crawlers/bots hitting the rewrite target see:
//     - <meta property="og:image" content="/api/og?sid=<id>"> (set by page.tsx)
//     - <meta http-equiv="refresh" content="0;url=/?ref=share&sid=<id>">
//
//   Bots that instead follow the Location header can be served by this route:
//     GET /api/share/og?sid=<id>  →  302  /?ref=share&sid=<id>
//
// Runtime: Edge — must not import @supabase/supabase-js at module level.
// Session lookup uses the Supabase REST API directly (same pattern as og/route.ts).
//
// Rules:
//   - Missing or malformed sid → 302 to homepage (not 400 — never break links)
//   - Unknown sid (not in DB) → still redirects; OG image falls back to generic
//   - ?format=json returns JSON instead of redirect (for tooling)
//   - Edge runtime; maxDuration set in vercel.json
// ═══════════════════════════════════════════════════════════════════════════

import type { NextRequest } from 'next/server'
import { NextResponse }     from 'next/server'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://palmgalaxy.app'
const CITY_NAMES = ['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza'] as const

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface SessionProbe {
  valid:  boolean
  score:  number
  city:   string
  level:  number
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION PROBE — Supabase REST, edge-compatible (no SDK import)
// Mirrors the pattern in app/api/og/route.ts.
// ─────────────────────────────────────────────────────────────────────────────

async function probeSession(sid: string): Promise<SessionProbe> {
  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // If env vars absent (e.g. local dev without .env.local), return a valid
  // stub so the redirect still fires — the OG image will fall back gracefully.
  if (!supabaseUrl || !serviceRoleKey) {
    return { valid: true, score: 0, city: 'Miami', level: 0 }
  }

  try {
    const url =
      `${supabaseUrl}/rest/v1/sessions` +
      `?id=eq.${encodeURIComponent(sid)}` +
      `&select=final_score,max_level_reached,runs_json` +
      `&limit=1`

    const res = await fetch(url, {
      headers: {
        apikey:        serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept:        'application/json',
      },
      // No caching — share links should always reflect the actual stored score
      cache: 'no-store',
    })

    if (!res.ok) {
      // Supabase error — treat as unknown session; redirect anyway
      return { valid: false, score: 0, city: 'Miami', level: 0 }
    }

    const rows = await res.json() as Array<{
      final_score:       number | null
      max_level_reached: number | null
      runs_json:         unknown
    }>

    if (!rows.length) {
      return { valid: false, score: 0, city: 'Miami', level: 0 }
    }

    const row   = rows[0]
    const level = Math.max(0, Math.min(row.max_level_reached ?? 0, CITY_NAMES.length - 1))
    const score = row.final_score ?? 0

    // Derive city name from runs_json first, then fall back to level index
    let city: string = CITY_NAMES[level]
    try {
      if (Array.isArray(row.runs_json) && row.runs_json.length > 0) {
        const lastRun = row.runs_json[row.runs_json.length - 1] as Record<string, unknown>
        if (typeof lastRun?.max_city_reached === 'string' && lastRun.max_city_reached) {
          city = lastRun.max_city_reached
        }
      }
    } catch {
      // Fall through — already assigned from level index above
    }

    return { valid: true, score, city, level }

  } catch {
    // Network failure — treat as unknown, still redirect
    return { valid: false, score: 0, city: 'Miami', level: 0 }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the string is a plausible session ID.
 * Accepts both UUID v4 format and the local_* fallback IDs issued by useSession.
 * Does NOT validate against the database — that is done separately via probeSession.
 */
function isPlausibleSid(sid: string): boolean {
  if (!sid || sid.length < 4 || sid.length > 128) return false
  // Allow UUID v4 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (uuidRe.test(sid)) return true
  // Allow local_* fallback IDs (e.g. "local_1k3j2h")
  if (/^local_[a-z0-9]+$/i.test(sid)) return true
  // Allow any alphanumeric-with-hyphens-or-underscores string up to 128 chars
  if (/^[a-z0-9_-]+$/i.test(sid)) return true
  return false
}

/**
 * Build the canonical homepage redirect URL for a given share ID.
 * Includes ref=share so GameShell knows to show the challenge banner.
 */
function buildHomeRedirectUrl(sid: string): string {
  return `${APP_URL}/?ref=share&sid=${encodeURIComponent(sid)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const { searchParams } = new URL(req.url)

  const sid    = (searchParams.get('sid') ?? '').trim()
  const format = (searchParams.get('format') ?? '').toLowerCase()

  // ── Validate sid format ───────────────────────────────────────────────────
  // If sid is absent or malformed, redirect to the homepage without a share ref.
  // We never return a 4xx — broken share links must not show an error page.
  if (!sid || !isPlausibleSid(sid)) {
    return NextResponse.redirect(APP_URL, { status: 302 })
  }

  // ── JSON probe mode — for admin tooling ──────────────────────────────────
  // GET /api/share/og?sid=<id>&format=json
  if (format === 'json') {
    const probe = await probeSession(sid)
    return NextResponse.json(probe, {
      status: 200,
      headers: {
        // Short cache — share cards don't change often but we don't want
        // stale data in dashboards
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=30',
      },
    })
  }

  // ── Standard redirect mode ────────────────────────────────────────────────
  // Probe the session so we can set informative response headers, but redirect
  // regardless of whether the session exists — broken links should land on the
  // homepage, not an error page.
  //
  // We run the probe in the background using waitUntil if available, but
  // since Next.js Edge doesn't expose waitUntil directly, we fire-and-forget
  // to keep TTFB low. The OG image route will do its own DB lookup anyway.
  //
  // For crawlers/bots that do follow Location headers (WhatsApp, Telegram,
  // Slack unfurl bots), we use a 302 so they re-fetch on every visit and
  // always get the up-to-date OG image.

  const redirectUrl = buildHomeRedirectUrl(sid)

  // Attempt a fast probe with a short timeout — only to enrich response headers
  let probe: SessionProbe | null = null
  try {
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), 1500)   // 1.5s max
    probe = await Promise.race([
      probeSession(sid),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 1500)),
    ])
    clearTimeout(timeout)
  } catch {
    probe = null
  }

  // Build response headers
  const headers = new Headers({
    Location:        redirectUrl,
    // Inform crawlers of the canonical share URL
    'X-Share-Id':    sid,
    // Never cache the redirect — the shared score may update if the player
    // replays and we always want the latest OG image
    'Cache-Control': 'no-store',
  })

  // If probe succeeded, expose score/city metadata for logging / middleware
  if (probe?.valid) {
    headers.set('X-Share-Score', String(probe.score))
    headers.set('X-Share-City',  probe.city)
    headers.set('X-Share-Level', String(probe.level))
  }

  return new Response(null, { status: 302, headers })
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204 })
}

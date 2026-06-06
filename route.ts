// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/session/start/route.ts
// File 24 of 48
//
// POST /api/session/start
//
// Called once by useSession.startSession() when the user clicks Play.
// Creates a session row in Supabase and returns the session_id.
//
// Responsibilities:
//   - Parse and validate the request body (SessionStartRequest)
//   - Derive device / OS / browser from User-Agent via ua-parser-js
//   - Hash the client IP for geo correlation without storing PII
//   - Insert into sessions table using service-role client
//   - Return { session_id } so useSession can store it in its ref
//
// Rules:
//   - Never throws to the client — returns { session_id } or a safe error
//   - IP is hashed (SHA-256 first 16 chars) — raw IP never stored
//   - country / city_geo derived from CF-IPCountry header (Vercel edge)
//   - ua-parser-js runs server-side only — not in any client bundle
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { UAParser } from 'ua-parser-js'
import { createServerClient } from '@/lib/supabase/server'
import type { SessionStartRequest, SessionStartResponse } from '@/lib/game/types'

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-way hash of an IP address for session deduplication without PII storage.
 * Uses Web Crypto API (available in Next.js edge + Node runtimes).
 * Returns the first 16 hex chars — sufficient for fingerprinting, not reversible.
 */
async function hashIp(ip: string): Promise<string> {
  try {
    const encoded = new TextEncoder().encode(ip)
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  } catch {
    return 'unknown'
  }
}

/**
 * Extract the best available client IP from request headers.
 * Vercel injects x-forwarded-for; fall back to x-real-ip.
 */
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

/**
 * Normalize device type string.
 * ua-parser-js returns undefined for desktop (no explicit device type).
 */
function normalizeDeviceType(type: string | undefined): string {
  if (!type) return 'desktop'
  return type.toLowerCase()
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: SessionStartRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  // ── Validate required fields ────────────────────────────────────────────────
  // screen_width / height are the only hard requirements; everything else is
  // best-effort enrichment. A missing fingerprint still creates a valid session.
  if (
    typeof body.screen_width  !== 'number' ||
    typeof body.screen_height !== 'number'
  ) {
    return NextResponse.json(
      { error: 'screen_width and screen_height are required' },
      { status: 400 },
    )
  }

  // ── Derive UA metadata ──────────────────────────────────────────────────────
  const uaString = req.headers.get('user-agent') ?? ''
  const parser   = new UAParser(uaString)
  const ua       = parser.getResult()

  const deviceType = normalizeDeviceType(ua.device.type)
  const os         = ua.os.name         ?? 'unknown'
  const browser    = ua.browser.name    ?? 'unknown'

  // ── Derive geo from Vercel / Cloudflare headers ─────────────────────────────
  // Vercel sets x-vercel-ip-country and x-vercel-ip-city at the edge.
  const country  = req.headers.get('x-vercel-ip-country')  ?? null
  const cityGeo  = req.headers.get('x-vercel-ip-city')     ?? null

  // ── Hash IP ──────────────────────────────────────────────────────────────────
  const rawIp  = getClientIp(req)
  const ipHash = await hashIp(rawIp)

  // ── Insert session row ──────────────────────────────────────────────────────
  try {
    const supabase = createServerClient()

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        // Identity
        fingerprint:   body.fingerprint   ?? null,
        ip_hash:       ipHash,
        country,
        city_geo:      cityGeo,
        device_type:   deviceType,
        os,
        browser,
        screen_width:  body.screen_width,
        screen_height: body.screen_height,

        // Acquisition
        referrer:      body.referrer      ?? null,
        utm_source:    body.utm_source    ?? null,
        utm_medium:    body.utm_medium    ?? null,
        utm_campaign:  body.utm_campaign  ?? null,
        utm_content:   body.utm_content   ?? null,
        landing_url:   body.landing_url   ?? null,

        // Timestamps
        started_at:      new Date().toISOString(),
        last_active_at:  new Date().toISOString(),

        // Cross-product defaults
        product_source:    process.env.NEXT_PUBLIC_PRODUCT_SOURCE ?? 'palm_galaxy',
        shared_tiktok:     false,
        shared_x:          false,
        shared_email:      false,
        shared_link_copied: false,
        zyvv_bridge_sent:  false,
        zyvv_converted:    false,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[session/start] Supabase insert error:', error.message)
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 500 },
      )
    }

    const response: SessionStartResponse = { session_id: data.id }
    return NextResponse.json(response, { status: 201 })

  } catch (err) {
    console.error('[session/start] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight (headers set in vercel.json, this handles preflight)
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

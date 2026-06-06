// app/api/session/start/route.ts
// File 39 of 48
// POST /api/session/start
// Called on first paint. Creates a session row in Supabase.
// Returns { sessionId } to the client for all subsequent event calls.

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface SessionStartBody {
  fingerprint:  string
  utm_source:   string | null
  utm_medium:   string | null
  utm_campaign: string | null
  utm_content:  string | null
  utm_term:     string | null
  referrer:     string | null
  device_type:  string | null
  os:           string | null
  browser:      string | null
  screen_w:     number | null
  screen_h:     number | null
  lang:         string | null
  tz:           string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

function parseGeo(req: NextRequest): { country: string | null; city: string | null; region: string | null } {
  // Vercel injects these headers on edge functions
  return {
    country: req.headers.get('x-vercel-ip-country') ?? null,
    city:    req.headers.get('x-vercel-ip-city')    ?? null,
    region:  req.headers.get('x-vercel-ip-country-region') ?? null,
  }
}

function getIp(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as SessionStartBody

    if (!body.fingerprint || typeof body.fingerprint !== 'string') {
      return NextResponse.json({ error: 'fingerprint required' }, { status: 400 })
    }

    const supabase  = getSupabase()
    const geo       = parseGeo(req)
    const ip        = getIp(req)
    const userAgent = req.headers.get('user-agent') ?? null
    const now       = new Date().toISOString()

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        fingerprint:     body.fingerprint,
        product_source:  'palm_lazer',
        started_at:      now,
        utm_source:      body.utm_source   ?? null,
        utm_medium:      body.utm_medium   ?? null,
        utm_campaign:    body.utm_campaign ?? null,
        utm_content:     body.utm_content  ?? null,
        utm_term:        body.utm_term     ?? null,
        referrer:        body.referrer     ?? null,
        device_type:     body.device_type  ?? null,
        os:              body.os           ?? null,
        browser:         body.browser      ?? null,
        screen_w:        body.screen_w     ?? null,
        screen_h:        body.screen_h     ?? null,
        lang:            body.lang         ?? null,
        tz:              body.tz           ?? null,
        ip_address:      ip,
        user_agent:      userAgent,
        geo_country:     geo.country,
        geo_city:        geo.city,
        geo_region:      geo.region,
        // ZYVV bridge columns — default false/null until converted
        zyvv_converted:  false,
        zyvv_session_id: null,
        // Score/level tracking — updated on session end
        final_score:          0,
        max_level_reached:    0,
        email_captured:       false,
        email:                null,
        churn_risk:           null,
        share_propensity:     null,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[session/start] Supabase error:', error.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }

    return NextResponse.json({ sessionId: data.id }, { status: 201 })

  } catch (err) {
    console.error('[session/start] Unexpected error:', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

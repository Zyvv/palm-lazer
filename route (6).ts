// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/og/route.ts
// File 30 of 48
//
// GET /api/og
//
// Generates a personalised Open Graph share card using Next.js ImageResponse.
// Two modes:
//   ?sid=<session_id>           → look up score/city/level from Supabase
//   ?score=<n>&city=<s>&level=<n> → use query params directly (fallback)
//
// Design:
//   1200×630 black canvas, neon aesthetic matching the game canvas.
//   Press Start 2P font loaded from Google Fonts at render time.
//   Score in yellow, city in cyan, wordmark in green — no external images.
//
// Architecture rules respected:
//   - Edge runtime (ImageResponse requires it)
//   - createServerClient() called inside the handler — not at module level
//   - Never imports anything from components/ or hooks/
//   - Supabase lookup wrapped in try/catch — falls back silently to params
//
// Caching:
//   Cache-Control header set in vercel.json: public, max-age=86400
//   Edge runtime handles this natively; no manual headers needed here.
// ═══════════════════════════════════════════════════════════════════════════

import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const WIDTH  = 1200
const HEIGHT = 630

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'PALM GALAXY'

// Active cities list — mirrors ACTIVE_CITIES in cities.ts
// Duplicated here to avoid importing non-edge-compatible modules.
const CITY_ACCENTS: Record<string, { accent: string; accent2: string; sky: string }> = {
  miami: { accent: '#ff3aff', accent2: '#00ffee', sky: '#0a0a2e' },
  tokyo: { accent: '#ff006a', accent2: '#00aaff', sky: '#1a0a2e' },
  nyc:   { accent: '#ffcc00', accent2: '#ff4400', sky: '#050510' },
  dubai: { accent: '#ffaa00', accent2: '#ff6600', sky: '#100a00' },
  ibiza: { accent: '#ff00aa', accent2: '#aa00ff', sky: '#000820' },
}

function getCityAccent(cityName: string) {
  const key = cityName.toLowerCase().replace(/\s+/g, '')
  return CITY_ACCENTS[key] ?? CITY_ACCENTS['miami']
}

function formatScore(n: number): string {
  return n.toLocaleString('en-US')
}

// ─────────────────────────────────────────────────────────────────────────────
// FONT LOADER
// Press Start 2P loaded from Google Fonts — edge-compatible fetch at render.
// ─────────────────────────────────────────────────────────────────────────────

async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(
      'https://fonts.gstatic.com/s/pressstart2p/v15/e3t4euO8T-267oIAQAu6jDQyK3nVivM.woff2',
      { cache: 'force-cache' },
    )
    if (!res.ok) return null
    return res.arrayBuffer()
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION LOOKUP — edge-compatible Supabase fetch (plain REST, no SDK)
// The @supabase/supabase-js SDK is not edge-compatible when imported at module
// level. We use the REST API directly here — same service role key.
// ─────────────────────────────────────────────────────────────────────────────

interface SessionLookupResult {
  score:    number
  level:    number
  city:     string
}

async function lookupSession(sid: string): Promise<SessionLookupResult | null> {
  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) return null

  try {
    const url = `${supabaseUrl}/rest/v1/sessions?id=eq.${encodeURIComponent(sid)}&select=final_score,max_level_reached,runs_json&limit=1`

    const res = await fetch(url, {
      headers: {
        'apikey':        serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Accept':        'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) return null

    const rows = await res.json() as Array<{
      final_score:       number | null
      max_level_reached: number | null
      runs_json:         unknown | null
    }>

    if (!rows.length) return null

    const row = rows[0]

    // Derive city from runs_json if present, else infer from level
    let city = 'Miami'
    try {
      if (Array.isArray(row.runs_json) && row.runs_json.length > 0) {
        // runs_json is RunSummary[] — take max city from last run
        const lastRun = row.runs_json[row.runs_json.length - 1] as Record<string, unknown>
        if (typeof lastRun?.max_city_reached === 'string') {
          city = lastRun.max_city_reached
        }
      }
    } catch { /* fall through to default */ }

    const CITY_NAMES = ['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza']
    const level      = row.max_level_reached ?? 0
    if (city === 'Miami' && level > 0) {
      city = CITY_NAMES[Math.min(level, CITY_NAMES.length - 1)] ?? 'Miami'
    }

    return {
      score: row.final_score       ?? 0,
      level: row.max_level_reached ?? 0,
      city,
    }
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD RENDERER — returns JSX element for ImageResponse
// Uses inline styles only (no Tailwind/CSS — ImageResponse uses yoga layout).
// ─────────────────────────────────────────────────────────────────────────────

function buildCard(
  score:    number,
  level:    number,
  city:     string,
  hasScore: boolean,
) {
  const { accent, accent2, sky } = getCityAccent(city)

  return (
    <div
      style={{
        width:           WIDTH,
        height:          HEIGHT,
        background:      '#000000',
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        position:        'relative',
        overflow:        'hidden',
        fontFamily:      '"PressStart2P", monospace',
      }}
    >
      {/* Sky gradient strip at top */}
      <div
        style={{
          position:   'absolute',
          top:        0,
          left:       0,
          width:      WIDTH,
          height:     200,
          background: `linear-gradient(180deg, ${sky} 0%, #000000 100%)`,
          display:    'flex',
        }}
      />

      {/* Scanlines overlay */}
      <div
        style={{
          position:        'absolute',
          top:             0,
          left:            0,
          width:           WIDTH,
          height:          HEIGHT,
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.18) 3px, rgba(0,0,0,0.18) 4px)',
          display:         'flex',
          zIndex:          1,
        }}
      />

      {/* Neon border frame */}
      <div
        style={{
          position:  'absolute',
          top:       24,
          left:      24,
          right:     24,
          bottom:    24,
          border:    `2px solid ${accent}33`,
          display:   'flex',
          zIndex:    2,
        }}
      />

      {/* Corner accents */}
      {[
        { top: 24,      left: 24,    borderTop: `3px solid ${accent}`, borderLeft:  `3px solid ${accent}`, width: 32, height: 32 },
        { top: 24,      right: 24,   borderTop: `3px solid ${accent}`, borderRight: `3px solid ${accent}`, width: 32, height: 32 },
        { bottom: 24,   left: 24,    borderBottom: `3px solid ${accent}`, borderLeft:  `3px solid ${accent}`, width: 32, height: 32 },
        { bottom: 24,   right: 24,   borderBottom: `3px solid ${accent}`, borderRight: `3px solid ${accent}`, width: 32, height: 32 },
      ].map((cornerStyle, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            display:  'flex',
            zIndex:   3,
            ...cornerStyle,
          }}
        />
      ))}

      {/* Content — stacked vertically */}
      <div
        style={{
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          zIndex:         4,
          gap:            0,
        }}
      >
        {/* Wordmark */}
        <div
          style={{
            color:       '#00ff88',
            fontSize:    28,
            letterSpacing: 8,
            marginBottom: 8,
            textShadow:  '0 0 30px #00ff88, 0 0 60px #00ff8855',
            display:     'flex',
          }}
        >
          🌴 {APP_NAME.toUpperCase()}
        </div>

        {/* Divider */}
        <div
          style={{
            width:       320,
            height:      1,
            background:  `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            marginBottom: 36,
            display:     'flex',
          }}
        />

        {hasScore ? (
          <>
            {/* Score */}
            <div
              style={{
                color:        '#ffff00',
                fontSize:     92,
                letterSpacing: 4,
                lineHeight:   1,
                marginBottom: 20,
                textShadow:   '0 0 40px #ffff00, 0 0 80px #ffff0044',
                display:      'flex',
              }}
            >
              {formatScore(score)}
            </div>

            {/* City + level badge */}
            <div
              style={{
                color:        accent2,
                fontSize:     16,
                letterSpacing: 6,
                marginBottom: 40,
                textShadow:   `0 0 16px ${accent2}`,
                display:      'flex',
              }}
            >
              {city.toUpperCase()} · LEVEL {level + 1}
            </div>

            {/* Challenge line */}
            <div
              style={{
                color:        '#ff00ff',
                fontSize:     13,
                letterSpacing: 3,
                textShadow:   '0 0 12px #ff00ff',
                display:      'flex',
              }}
            >
              CAN YOU BEAT THIS?
            </div>
          </>
        ) : (
          <>
            {/* Generic tagline for default OG */}
            <div
              style={{
                color:        '#ff00ff',
                fontSize:     20,
                letterSpacing: 4,
                marginBottom: 20,
                textShadow:   '0 0 16px #ff00ff',
                display:      'flex',
                textAlign:    'center',
              }}
            >
              DODGE THE LASERS
            </div>

            <div
              style={{
                color:        accent2,
                fontSize:     14,
                letterSpacing: 5,
                marginBottom: 36,
                textShadow:   `0 0 12px ${accent2}`,
                display:      'flex',
              }}
            >
              SURVIVE EACH CITY
            </div>

            {/* City row */}
            <div
              style={{
                display:     'flex',
                flexDirection: 'row',
                gap:         24,
                color:       '#333333',
                fontSize:    10,
                letterSpacing: 2,
              }}
            >
              {['MIAMI', 'TOKYO', 'NYC', 'DUBAI', 'IBIZA'].map(c => (
                <div key={c} style={{ display: 'flex', color: '#333333' }}>{c}</div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Bottom tagline */}
      <div
        style={{
          position:      'absolute',
          bottom:        48,
          color:         '#222222',
          fontSize:      9,
          letterSpacing: 3,
          display:       'flex',
          zIndex:        4,
        }}
      >
        DODGE · SURVIVE · SHARE
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url)

  const sid         = searchParams.get('sid')
  const scoreParam  = searchParams.get('score')
  const cityParam   = searchParams.get('city')  ?? 'Miami'
  const levelParam  = searchParams.get('level')

  // ── Determine score / city / level ────────────────────────────────────────
  let score    = 0
  let city     = cityParam
  let level    = levelParam ? parseInt(levelParam, 10) : 0
  let hasScore = false

  // Prefer sid lookup
  if (sid) {
    try {
      const session = await lookupSession(sid)
      if (session) {
        score    = session.score
        city     = session.city
        level    = session.level
        hasScore = session.score > 0
      }
    } catch {
      // Fall through to params
    }
  }

  // Fall back to explicit query params
  if (!hasScore && scoreParam) {
    const parsed = parseInt(scoreParam, 10)
    if (!isNaN(parsed) && parsed > 0) {
      score    = parsed
      hasScore = true
    }
  }

  // Clamp level to valid range
  level = Math.max(0, Math.min(level, 4))

  // ── Load font ─────────────────────────────────────────────────────────────
  const fontData = await loadFont()

  const options: ConstructorParameters<typeof ImageResponse>[1] = {
    width:  WIDTH,
    height: HEIGHT,
  }

  if (fontData) {
    options.fonts = [
      {
        name:   'PressStart2P',
        data:   fontData,
        weight: 400,
        style:  'normal',
      },
    ]
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return new ImageResponse(
    buildCard(score, level, city, hasScore),
    options,
  )
}

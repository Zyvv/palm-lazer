// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — app/api/og/route.ts
// File 45 of 48
//
// GET /api/og?score=&city=&level=
//
// Returns a 1200×630 ImageResponse for Open Graph / Twitter card meta tags.
// No SDK — Supabase data fetched via raw REST fetch with apikey header.
//
// Layout:
//   Black background · neon green score (large, Orbitron 900)
//   City accent colour · "PALM LAZER" wordmark (Press Start 2P)
//   City name badge · level badge · scanline overlay
//
// Runtime: edge
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest }  from 'next/server'
import { ImageResponse } from 'next/og'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// CITY ACCENT COLOURS — mirrors constants.ts exactly
// ─────────────────────────────────────────────────────────────────────────────

const CITY_ACCENTS: Record<string, string> = {
  miami: '#ff3aff',
  tokyo: '#ff006a',
  nyc:   '#ffcc00',
  dubai: '#ffaa00',
  ibiza: '#ff00aa',
}

const CITY_ACCENT2: Record<string, string> = {
  miami: '#00ffee',
  tokyo: '#00aaff',
  nyc:   '#ff4400',
  dubai: '#ff6600',
  ibiza: '#aa00ff',
}

function accentForCity(city: string): string {
  return CITY_ACCENTS[city.toLowerCase()] ?? '#00ff88'
}

function accent2ForCity(city: string): string {
  return CITY_ACCENT2[city.toLowerCase()] ?? '#00eeff'
}

// ─────────────────────────────────────────────────────────────────────────────
// FONT LOADER
// Press Start 2P and Orbitron loaded from Google Fonts at edge runtime.
// Both fetches are parallelised.
// ─────────────────────────────────────────────────────────────────────────────

async function loadFonts(): Promise<
  { name: string; data: ArrayBuffer; weight: number; style: 'normal' }[]
> {
  const [pressStart2P, orbitron] = await Promise.all([
    fetch(
      'https://fonts.gstatic.com/s/pressstart2p/v15/e3t4euO8T-267oIAQAu6jDQyK3nVivM.woff',
    ).then((r) => r.arrayBuffer()),
    fetch(
      'https://fonts.gstatic.com/s/orbitron/v31/yMJMMIlzdpvBhQQL_SC3X9yhF25-T1nyGy6xpmIyXjU1pg.woff',
    ).then((r) => r.arrayBuffer()),
  ])

  return [
    { name: 'PressStart2P', data: pressStart2P, weight: 400, style: 'normal' },
    { name: 'Orbitron',     data: orbitron,      weight: 900, style: 'normal' },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE REST FETCH (no SDK — edge compatible)
// Used when session_id is supplied as a query param.
// Falls back gracefully if session not found.
// ─────────────────────────────────────────────────────────────────────────────

interface SessionRow {
  final_score:       number | null
  max_level_reached: number | null
  max_city_reached:  string | null
}

async function fetchSession(sessionId: string): Promise<SessionRow | null> {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  try {
    const res = await fetch(
      `${url}/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&select=final_score,max_level_reached,max_city_reached&limit=1`,
      {
        headers: {
          apikey:          anonKey,
          Authorization:   `Bearer ${anonKey}`,
          'Content-Type':  'application/json',
        },
        // Edge cache: revalidate every 30s so shared OG images stay fresh-ish
        // @ts-expect-error — Next.js fetch extension
        next: { revalidate: 30 },
      },
    )

    if (!res.ok) return null
    const rows: SessionRow[] = await res.json()
    return rows[0] ?? null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<ImageResponse | Response> {
  const { searchParams } = req.nextUrl

  // ── Resolve display values ────────────────────────────────────────────────
  // Priority: query params → session DB row → defaults
  let score  = 0
  let city   = 'Miami'
  let level  = 0

  const sessionId = searchParams.get('sid') ?? ''

  if (sessionId) {
    const row = await fetchSession(sessionId)
    if (row) {
      score = row.final_score       ?? 0
      level = row.max_level_reached ?? 0
      city  = row.max_city_reached  ?? 'Miami'
    }
  }

  // Explicit query params always override DB values
  if (searchParams.has('score')) score = parseInt(searchParams.get('score')!, 10) || 0
  if (searchParams.has('city'))  city  = searchParams.get('city')!
  if (searchParams.has('level')) level = parseInt(searchParams.get('level')!, 10) || 0

  const cityDisplay  = city.toUpperCase()
  const accent       = accentForCity(city)
  const accent2      = accent2ForCity(city)
  const scoreDisplay = score.toLocaleString('en-US')
  const levelDisplay = `LEVEL ${level + 1}`

  // ── Load fonts ────────────────────────────────────────────────────────────
  let fonts: Awaited<ReturnType<typeof loadFonts>>
  try {
    fonts = await loadFonts()
  } catch {
    // Font fetch failed — fall back to system fonts (OG will still render)
    fonts = []
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return new ImageResponse(
    (
      <div
        style={{
          width:           '1200px',
          height:          '630px',
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
        {/* ── Scanline overlay ──────────────────────────────────────────── */}
        <div
          style={{
            position:         'absolute',
            inset:            0,
            backgroundImage:  'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.14) 2px, rgba(0,0,0,0.14) 4px)',
            zIndex:           10,
            display:          'flex',
          }}
        />

        {/* ── Background glow blobs ─────────────────────────────────────── */}
        <div
          style={{
            position:   'absolute',
            top:        '-120px',
            left:       '-120px',
            width:      '500px',
            height:     '500px',
            background: `radial-gradient(circle, ${accent}22 0%, transparent 70%)`,
            display:    'flex',
          }}
        />
        <div
          style={{
            position:   'absolute',
            bottom:     '-100px',
            right:      '-100px',
            width:      '420px',
            height:     '420px',
            background: `radial-gradient(circle, ${accent2}1a 0%, transparent 70%)`,
            display:    'flex',
          }}
        />

        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <div
          style={{
            position:        'absolute',
            top:             0,
            left:            0,
            right:           0,
            height:          '6px',
            background:      `linear-gradient(90deg, ${accent}, ${accent2}, ${accent})`,
            display:         'flex',
          }}
        />

        {/* ── PALM LAZER wordmark ───────────────────────────────────────── */}
        <div
          style={{
            fontFamily:  '"PressStart2P", monospace',
            fontSize:    '22px',
            color:       '#00ff88',
            letterSpacing: '4px',
            textShadow:  `0 0 18px #00ff88, 0 0 40px #00ff88`,
            marginBottom: '28px',
            display:     'flex',
          }}
        >
          PALM LAZER
        </div>

        {/* ── Score ─────────────────────────────────────────────────────── */}
        <div
          style={{
            fontFamily:   '"Orbitron", sans-serif',
            fontSize:     '120px',
            fontWeight:   900,
            color:        '#00ff88',
            textShadow:   `0 0 30px #00ff88, 0 0 60px #00ff88, 0 0 100px #00ff88`,
            lineHeight:   1,
            marginBottom: '20px',
            display:      'flex',
          }}
        >
          {scoreDisplay}
        </div>

        {/* ── Score label ───────────────────────────────────────────────── */}
        <div
          style={{
            fontFamily:   '"PressStart2P", monospace',
            fontSize:     '11px',
            color:        '#555555',
            letterSpacing: '3px',
            marginBottom: '32px',
            display:      'flex',
          }}
        >
          FINAL SCORE
        </div>

        {/* ── City + Level badges ───────────────────────────────────────── */}
        <div
          style={{
            display:    'flex',
            gap:        '20px',
            alignItems: 'center',
          }}
        >
          {/* City badge */}
          <div
            style={{
              fontFamily:    '"PressStart2P", monospace',
              fontSize:      '13px',
              color:         accent,
              letterSpacing: '4px',
              padding:       '10px 22px',
              border:        `1px solid ${accent}`,
              textShadow:    `0 0 12px ${accent}`,
              boxShadow:     `0 0 16px ${accent}44`,
              display:       'flex',
            }}
          >
            {cityDisplay}
          </div>

          {/* Level badge */}
          <div
            style={{
              fontFamily:    '"PressStart2P", monospace',
              fontSize:      '11px',
              color:         accent2,
              letterSpacing: '3px',
              padding:       '10px 18px',
              border:        `1px solid ${accent2}`,
              textShadow:    `0 0 10px ${accent2}`,
              boxShadow:     `0 0 14px ${accent2}44`,
              display:       'flex',
            }}
          >
            {levelDisplay}
          </div>
        </div>

        {/* ── CTA ───────────────────────────────────────────────────────── */}
        <div
          style={{
            position:      'absolute',
            bottom:        '28px',
            fontFamily:    '"PressStart2P", monospace',
            fontSize:      '9px',
            color:         '#333333',
            letterSpacing: '2px',
            display:       'flex',
          }}
        >
          {(process.env.NEXT_PUBLIC_APP_URL ?? 'palmlazer.com').replace('https://', '')}
        </div>

        {/* ── Bottom bar ────────────────────────────────────────────────── */}
        <div
          style={{
            position:   'absolute',
            bottom:     0,
            left:       0,
            right:      0,
            height:     '4px',
            background: `linear-gradient(90deg, ${accent2}, ${accent}, ${accent2})`,
            display:    'flex',
          }}
        />
      </div>
    ),
    {
      width:  1200,
      height: 630,
      fonts,
    },
  )
}

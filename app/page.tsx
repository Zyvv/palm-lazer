// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/page.tsx
// File 11 of 48
//
// Root page. Server component shell — reads searchParams for UTM / share ref,
// passes them to the client GameShell which owns all interactive state.
// Nothing interactive lives here; this stays a pure RSC for fast TTFB.
// ═══════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import { GameShell } from '@/components/game/GameShell'

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC METADATA — personalised OG for share links (/share/:shareId rewrites
// to /?ref=share&sid=:shareId via vercel.json). We read sid and generate a
// custom OG image so the sharer's score appears in the link preview.
// ─────────────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: {
    // Acquisition
    utm_source?:   string
    utm_medium?:   string
    utm_campaign?: string
    utm_content?:  string
    // Share deep-link (from vercel.json rewrite)
    ref?: string
    sid?: string
  }
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://palmlazer.com'

  // If this is a share link, generate a personalised OG image
  if (searchParams.ref === 'share' && searchParams.sid) {
    const ogUrl = `${APP_URL}/api/og?sid=${searchParams.sid}`
    return {
      title: 'Someone challenged you to Palm Lazer 🌴⚡',
      description: 'A friend survived the lasers. Can you beat their score?',
      openGraph: {
        title: 'Someone challenged you to Palm Lazer 🌴⚡',
        description: 'A friend survived the lasers. Can you beat their score?',
        images: [{ url: ogUrl, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Someone challenged you to Palm Lazer 🌴⚡',
        description: 'A friend survived the lasers. Can you beat their score?',
        images: [ogUrl],
      },
    }
  }

  // Default — handled by root layout metadata
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function HomePage({ searchParams }: PageProps) {
  // Pluck only the fields we need — never pass the full searchParams object
  // to a client component (it contains non-serialisable internals in some
  // Next.js versions).
  const utmData = {
    utm_source:   searchParams.utm_source   ?? null,
    utm_medium:   searchParams.utm_medium   ?? null,
    utm_campaign: searchParams.utm_campaign ?? null,
    utm_content:  searchParams.utm_content  ?? null,
    ref:          searchParams.ref          ?? null,
    sid:          searchParams.sid          ?? null,
  }

  return (
    <main className="page-game">
      {/* Header wordmark */}
      <header className="page-header">
        <span
          style={{
            fontFamily: 'var(--font-orbitron)',
            fontWeight: 900,
            fontSize: '13px',
            letterSpacing: '3px',
            color: 'var(--color-green)',
            textShadow: 'var(--text-glow-green)',
          }}
        >
          PALM GALAXY
        </span>
        <span
          style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '7px',
            color: '#444',
            letterSpacing: '1px',
          }}
        >
          🌴 ⚡
        </span>
      </header>

      {/*
        GameShell owns:
        - Session lifecycle (start / event / end API calls)
        - Canvas rendering via useGameEngine hook
        - All overlay UI (start screen, game over, email capture, share bar)
        - UTM data is passed in so /api/session/start can record acquisition
      */}
      <GameShell utmData={utmData} />

      {/* Footer */}
      <footer className="page-footer">
        <span>DODGE · SURVIVE · SHARE</span>
        <br />
        <span style={{ color: '#333' }}>
          © {new Date().getFullYear()} PALM GALAXY
        </span>
      </footer>
    </main>
  )
}

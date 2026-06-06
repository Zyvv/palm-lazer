// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/layout.tsx
// File 10 of 48
//
// Root layout. Metadata, viewport, OG tags, font preloads, session provider.
// Shared across every route — keep it lean, no game logic here.
// ═══════════════════════════════════════════════════════════════════════════

import type { Metadata, Viewport } from 'next'
import './globals.css'

// ─────────────────────────────────────────────────────────────────────────────
// METADATA
// ─────────────────────────────────────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://palmgalaxy.app'
const APP_NAME = 'Palm Galaxy'
const DESCRIPTION = 'Dodge the lasers. Survive the city. A retro arcade game across Miami, Tokyo, NYC, Dubai & Ibiza.'

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),

  title: {
    default: `${APP_NAME} 🌴⚡`,
    template: `%s | ${APP_NAME}`,
  },

  description: DESCRIPTION,

  applicationName: APP_NAME,

  keywords: [
    'arcade game',
    'palm tree',
    'retro game',
    'laser dodge',
    'browser game',
    'miami',
    'tokyo',
    'nyc',
    'pixel game',
    'neon arcade',
  ],

  authors: [{ name: 'Palm Galaxy' }],

  // ── Open Graph ────────────────────────────────────────────────────────────
  openGraph: {
    type: 'website',
    url: APP_URL,
    siteName: APP_NAME,
    title: `${APP_NAME} 🌴⚡ — Dodge the Lasers`,
    description: DESCRIPTION,
    images: [
      {
        url: `${APP_URL}/api/og`,
        width: 1200,
        height: 630,
        alt: 'Palm Galaxy — retro neon arcade game',
        type: 'image/png',
      },
    ],
    locale: 'en_US',
  },

  // ── Twitter / X card ──────────────────────────────────────────────────────
  twitter: {
    card: 'summary_large_image',
    title: `${APP_NAME} 🌴⚡ — Dodge the Lasers`,
    description: DESCRIPTION,
    images: [`${APP_URL}/api/og`],
    creator: '@palmgalaxy',
  },

  // ── Robots ────────────────────────────────────────────────────────────────
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  // ── Icons ─────────────────────────────────────────────────────────────────
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },

  // ── Manifest ──────────────────────────────────────────────────────────────
  manifest: '/manifest.json',

  // ── Other ─────────────────────────────────────────────────────────────────
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': APP_NAME,
    'theme-color': '#000000',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEWPORT
// ─────────────────────────────────────────────────────────────────────────────

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,        // Prevent pinch-zoom breaking game controls
  userScalable: false,
  themeColor: '#000000',
  colorScheme: 'dark',
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT LAYOUT
// ─────────────────────────────────────────────────────────────────────────────

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* ── Google Fonts preconnect ──────────────────────────────────── */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />

        {/*
          Fonts loaded here (in addition to globals.css @import) so they are
          in the <head> and available before first paint without FOUT.
          Press Start 2P: pixel aesthetic for all game UI text.
          Orbitron: city labels, logo wordmark.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Orbitron:wght@400;700;900&display=swap"
          rel="stylesheet"
        />

        {/* ── Structured data ──────────────────────────────────────────── */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'VideoGame',
              name: APP_NAME,
              description: DESCRIPTION,
              url: APP_URL,
              genre: ['Arcade', 'Action'],
              gamePlatform: 'Web Browser',
              applicationCategory: 'Game',
              operatingSystem: 'Web',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
            }),
          }}
        />
      </head>

      <body>
        {children}
      </body>
    </html>
  )
}

import type { NextConfig } from 'next'

const config: NextConfig = {
  // ── Strict React mode ────────────────────────────────────────────────
  reactStrictMode: true,

  // ── Image domains ────────────────────────────────────────────────────
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'palmlazer.com',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },

  // ── Security & performance headers ──────────────────────────────────
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
        ],
      },
      // ── Cache canvas assets aggressively ──────────────────────────
      {
        source: '/fonts/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },

  // ── Redirects ────────────────────────────────────────────────────────
  async redirects() {
    return [
      // Canonical trailing-slash redirect
      {
        source: '/play/',
        destination: '/play',
        permanent: true,
      },
    ]
  },

  // ── Experimental ─────────────────────────────────────────────────────
  experimental: {
    // Server Actions stable in Next 14 — no flag needed
    // typedRoutes helps catch bad hrefs at build time
    typedRoutes: false, // enable once all routes are stable
  },

  // ── Environment variables exposed to the browser ─────────────────────
  // Only NEXT_PUBLIC_* vars are exposed. Listed here for documentation.
  // Actual values live in .env.local — never committed.
  env: {
    NEXT_PUBLIC_APP_NAME: 'Palm Lazer',
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'https://palmlazer.com',
    NEXT_PUBLIC_PRODUCT_SOURCE: 'palm_lazer',
  },

  // ── Webpack — suppress canvas SSR warnings ───────────────────────────
  webpack(webpackConfig, { isServer }) {
    if (isServer) {
      // canvas is a browser API; prevent webpack from trying to bundle it
      webpackConfig.externals = [
        ...(Array.isArray(webpackConfig.externals) ? webpackConfig.externals : []),
        { canvas: 'canvas' },
      ]
    }
    return webpackConfig
  },
}

export default config

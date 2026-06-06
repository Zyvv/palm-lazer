// @ts-check

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,

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

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'X-Frame-Options',         value: 'DENY' },
          { key: 'X-XSS-Protection',        value: '1; mode=block' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
      {
        source: '/fonts/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },

  async redirects() {
    return [
      {
        source:      '/play/',
        destination: '/play',
        permanent:   true,
      },
    ]
  },

  env: {
    NEXT_PUBLIC_APP_NAME:       'Palm Lazer',
    NEXT_PUBLIC_APP_URL:        process.env.NEXT_PUBLIC_APP_URL ?? 'https://palmlazer.com',
    NEXT_PUBLIC_PRODUCT_SOURCE: 'palm_lazer',
  },

  webpack(webpackConfig, { isServer }) {
    if (isServer) {
      webpackConfig.externals = [
        ...(Array.isArray(webpackConfig.externals) ? webpackConfig.externals : []),
        { canvas: 'canvas' },
      ]
    }
    return webpackConfig
  },
}

export default config

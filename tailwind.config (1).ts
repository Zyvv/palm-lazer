import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './emails/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ── Palm Lazer brand palette ──────────────────────────────────────
      colors: {
        lazer: {
          black:    '#000000',
          void:     '#05050f',
          deep:     '#0a0a1e',
          green:    '#00ff88',
          magenta:  '#ff00ff',
          cyan:     '#00eeff',
          yellow:   '#ffff00',
          pink:     '#ff3aff',
          orange:   '#ff6600',
          gold:     '#ffaa00',
          red:      '#ff1a1a',
        },
      },
      // ── Typography ───────────────────────────────────────────────────
      fontFamily: {
        pixel:    ['"Press Start 2P"', 'monospace'],
        orbitron: ['Orbitron', 'sans-serif'],
        mono:     ['"Press Start 2P"', 'monospace'],
      },
      // ── Glow text shadows ─────────────────────────────────────────────
      textShadow: {
        green:   '0 0 8px #00ff88, 0 0 20px #00ff88',
        magenta: '0 0 8px #ff00ff, 0 0 20px #ff00ff',
        cyan:    '0 0 8px #00eeff, 0 0 20px #00eeff',
        yellow:  '0 0 8px #ffff00, 0 0 20px #ffff00',
        pink:    '0 0 8px #ff3aff, 0 0 20px #ff3aff',
      },
      // ── Box shadows / glow ────────────────────────────────────────────
      boxShadow: {
        'glow-green':   '0 0 16px #00ff88, 0 0 40px #00ff8844',
        'glow-magenta': '0 0 16px #ff00ff, 0 0 40px #ff00ff44',
        'glow-cyan':    '0 0 16px #00eeff, 0 0 40px #00eeff44',
        'glow-yellow':  '0 0 16px #ffff00, 0 0 40px #ffff0044',
        'glow-pink':    '0 0 16px #ff3aff, 0 0 40px #ff3aff44',
      },
      // ── Animations ────────────────────────────────────────────────────
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '41%':      { opacity: '1' },
          '42%':      { opacity: '0.7' },
          '43%':      { opacity: '1' },
          '45%':      { opacity: '0.5' },
          '46%':      { opacity: '1' },
        },
        pulseglow: {
          '0%, 100%': { textShadow: '0 0 8px #00ff88' },
          '50%':      { textShadow: '0 0 24px #00ff88, 0 0 48px #00ff88' },
        },
        scanline: {
          '0%':   { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        fadeup: {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        levelup: {
          '0%':   { opacity: '0', transform: 'scale(0.8) translateY(-20px)' },
          '20%':  { opacity: '1', transform: 'scale(1.1) translateY(0)' },
          '80%':  { opacity: '1', transform: 'scale(1) translateY(0)' },
          '100%': { opacity: '0', transform: 'scale(0.95) translateY(-10px)' },
        },
        hitflash: {
          '0%, 100%': { filter: 'none' },
          '50%':      { filter: 'brightness(3) saturate(0)' },
        },
      },
      animation: {
        flicker:  'flicker 4s infinite',
        pulseglow:'pulseglow 2s ease-in-out infinite',
        scanline: 'scanline 8s linear infinite',
        fadeup:   'fadeup 0.4s ease-out forwards',
        levelup:  'levelup 2s ease-in-out forwards',
        hitflash: 'hitflash 0.15s ease-in-out 3',
      },
      // ── Screens ───────────────────────────────────────────────────────
      screens: {
        xs: '375px',
      },
      // ── Border radius ─────────────────────────────────────────────────
      borderRadius: {
        game: '8px',
      },
    },
  },
  plugins: [
    // Utility plugin: text-shadow support via CSS vars
    function ({ addUtilities, theme }: { addUtilities: Function; theme: Function }) {
      const textShadows = theme('textShadow') as Record<string, string>
      const utilities = Object.entries(textShadows).reduce(
        (acc, [key, value]) => ({
          ...acc,
          [`.text-shadow-${key}`]: { textShadow: value },
        }),
        {}
      )
      addUtilities(utilities)
    },
  ],
}

export default config

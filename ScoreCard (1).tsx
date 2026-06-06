// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — emails/ScoreCard.tsx
// File 35 of 48
//
// Email 1 — Score Card (sent immediately after email capture at game over).
//
// Trigger: POST /api/email/capture succeeds
// Subject: `Your Palm Lazer score: {score} 🌴`
// Goal:    Deliver the score receipt, prime the play-again loop, surface
//          the share CTA so email capture converts to viral spread.
//
// Design:
//   Black canvas, neon aesthetic matching the game.
//   Press Start 2P for headings — loaded as web font via @font-face fallback
//   in email clients that support it; 'Courier New' monospace fallback for
//   Outlook / Gmail that strip custom fonts.
//   Score in yellow (#ffff00), city in cyan (#00eeff),
//   wordmark in green (#00ff88), CTAs in green.
//
// React Email component contract:
//   Props are all required — caller (route handler or preview) must supply them.
//   No defaults inside the component; they belong at the call site.
//
// Usage (in route handler or /emails/preview):
//   import { ScoreCard } from '@/emails/ScoreCard'
//   import { render }    from '@react-email/render'
//
//   const html = render(<ScoreCard
//     playerEmail="joe@example.com"
//     score={4200}
//     level={2}
//     city="NYC"
//     appUrl="https://palmlazer.app"
//     appName="Palm Lazer"
//   />)
//
// Architecture rules:
//   - No server-only imports (no supabase, no groq, no resend)
//   - No 'use client' directive — this is a server-rendered React component
//   - All URLs are absolute — email clients do not resolve relative paths
//   - Inline styles only — email clients strip <style> blocks unreliably
//   - Images avoided entirely — email clients block remote images by default;
//     the neon aesthetic is achieved with CSS borders and text only
// ═══════════════════════════════════════════════════════════════════════════

import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'

// ─────────────────────────────────────────────────────────────────────────────
// PROPS
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreCardProps {
  /** Final score for this session */
  score:        number
  /** Zero-indexed level reached (displayed as level + 1) */
  level:        number
  /** City name string e.g. 'Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza' */
  city:         string
  /** Absolute base URL e.g. 'https://palmlazer.app' — no trailing slash */
  appUrl:       string
  /** App display name e.g. 'Palm Lazer' */
  appName:      string
  /** Full play-again URL (built by caller with UTMs + session ref) */
  playAgainUrl: string
  /** Full share URL (built by caller with UTMs + session ref) */
  shareUrl:     string
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatScore(n: number): string {
  return n.toLocaleString('en-US')
}

/** Map city name → neon accent color for the city label line */
function cityAccent(city: string): string {
  const map: Record<string, string> = {
    miami: '#ff3aff',
    tokyo: '#ff006a',
    nyc:   '#ffcc00',
    dubai: '#ffaa00',
    ibiza: '#ff00aa',
  }
  return map[city.toLowerCase()] ?? '#00eeff'
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ScoreCard({
  score,
  level,
  city,
  appUrl,
  appName,
  playAgainUrl,
  shareUrl,
}: ScoreCardProps) {

  const previewText =
    `Your score: ${formatScore(score)} · ${city} · Level ${level + 1} 🌴`

  const accent = cityAccent(city)

  return (
    <Html lang="en" dir="ltr">
      <Head>
        {/*
          Attempt to load Press Start 2P for email clients that support
          web fonts (Apple Mail, some Android). Outlook and Gmail will
          fall back to the font-family stack defined on each element.
        */}
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        `}</style>
      </Head>

      <Preview>{previewText}</Preview>

      {/* ── Outer body ─────────────────────────────────────────────────── */}
      <Body style={styles.body}>
        <Container style={styles.container}>

          {/* ── Wordmark header ───────────────────────────────────────── */}
          <Section style={styles.header}>
            <Text style={styles.wordmark}>
              🌴 {appName.toUpperCase()}
            </Text>
          </Section>

          {/* ── Score hero ─────────────────────────────────────────────── */}
          <Section style={styles.heroSection}>
            <Text style={styles.yourScoreLabel}>YOUR SCORE</Text>

            <Text style={styles.scoreValue}>
              {formatScore(score)}
            </Text>

            <Text style={{ ...styles.cityLabel, color: accent }}>
              {city.toUpperCase()} · LEVEL {level + 1}
            </Text>
          </Section>

          <Hr style={styles.divider} />

          {/* ── Body copy + play again CTA ─────────────────────────────── */}
          <Section style={styles.bodySection}>
            <Text style={styles.bodyCopy}>
              The lazers are still firing.
              <br />
              Can you go further?
            </Text>

            <Button href={playAgainUrl} style={styles.ctaButton}>
              ► PLAY AGAIN
            </Button>
          </Section>

          {/* ── Share nudge ─────────────────────────────────────────────── */}
          <Section style={styles.shareSection}>
            <Text style={styles.shareLabel}>THINK YOUR FRIENDS CAN BEAT YOU?</Text>
            <Link href={shareUrl} style={styles.shareLink}>
              CHALLENGE A FRIEND →
            </Link>
          </Section>

          {/* ── Leaderboard teaser row ─────────────────────────────────── */}
          <Section style={styles.citiesRow}>
            <Row>
              {(['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza'] as const).map((c, i) => (
                <Column key={c} style={styles.cityCell}>
                  <Text
                    style={{
                      ...styles.cityChip,
                      ...(c === city ? styles.cityChipActive : {}),
                    }}
                  >
                    {c}
                  </Text>
                </Column>
              ))}
            </Row>
            <Text style={styles.citiesSub}>
              5 CITIES · INFINITE LAZERZ
            </Text>
          </Section>

          <Hr style={styles.divider} />

          {/* ── Controls reminder ──────────────────────────────────────── */}
          <Section style={styles.hintSection}>
            <Text style={styles.hintText}>
              KEYBOARD: ← → ARROWS &nbsp;·&nbsp; TOUCH: DRAG OR TAP
            </Text>
          </Section>

          {/* ── Footer ─────────────────────────────────────────────────── */}
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              © {new Date().getFullYear()} {appName} · Free to play in your browser.
              <br />
              You received this because you played. No spam, ever.
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// All values are plain React.CSSProperties objects — @react-email/components
// inlines these onto the rendered HTML elements.
// ─────────────────────────────────────────────────────────────────────────────

const FONT_PIXEL   = '"Press Start 2P", "Courier New", Courier, monospace'
const FONT_MONO    = '"Courier New", Courier, monospace'

const COLOR_GREEN   = '#00ff88'
const COLOR_YELLOW  = '#ffff00'
const COLOR_CYAN    = '#00eeff'
const COLOR_MAGENTA = '#ff00ff'
const COLOR_BG      = '#000000'
const COLOR_CARD    = '#05050f'
const COLOR_BORDER  = '#1a1a2e'
const COLOR_DIVIDER = '#0d0d1a'
const COLOR_MUTED   = '#444444'
const COLOR_DIM     = '#222222'

const styles: Record<string, React.CSSProperties> = {
  body: {
    backgroundColor: COLOR_BG,
    margin: 0,
    padding: '40px 0',
    fontFamily: FONT_MONO,
  },

  container: {
    maxWidth: '480px',
    margin: '0 auto',
    backgroundColor: COLOR_CARD,
    border: `1px solid ${COLOR_BORDER}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    backgroundColor: COLOR_BG,
    padding: '24px',
    textAlign: 'center',
    borderBottom: `1px solid ${COLOR_DIVIDER}`,
  },

  wordmark: {
    fontFamily: FONT_PIXEL,
    color: COLOR_GREEN,
    fontSize: '16px',
    fontWeight: 'bold',
    letterSpacing: '4px',
    margin: 0,
    textAlign: 'center',
  },

  // ── Score hero ───────────────────────────────────────────────────────────
  heroSection: {
    padding: '32px 32px 20px',
    textAlign: 'center',
  },

  yourScoreLabel: {
    fontFamily: FONT_PIXEL,
    color: COLOR_MUTED,
    fontSize: '9px',
    letterSpacing: '3px',
    margin: '0 0 12px',
    textAlign: 'center',
  },

  scoreValue: {
    fontFamily: FONT_PIXEL,
    color: COLOR_YELLOW,
    fontSize: '44px',
    fontWeight: 'bold',
    letterSpacing: '2px',
    lineHeight: '1',
    margin: '0 0 12px',
    textAlign: 'center',
  },

  cityLabel: {
    fontFamily: FONT_PIXEL,
    fontSize: '10px',
    letterSpacing: '3px',
    textTransform: 'uppercase' as const,
    margin: '0 0 4px',
    textAlign: 'center',
  },

  // ── Divider ──────────────────────────────────────────────────────────────
  divider: {
    borderColor: COLOR_DIVIDER,
    borderTopWidth: '1px',
    borderTopStyle: 'solid' as const,
    margin: '0 32px',
  },

  // ── Body / CTA section ───────────────────────────────────────────────────
  bodySection: {
    padding: '28px 32px',
    textAlign: 'center',
  },

  bodyCopy: {
    fontFamily: FONT_MONO,
    color: COLOR_MUTED,
    fontSize: '12px',
    lineHeight: '1.8',
    margin: '0 0 24px',
    textAlign: 'center',
  },

  ctaButton: {
    fontFamily: FONT_PIXEL,
    backgroundColor: 'transparent',
    border: `2px solid ${COLOR_GREEN}`,
    borderRadius: '0',
    color: COLOR_GREEN,
    fontSize: '10px',
    fontWeight: 'bold',
    letterSpacing: '2px',
    padding: '12px 28px',
    textDecoration: 'none',
    display: 'inline-block',
    textAlign: 'center',
  },

  // ── Share section ────────────────────────────────────────────────────────
  shareSection: {
    padding: '0 32px 24px',
    textAlign: 'center',
  },

  shareLabel: {
    fontFamily: FONT_PIXEL,
    color: COLOR_MUTED,
    fontSize: '7px',
    letterSpacing: '1px',
    margin: '0 0 8px',
    textAlign: 'center',
  },

  shareLink: {
    fontFamily: FONT_PIXEL,
    color: COLOR_MAGENTA,
    fontSize: '9px',
    letterSpacing: '1px',
    textDecoration: 'none',
  },

  // ── Cities row ───────────────────────────────────────────────────────────
  citiesRow: {
    padding: '0 32px 24px',
    textAlign: 'center',
  },

  cityCell: {
    textAlign: 'center',
    width: '20%',
    padding: '0 2px',
  },

  cityChip: {
    fontFamily: FONT_PIXEL,
    color: '#333',
    fontSize: '6px',
    letterSpacing: '0.5px',
    border: '1px solid #1a1a1a',
    padding: '4px 2px',
    margin: 0,
    textAlign: 'center',
    display: 'block',
  },

  cityChipActive: {
    color: COLOR_CYAN,
    border: `1px solid ${COLOR_CYAN}44`,
  },

  citiesSub: {
    fontFamily: FONT_PIXEL,
    color: '#2a2a2a',
    fontSize: '6px',
    letterSpacing: '1px',
    margin: '8px 0 0',
    textAlign: 'center',
  },

  // ── Controls hint ────────────────────────────────────────────────────────
  hintSection: {
    padding: '16px 32px',
    textAlign: 'center',
  },

  hintText: {
    fontFamily: FONT_PIXEL,
    color: '#2a2a2a',
    fontSize: '6px',
    letterSpacing: '0.5px',
    lineHeight: '2',
    margin: 0,
    textAlign: 'center',
  },

  // ── Footer ───────────────────────────────────────────────────────────────
  footer: {
    backgroundColor: COLOR_BG,
    padding: '16px',
    textAlign: 'center',
    borderTop: `1px solid ${COLOR_DIVIDER}`,
  },

  footerText: {
    fontFamily: FONT_MONO,
    color: COLOR_DIM,
    fontSize: '9px',
    letterSpacing: '0.5px',
    lineHeight: '1.8',
    margin: 0,
    textAlign: 'center',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT EXPORT — React Email preview tooling expects a default export
// ─────────────────────────────────────────────────────────────────────────────

export default ScoreCard

// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — emails/GameInvite.tsx
// File 36 of 48
//
// Email 2 — Game Invite (viral share, sent when a player taps "Send to friend").
//
// Trigger: POST /api/share/email succeeds → Resend.send({ html: render(<GameInvite />) })
// Subject: `{senderLabel} challenged you to Palm Lazer 🌴⚡`
// Goal:    Convert one player's friend into a new player with full attribution.
//          This is the viral loop. One send = one potential new session with
//          utm_source='email_share' and the sender's session_id in utm_content.
//
// Attribution chain:
//   Sender plays → taps "Send to friend" → enters recipient email
//   → POST /api/share/email
//   → Resend sends this template
//   → email_shares row inserted with resend_message_id
//   → Resend webhook (email.opened, email.clicked) updates email_shares
//   → Recipient clicks → new session with utm_source='email_share'
//   → email_shares.recipient_session_id linked (handled by GameShell on load)
//
// Design:
//   Challenger framing — "CHALLENGE INCOMING" header, sender's score as the
//   benchmark, single CTA: "ACCEPT THE CHALLENGE".
//   Same black/neon aesthetic as ScoreCard but with adversarial energy.
//   Score in yellow, sender identity in magenta, CTA in green.
//
// Props contract:
//   All required — defaults at call site in /api/share/email/route.ts.
//
// Architecture rules:
//   - No server-only imports (no supabase, no groq, no resend)
//   - No 'use client' directive
//   - All URLs absolute
//   - Inline styles only
//   - No remote images
// ═══════════════════════════════════════════════════════════════════════════

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

// ─────────────────────────────────────────────────────────────────────────────
// PROPS
// ─────────────────────────────────────────────────────────────────────────────

export interface GameInviteProps {
  /** Sender's final score — the benchmark the recipient must beat */
  score:      number
  /** Zero-indexed level the sender reached (displayed as level + 1) */
  level:      number
  /** City the sender reached e.g. 'Miami', 'NYC', 'Dubai' */
  city:       string
  /** Absolute base URL e.g. 'https://palmlazer.app' — no trailing slash */
  appUrl:     string
  /** App display name e.g. 'Palm Lazer' */
  appName:    string
  /**
   * Full play URL with attribution UTMs for the recipient.
   * Built by /api/share/email: includes utm_source=email_share,
   * utm_content={sender_session_id} for full chain attribution.
   */
  playUrl:    string
  /** Secondary share link (e.g. public share page for this session) */
  shareUrl:   string
  /**
   * Sender's email address for display ("john" from "john@example.com").
   * undefined if sender did not capture email — falls back to generic label.
   */
  fromEmail:  string | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatScore(n: number): string {
  return n.toLocaleString('en-US')
}

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

export function GameInvite({
  score,
  level,
  city,
  appUrl,
  appName,
  playUrl,
  shareUrl,
  fromEmail,
}: GameInviteProps) {
  // Derive display label from fromEmail, or fall back to generic
  const senderLabel = fromEmail
    ? fromEmail.split('@')[0]
    : `A ${appName} player`

  const previewText =
    `${senderLabel} scored ${formatScore(score)} on ${appName}. Can you beat them?`

  const accent = cityAccent(city)

  // Leaderboard teaser: what's the next city after where the sender stopped?
  const CITIES = ['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza'] as const
  const senderCityIndex = CITIES.findIndex(
    c => c.toLowerCase() === city.toLowerCase(),
  )
  const nextCity =
    senderCityIndex >= 0 && senderCityIndex < CITIES.length - 1
      ? CITIES[senderCityIndex + 1]
      : null

  return (
    <Html lang="en" dir="ltr">
      <Head>
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

          {/* ── Challenge banner ─────────────────────────────────────── */}
          <Section style={styles.challengeBanner}>
            <Text style={styles.challengeLabel}>
              ⚡ CHALLENGE INCOMING ⚡
            </Text>
          </Section>

          {/* ── Sender identity ──────────────────────────────────────── */}
          <Section style={styles.senderSection}>
            <Text style={styles.senderIntro}>
              {senderLabel} just survived the lazers and scored:
            </Text>
          </Section>

          {/* ── Score hero ─────────────────────────────────────────────── */}
          <Section style={styles.heroSection}>
            <Text style={styles.scoreValue}>
              {formatScore(score)}
            </Text>

            <Text style={{ ...styles.cityLabel, color: accent }}>
              {city.toUpperCase()} · LEVEL {level + 1}
            </Text>
          </Section>

          <Hr style={styles.divider} />

          {/* ── Challenge copy ───────────────────────────────────────── */}
          <Section style={styles.bodySection}>
            <Text style={styles.bodyCopy}>
              Dodge lazers across Miami, Tokyo, NYC, Dubai &amp; Ibiza.
              <br />
              One mechanic. Zero mercy.
              <br />
              <br />
              Can you beat {senderLabel}?
            </Text>

            {nextCity && (
              <Text style={styles.nextCityTeaser}>
                They didn&apos;t make it to {nextCity}.
                <br />
                <span style={{ color: '#00eeff' }}>Maybe you can.</span>
              </Text>
            )}

            <Button href={playUrl} style={styles.ctaButton}>
              ► ACCEPT THE CHALLENGE
            </Button>
          </Section>

          {/* ── City trail ───────────────────────────────────────────── */}
          <Section style={styles.trailSection}>
            <Text style={styles.trailLabel}>THE ROUTE</Text>
            <Text style={styles.trailCities}>
              {CITIES.map((c, i) => {
                const isReached  = i <= senderCityIndex
                const isCurrent  = i === senderCityIndex
                const isNext     = i === senderCityIndex + 1
                return (
                  <span
                    key={c}
                    style={{
                      color:      isCurrent ? accent : isReached ? '#444' : isNext ? '#00eeff88' : '#1a1a1a',
                      fontWeight: isCurrent ? 'bold' : 'normal',
                    }}
                  >
                    {c}{i < CITIES.length - 1 ? ' → ' : ''}
                  </span>
                )
              })}
            </Text>
            <Text style={styles.trailSub}>
              {senderLabel.toUpperCase()} STOPPED AT {city.toUpperCase()}
            </Text>
          </Section>

          <Hr style={styles.divider} />

          {/* ── Controls hint ────────────────────────────────────────── */}
          <Section style={styles.hintSection}>
            <Text style={styles.hintText}>
              KEYBOARD: ← → ARROWS &nbsp;·&nbsp; TOUCH: DRAG OR TAP LEFT / RIGHT
            </Text>
            <Text style={styles.hintSubText}>
              Free to play · No account required · Plays in your browser
            </Text>
          </Section>

          {/* ── Secondary share link ─────────────────────────────── */}
          <Section style={styles.shareLinkSection}>
            <Link href={shareUrl} style={styles.secondaryShareLink}>
              VIEW SCORE PAGE →
            </Link>
          </Section>

          {/* ── Footer ───────────────────────────────────────────────── */}
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              © {new Date().getFullYear()} {appName} · Free to play in your browser.
              <br />
              Sent because {senderLabel} wanted you to play.
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const FONT_PIXEL = '"Press Start 2P", "Courier New", Courier, monospace'
const FONT_MONO  = '"Courier New", Courier, monospace'

const COLOR_GREEN   = '#00ff88'
const COLOR_YELLOW  = '#ffff00'
const COLOR_MAGENTA = '#ff00ff'
const COLOR_BG      = '#000000'
const COLOR_CARD    = '#05050f'
const COLOR_BORDER  = '#1a1a2e'
const COLOR_DIVIDER = '#0d0d1a'
const COLOR_MUTED   = '#666666'
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

  // ── Challenge banner ─────────────────────────────────────────────────────
  challengeBanner: {
    backgroundColor: '#0a000a',
    padding: '14px 32px',
    textAlign: 'center',
    borderBottom: `1px solid ${COLOR_MAGENTA}33`,
  },

  challengeLabel: {
    fontFamily: FONT_PIXEL,
    color: COLOR_MAGENTA,
    fontSize: '10px',
    letterSpacing: '3px',
    margin: 0,
    textAlign: 'center',
  },

  // ── Sender section ───────────────────────────────────────────────────────
  senderSection: {
    padding: '28px 32px 8px',
    textAlign: 'center',
  },

  senderIntro: {
    fontFamily: FONT_MONO,
    color: COLOR_MUTED,
    fontSize: '12px',
    lineHeight: '1.8',
    margin: 0,
    textAlign: 'center',
  },

  // ── Score hero ───────────────────────────────────────────────────────────
  heroSection: {
    padding: '16px 32px 20px',
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
    lineHeight: '1.9',
    margin: '0 0 20px',
    textAlign: 'center',
  },

  nextCityTeaser: {
    fontFamily: FONT_PIXEL,
    color: '#555',
    fontSize: '8px',
    lineHeight: '2',
    letterSpacing: '0.5px',
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
    padding: '12px 24px',
    textDecoration: 'none',
    display: 'inline-block',
    textAlign: 'center',
  },

  // ── City trail ───────────────────────────────────────────────────────────
  trailSection: {
    padding: '20px 32px 24px',
    textAlign: 'center',
  },

  trailLabel: {
    fontFamily: FONT_PIXEL,
    color: '#2a2a2a',
    fontSize: '7px',
    letterSpacing: '2px',
    margin: '0 0 10px',
    textAlign: 'center',
  },

  trailCities: {
    fontFamily: FONT_PIXEL,
    fontSize: '8px',
    letterSpacing: '1px',
    margin: '0 0 8px',
    textAlign: 'center',
    lineHeight: '1.8',
  },

  trailSub: {
    fontFamily: FONT_PIXEL,
    color: '#2a2a2a',
    fontSize: '6px',
    letterSpacing: '1px',
    margin: '6px 0 0',
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
    margin: '0 0 6px',
    textAlign: 'center',
  },

  hintSubText: {
    fontFamily: FONT_MONO,
    color: '#1a1a1a',
    fontSize: '9px',
    letterSpacing: '0.5px',
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
  // ── Secondary share link ────────────────────────────────────────────────
  shareLinkSection: {
    padding: '0 32px 20px',
    textAlign: 'center' as const,
  },

  secondaryShareLink: {
    fontFamily: FONT_PIXEL,
    color: '#333333',
    fontSize: '7px',
    letterSpacing: '1px',
    textDecoration: 'none',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT EXPORT — React Email preview tooling expects a default export
// ─────────────────────────────────────────────────────────────────────────────

export default GameInvite

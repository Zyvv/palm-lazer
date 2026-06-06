// emails/ZyvvBridge.tsx
// File 38 of 48
// Email 4 — ZYVV Bridge. Sent 48h after game over to players who reached level 3+
// and have a captured email.
// Trigger: cron daily-analysis → lib/resend/triggers.ts → sendZyvvBridgeEmail()
// Condition: max_level_reached >= 3 AND email captured AND zyvv_converted = false

import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

export interface ZyvvBridgeProps {
  score:          number
  level:          number
  city:           string
  zyvvUrl:        string
  appUrl:         string
  appName:        string
  sessionId:      string
}

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

const CITIES = ['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza'] as const

export function ZyvvBridge({
  score,
  level,
  city,
  zyvvUrl,
  appUrl,
  appName,
  sessionId,
}: ZyvvBridgeProps) {
  const accent      = cityAccent(city)
  const cityIndex   = CITIES.findIndex(c => c.toLowerCase() === city.toLowerCase())
  const previewText = `You survived ${city}. Something harder is waiting.`

  // Append session attribution to ZYVV URL so the bridge is trackable
  const bridgeUrl = `${zyvvUrl}?ref=palm_lazer&sid=${encodeURIComponent(sessionId)}&utm_source=palm_lazer&utm_medium=email&utm_campaign=zyvv_bridge`

  const FONT_PIXEL = '"Press Start 2P", "Courier New", Courier, monospace'
  const FONT_MONO  = '"Courier New", Courier, monospace'

  return (
    <Html lang="en" dir="ltr">
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');`}</style>
      </Head>

      <Preview>{previewText}</Preview>

      <Body style={{ backgroundColor: '#000000', margin: 0, padding: '40px 0', fontFamily: FONT_MONO }}>
        <Container style={{ maxWidth: '480px', margin: '0 auto', backgroundColor: '#05050f', border: '1px solid #1a1a2e', borderRadius: '8px', overflow: 'hidden' }}>

          {/* Wordmark */}
          <Section style={{ backgroundColor: '#000', padding: '24px', textAlign: 'center', borderBottom: '1px solid #0d0d1a' }}>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#00ff88', fontSize: '16px', letterSpacing: '4px', margin: 0, textAlign: 'center' }}>
              🌴 {appName.toUpperCase()}
            </Text>
          </Section>

          {/* Hook — level 3+ players get a different opener */}
          <Section style={{ padding: '36px 32px 8px', textAlign: 'center' }}>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#00eeff', fontSize: '9px', letterSpacing: '3px', margin: '0 0 20px', textAlign: 'center' }}>
              YOU MADE IT TO {city.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: FONT_MONO, color: '#666', fontSize: '12px', lineHeight: '2', margin: 0, textAlign: 'center' }}>
              Most players don't get past Miami.<br />
              You reached level {level + 1}.<br />
              That puts you in the top tier.
            </Text>
          </Section>

          {/* Score */}
          <Section style={{ padding: '24px 32px', textAlign: 'center' }}>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#ffff00', fontSize: '44px', fontWeight: 'bold', letterSpacing: '2px', lineHeight: '1', margin: '0 0 10px', textAlign: 'center' }}>
              {formatScore(score)}
            </Text>
            <Text style={{ fontFamily: FONT_PIXEL, color: accent, fontSize: '10px', letterSpacing: '3px', margin: 0, textAlign: 'center' }}>
              {city.toUpperCase()} · LEVEL {level + 1}
            </Text>
          </Section>

          <Hr style={{ borderColor: '#0d0d1a', margin: '0 32px' }} />

          {/* ZYVV reveal */}
          <Section style={{ padding: '32px 32px 12px', textAlign: 'center' }}>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#ff00ff', fontSize: '10px', letterSpacing: '3px', margin: '0 0 20px', textAlign: 'center' }}>
              ⚡ SOMETHING IS WAITING ⚡
            </Text>
            <Text style={{ fontFamily: FONT_MONO, color: '#555', fontSize: '12px', lineHeight: '2', margin: '0 0 10px', textAlign: 'center' }}>
              {appName} was the warm-up.
            </Text>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#00eeff', fontSize: '9px', letterSpacing: '2px', lineHeight: '2.2', margin: '0 0 24px', textAlign: 'center' }}>
              ZYVV is what comes next.<br />
              <span style={{ color: '#333' }}>Access is limited. You qualified.</span>
            </Text>

            <Button
              href={bridgeUrl}
              style={{
                fontFamily: FONT_PIXEL,
                backgroundColor: 'transparent',
                border: '2px solid #00eeff',
                borderRadius: '0',
                color: '#00eeff',
                fontSize: '10px',
                fontWeight: 'bold',
                letterSpacing: '2px',
                padding: '14px 28px',
                textDecoration: 'none',
                display: 'inline-block',
                textAlign: 'center',
              }}
            >
              ► ENTER ZYVV
            </Button>
          </Section>

          {/* What is ZYVV — intentionally vague, curiosity-driven */}
          <Section style={{ padding: '24px 32px', textAlign: 'center' }}>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#1a1a1a', fontSize: '6px', letterSpacing: '1px', lineHeight: '2.5', margin: 0, textAlign: 'center' }}>
              SAME UNIVERSE · DIFFERENT RULES · NO MERCY
            </Text>
          </Section>

          <Hr style={{ borderColor: '#0d0d1a', margin: '0 32px' }} />

          {/* City trail — shows player's achievement before the bridge ask */}
          <Section style={{ padding: '20px 32px 24px', textAlign: 'center' }}>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#2a2a2a', fontSize: '7px', letterSpacing: '2px', margin: '0 0 10px', textAlign: 'center' }}>
              YOUR ROUTE IN {appName.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: FONT_PIXEL, fontSize: '8px', letterSpacing: '1px', margin: 0, textAlign: 'center', lineHeight: '1.8' }}>
              {CITIES.map((c, i) => (
                <span key={c} style={{ color: i < cityIndex ? '#333' : i === cityIndex ? accent : '#111' }}>
                  {c}{i < CITIES.length - 1 ? ' → ' : ''}
                </span>
              ))}
            </Text>
          </Section>

          {/* Footer */}
          <Section style={{ backgroundColor: '#000', padding: '16px', textAlign: 'center', borderTop: '1px solid #0d0d1a' }}>
            <Text style={{ fontFamily: FONT_MONO, color: '#1a1a1a', fontSize: '9px', lineHeight: '1.8', margin: 0, textAlign: 'center' }}>
              © {new Date().getFullYear()} {appName} · You earned this because you reached level {level + 1}.<br />
              <a href={`${appUrl}/unsubscribe`} style={{ color: '#222', textDecoration: 'underline' }}>Unsubscribe</a>
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  )
}

export default ZyvvBridge

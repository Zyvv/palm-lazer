// emails/RetentionD2.tsx
// File 37 of 48
// Email 3 — Day-2 Retention. Sent 24h after game over if player has not returned.
// Trigger: cron daily-analysis → lib/resend/triggers.ts → sendRetentionEmail()

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

export interface RetentionD2Props {
  score:        number
  level:        number
  city:         string
  playAgainUrl: string
  appUrl:       string
  appName:      string
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

export function RetentionD2({
  score,
  level,
  city,
  playAgainUrl,
  appUrl,
  appName,
}: RetentionD2Props) {
  const accent        = cityAccent(city)
  const cityIndex     = CITIES.findIndex(c => c.toLowerCase() === city.toLowerCase())
  const nextCity      = cityIndex >= 0 && cityIndex < CITIES.length - 1 ? CITIES[cityIndex + 1] : null
  const previewText   = `The lazers are still waiting. Your score: ${formatScore(score)}`

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

          {/* Hook */}
          <Section style={{ padding: '32px 32px 8px', textAlign: 'center' }}>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#ff00ff', fontSize: '10px', letterSpacing: '2px', margin: '0 0 16px', textAlign: 'center' }}>
              THE LAZERS MISS YOU
            </Text>
            <Text style={{ fontFamily: FONT_MONO, color: '#666', fontSize: '12px', lineHeight: '1.9', margin: 0, textAlign: 'center' }}>
              You left {city} standing yesterday.<br />
              Your score is still on the board.
            </Text>
          </Section>

          {/* Score */}
          <Section style={{ padding: '20px 32px', textAlign: 'center' }}>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#ffff00', fontSize: '44px', fontWeight: 'bold', letterSpacing: '2px', lineHeight: '1', margin: '0 0 10px', textAlign: 'center' }}>
              {formatScore(score)}
            </Text>
            <Text style={{ fontFamily: FONT_PIXEL, color: accent, fontSize: '10px', letterSpacing: '3px', margin: 0, textAlign: 'center' }}>
              {city.toUpperCase()} · LEVEL {level + 1}
            </Text>
          </Section>

          <Hr style={{ borderColor: '#0d0d1a', margin: '0 32px' }} />

          {/* Next city tease */}
          <Section style={{ padding: '28px 32px', textAlign: 'center' }}>
            {nextCity ? (
              <Text style={{ fontFamily: FONT_PIXEL, color: '#333', fontSize: '8px', lineHeight: '2.2', letterSpacing: '0.5px', margin: '0 0 24px', textAlign: 'center' }}>
                You never made it to{' '}
                <span style={{ color: '#00eeff' }}>{nextCity.toUpperCase()}</span>.<br />
                The lazers there are faster.
              </Text>
            ) : (
              <Text style={{ fontFamily: FONT_PIXEL, color: '#333', fontSize: '8px', lineHeight: '2.2', letterSpacing: '0.5px', margin: '0 0 24px', textAlign: 'center' }}>
                You reached the final city.<br />
                <span style={{ color: '#00eeff' }}>Can you beat your own score?</span>
              </Text>
            )}

            <Button href={playAgainUrl} style={{ fontFamily: FONT_PIXEL, backgroundColor: 'transparent', border: '2px solid #00ff88', borderRadius: '0', color: '#00ff88', fontSize: '10px', fontWeight: 'bold', letterSpacing: '2px', padding: '12px 24px', textDecoration: 'none', display: 'inline-block', textAlign: 'center' }}>
              ► PLAY AGAIN
            </Button>
          </Section>

          <Hr style={{ borderColor: '#0d0d1a', margin: '0 32px' }} />

          {/* City trail */}
          <Section style={{ padding: '20px 32px 24px', textAlign: 'center' }}>
            <Text style={{ fontFamily: FONT_PIXEL, color: '#2a2a2a', fontSize: '7px', letterSpacing: '2px', margin: '0 0 10px', textAlign: 'center' }}>
              YOUR ROUTE
            </Text>
            <Text style={{ fontFamily: FONT_PIXEL, fontSize: '8px', letterSpacing: '1px', margin: 0, textAlign: 'center', lineHeight: '1.8' }}>
              {CITIES.map((c, i) => (
                <span key={c} style={{ color: i < cityIndex ? '#333' : i === cityIndex ? accent : '#1a1a1a' }}>
                  {c}{i < CITIES.length - 1 ? ' → ' : ''}
                </span>
              ))}
            </Text>
          </Section>

          {/* Footer */}
          <Section style={{ backgroundColor: '#000', padding: '16px', textAlign: 'center', borderTop: '1px solid #0d0d1a' }}>
            <Text style={{ fontFamily: FONT_MONO, color: '#1a1a1a', fontSize: '9px', lineHeight: '1.8', margin: 0, textAlign: 'center' }}>
              © {new Date().getFullYear()} {appName} · Free to play in your browser.<br />
              <a href={`${appUrl}/unsubscribe`} style={{ color: '#222', textDecoration: 'underline' }}>Unsubscribe</a>
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  )
}

export default RetentionD2

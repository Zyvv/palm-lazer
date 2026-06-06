// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/email/capture/route.ts
// File 27 of 48
//
// POST /api/email/capture
//
// Called by EmailCapture.tsx when the user submits their email after game over.
//
// Responsibilities:
//   1. Validate and normalise the email address
//   2. Upsert email onto the session row (idempotent — retry-safe)
//   3. Insert into email_leads table for cross-product CRM
//   4. Send Email 1 — score card — via Resend (fire-and-forget, not awaited)
//   5. Return { ok: true } — client advances to ShareBar
//
// Email scheduling:
//   Email 1 (score card):       sent immediately via Resend
//   Email 3 (day-2 retention):  scheduled via Resend's scheduledAt param, 22h out
//   Email 4 (ZYVV bridge):      scheduled at 48h IF max_level_reached >= 3
//                                (ZYVV_BRIDGE_MIN_LEVEL from GAME_CONSTANTS)
//
// Rules:
//   - Resend errors are swallowed — email failure must never fail this route
//   - Duplicate email submissions for same session are idempotent
//   - RESEND_API_KEY absence degrades gracefully (DB write still succeeds)
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServerClient } from '@/lib/supabase/server'
import { GAME_CONSTANTS } from '@/lib/game/cities'
import type { EmailCaptureRequest, EmailCaptureResponse } from '@/lib/game/types'

const APP_URL      = process.env.NEXT_PUBLIC_APP_URL  ?? 'https://palmgalaxy.app'
const FROM_EMAIL   = process.env.RESEND_FROM_EMAIL    ?? 'play@palmgalaxy.app'
const APP_NAME     = process.env.NEXT_PUBLIC_APP_NAME ?? 'Palm Galaxy'

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL HELPERS — inline HTML (no React Email dependency at runtime here)
// React Email templates live in /emails/ and are imported by dedicated send
// routes. This route uses inline HTML to keep the critical path fast.
// ─────────────────────────────────────────────────────────────────────────────

function buildScoreCardHtml(email: string, score: number, level: number, city: string): string {
  const playAgainUrl = `${APP_URL}/?utm_source=email&utm_campaign=score_card&utm_content=${encodeURIComponent(email)}`
  const shareUrl     = `${APP_URL}/?utm_source=email_share`

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your Palm Galaxy Score</title>
</head>
<body style="margin:0;padding:0;background:#000;font-family:'Courier New',monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#05050f;border:1px solid #1a1a2e;border-radius:8px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#000;padding:24px;text-align:center;border-bottom:1px solid #0d0d1a;">
              <div style="font-family:'Courier New',monospace;color:#00ff88;font-size:18px;font-weight:bold;letter-spacing:4px;text-shadow:0 0 10px #00ff88;">
                🌴 ${APP_NAME.toUpperCase()}
              </div>
            </td>
          </tr>

          <!-- Score -->
          <tr>
            <td style="padding:32px 32px 16px;text-align:center;">
              <div style="color:#888;font-size:10px;letter-spacing:3px;margin-bottom:8px;">YOUR SCORE</div>
              <div style="color:#ffff00;font-size:48px;font-weight:bold;letter-spacing:2px;line-height:1;">
                ${score.toLocaleString()}
              </div>
              <div style="color:#00eeff;font-size:11px;letter-spacing:3px;margin-top:10px;text-transform:uppercase;">
                ${city} · LEVEL ${level + 1}
              </div>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #1a1a2e;" />
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:24px 32px;text-align:center;">
              <p style="color:#666;font-size:11px;line-height:1.8;margin:0 0 20px;">
                The lasers are still firing. Can you go further?
              </p>
              <a href="${playAgainUrl}"
                 style="display:inline-block;background:none;border:2px solid #00ff88;color:#00ff88;
                        padding:12px 28px;font-family:'Courier New',monospace;font-size:11px;
                        font-weight:bold;letter-spacing:2px;text-decoration:none;
                        text-shadow:0 0 8px #00ff88;">
                ► PLAY AGAIN
              </a>
            </td>
          </tr>

          <!-- Share -->
          <tr>
            <td style="padding:0 32px 24px;text-align:center;">
              <a href="${shareUrl}"
                 style="color:#ff00ff;font-size:10px;letter-spacing:1px;text-decoration:none;
                        font-family:'Courier New',monospace;">
                CHALLENGE A FRIEND →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#000;padding:16px;text-align:center;border-top:1px solid #0d0d1a;">
              <div style="color:#222;font-size:9px;letter-spacing:1px;">
                © ${new Date().getFullYear()} ${APP_NAME} · You're receiving this because you played.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim()
}

function buildRetentionHtml(email: string, score: number): string {
  const targetScore  = Math.round(score * 1.1)
  const playAgainUrl = `${APP_URL}/?utm_source=email&utm_campaign=retention_d2&utm_content=${encodeURIComponent(email)}`

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>Can you beat your score?</title></head>
<body style="margin:0;padding:0;background:#000;font-family:'Courier New',monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#05050f;border:1px solid #1a1a2e;border-radius:8px;">
          <tr>
            <td style="padding:32px;text-align:center;">
              <div style="color:#00ff88;font-size:14px;letter-spacing:4px;margin-bottom:16px;">🌴 ${APP_NAME.toUpperCase()}</div>
              <div style="color:#ffff00;font-size:36px;font-weight:bold;margin-bottom:8px;">${targetScore.toLocaleString()}</div>
              <div style="color:#888;font-size:10px;letter-spacing:2px;margin-bottom:24px;">THAT'S YOUR TARGET</div>
              <p style="color:#666;font-size:11px;line-height:1.8;margin:0 0 24px;">
                Yesterday you scored ${score.toLocaleString()}.<br />
                Beat that by 10% today. The lasers are ready.
              </p>
              <a href="${playAgainUrl}"
                 style="display:inline-block;background:none;border:2px solid #ffff00;color:#ffff00;
                        padding:12px 28px;font-family:'Courier New',monospace;font-size:11px;
                        letter-spacing:2px;text-decoration:none;">
                ► BEAT MY SCORE
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px;text-align:center;border-top:1px solid #0d0d1a;">
              <div style="color:#1a1a1a;font-size:9px;">© ${new Date().getFullYear()} ${APP_NAME}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim()
}

function buildZyvvBridgeHtml(email: string, level: number, city: string): string {
  const zyvvUrl = `${APP_URL}/?utm_source=email&utm_campaign=zyvv_bridge&utm_content=${encodeURIComponent(email)}`

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>You've been dodging lasers. Now dodge something bigger.</title></head>
<body style="margin:0;padding:0;background:#000;font-family:'Courier New',monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#05050f;border:1px solid #1a1a2e;border-radius:8px;">
          <tr>
            <td style="padding:32px;text-align:center;">
              <div style="color:#00ff88;font-size:14px;letter-spacing:4px;margin-bottom:16px;">🌴 ${APP_NAME.toUpperCase()}</div>
              <div style="color:#fff;font-size:16px;letter-spacing:2px;line-height:1.6;margin-bottom:20px;">
                You've been dodging lasers.<br />
                Now dodge something bigger.
              </div>
              <div style="color:#00eeff;font-size:10px;letter-spacing:3px;margin-bottom:24px;text-transform:uppercase;">
                You reached ${city} · Level ${level + 1}
              </div>
              <p style="color:#666;font-size:11px;line-height:1.9;margin:0 0 28px;">
                You proved you can handle pressure.<br />
                There's something being built for people like you.<br />
                Same energy. Higher stakes.
              </p>
              <a href="${zyvvUrl}"
                 style="display:inline-block;background:none;border:2px solid #ff00ff;color:#ff00ff;
                        padding:12px 28px;font-family:'Courier New',monospace;font-size:11px;
                        letter-spacing:2px;text-decoration:none;">
                SEE WHAT'S NEXT →
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px;text-align:center;border-top:1px solid #0d0d1a;">
              <div style="color:#1a1a1a;font-size:9px;">© ${new Date().getFullYear()} ${APP_NAME} · Unsubscribe at any time.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: EmailCaptureRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── Validate ───────────────────────────────────────────────────────────────
  const email   = (body.email ?? '').trim().toLowerCase()
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!email || !emailRe.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  if (typeof body.session_id !== 'string' || !body.session_id) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
  }

  const { session_id, trigger, score, level, city } = body
  const supabase = createServerClient()
  const now      = new Date().toISOString()

  try {
    // ── 1. Upsert email onto session row ──────────────────────────────────
    const { error: sessionError } = await supabase
      .from('sessions')
      .update({
        email,
        email_captured_at:     now,
        email_capture_trigger: trigger ?? 'game_over',
      })
      .eq('id', session_id)
      .is('email', null)   // idempotent — only write if not already captured

    if (sessionError) {
      console.error('[email/capture] Session update error:', sessionError.message)
    }

    // ── 2. Insert into email_leads ─────────────────────────────────────────
    await supabase
      .from('email_leads')
      .insert({
        session_id,
        email,
        capture_trigger: trigger ?? 'game_over',
        score:           score  ?? null,
        level:           level  ?? null,
        city:            city   ?? null,
        product_source:  process.env.NEXT_PUBLIC_PRODUCT_SOURCE ?? 'palm_galaxy',
        created_at:      now,
      })
      .then(({ error }) => {
        // Duplicate email inserts are fine — email_leads is a log, not a unique set
        if (error && !error.message.includes('duplicate')) {
          console.error('[email/capture] email_leads insert error:', error.message)
        }
      })

    // ── 3. Send emails via Resend — fire-and-forget ────────────────────────
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const resend = new Resend(resendKey)

      // Email 1 — Score card (immediate)
      resend.emails.send({
        from:    FROM_EMAIL,
        to:      email,
        subject: `Your ${APP_NAME} score: ${(score ?? 0).toLocaleString()} 🌴`,
        html:    buildScoreCardHtml(email, score ?? 0, level ?? 0, city ?? 'Miami'),
      }).catch(err => console.error('[email/capture] Score card send error:', err))

      // Email 3 — Day-2 retention (22h)
      const d2At = new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString()
      resend.emails.send({
        from:       FROM_EMAIL,
        to:         email,
        subject:    `Can you beat ${Math.round((score ?? 0) * 1.1).toLocaleString()}? 🎯`,
        html:       buildRetentionHtml(email, score ?? 0),
        scheduledAt: d2At,
      }).catch(err => console.error('[email/capture] Retention email schedule error:', err))

      // Email 4 — ZYVV bridge (48h) — only if player reached level 3+
      if ((level ?? 0) >= GAME_CONSTANTS.ZYVV_BRIDGE_MIN_LEVEL) {
        const bridgeAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
        resend.emails.send({
          from:        FROM_EMAIL,
          to:          email,
          subject:     `You've been dodging lasers. Now dodge something bigger.`,
          html:        buildZyvvBridgeHtml(email, level ?? 0, city ?? 'Dubai'),
          scheduledAt: bridgeAt,
        })
        .then(() => {
          // Mark zyvv_bridge_sent on the session
          supabase
            .from('sessions')
            .update({ zyvv_bridge_sent: true, zyvv_bridge_sent_at: new Date().toISOString() })
            .eq('id', session_id)
            .then(({ error }) => {
              if (error) console.error('[email/capture] zyvv_bridge flag error:', error.message)
            })
        })
        .catch(err => console.error('[email/capture] ZYVV bridge email error:', err))
      }
    }

    const response: EmailCaptureResponse = {
      ok:      true,
      message: 'Email captured',
    }

    return NextResponse.json(response, { status: 200 })

  } catch (err) {
    console.error('[email/capture] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' } as EmailCaptureResponse,
      { status: 500 },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

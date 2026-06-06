// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/share/email/route.ts
// File 28 of 48
//
// POST /api/share/email
//
// Called by ShareBar.tsx when a player sends the game to a friend.
// This is the viral loop: one player → one friend → full attribution chain.
//
// Responsibilities:
//   1. Validate recipient_email
//   2. Resolve sender_email from the session row (player may not have
//      provided it yet — sender_email field in body is optional)
//   3. Insert a row into email_shares (resend_message_id stored for webhooks)
//   4. Send the invite via Resend
//   5. Return { ok: true, resend_message_id }
//
// Attribution chain:
//   email_shares.session_id        → sending session
//   email_shares.resend_message_id → Resend delivery ID
//   /api/webhooks/resend            → sets opened_at, clicked_at
//   recipient plays                 → new session with utm_source='email_share'
//   GameShell links                 → email_shares.recipient_session_id set
//
// Rules:
//   - Resend errors return 500 with { ok: false } — client shows retry message
//   - Duplicate sends (same session + recipient) are allowed — friends can
//     be re-invited; email_shares is an append-only log
//   - sender_email is best-effort; NULL is fine in email_shares
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServerClient } from '@/lib/supabase/server'
import type { ShareEmailRequest, ShareEmailResponse } from '@/lib/game/types'

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL  ?? 'https://palmgalaxy.app'
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL    ?? 'play@palmgalaxy.app'
const APP_NAME   = process.env.NEXT_PUBLIC_APP_NAME ?? 'Palm Galaxy'

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL TEMPLATE — game invite
// ─────────────────────────────────────────────────────────────────────────────

function buildInviteHtml(
  senderLabel: string,
  score:       number,
  level:       number,
  city:        string,
  inviteUrl:   string,
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Someone challenged you to ${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#000;font-family:'Courier New',monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
               style="background:#05050f;border:1px solid #1a1a2e;border-radius:8px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#000;padding:24px;text-align:center;border-bottom:1px solid #0d0d1a;">
              <div style="color:#00ff88;font-size:18px;font-weight:bold;letter-spacing:4px;">
                🌴 ${APP_NAME.toUpperCase()}
              </div>
            </td>
          </tr>

          <!-- Challenge -->
          <tr>
            <td style="padding:32px 32px 16px;text-align:center;">
              <div style="color:#ff00ff;font-size:11px;letter-spacing:3px;margin-bottom:16px;">
                CHALLENGE INCOMING
              </div>
              <p style="color:#aaa;font-size:12px;line-height:1.8;margin:0 0 20px;">
                ${senderLabel} scored
              </p>
              <div style="color:#ffff00;font-size:48px;font-weight:bold;letter-spacing:2px;line-height:1;">
                ${score.toLocaleString()}
              </div>
              <div style="color:#00eeff;font-size:10px;letter-spacing:3px;margin-top:10px;text-transform:uppercase;">
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

          <!-- Body copy -->
          <tr>
            <td style="padding:24px 32px 8px;text-align:center;">
              <p style="color:#666;font-size:11px;line-height:1.9;margin:0 0 24px;">
                Dodge lasers across Miami, Tokyo, NYC, Dubai &amp; Ibiza.<br />
                One mechanic. Zero mercy. Can you beat them?
              </p>
              <a href="${inviteUrl}"
                 style="display:inline-block;background:none;border:2px solid #00ff88;
                        color:#00ff88;padding:12px 28px;font-family:'Courier New',monospace;
                        font-size:11px;font-weight:bold;letter-spacing:2px;text-decoration:none;
                        text-shadow:0 0 8px #00ff88;">
                ► ACCEPT THE CHALLENGE
              </a>
            </td>
          </tr>

          <!-- Controls hint -->
          <tr>
            <td style="padding:16px 32px 28px;text-align:center;">
              <div style="color:#2a2a2a;font-size:9px;letter-spacing:1px;line-height:1.8;">
                KEYBOARD: ← → ARROWS &nbsp;·&nbsp; TOUCH: DRAG OR TAP
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#000;padding:16px;text-align:center;border-top:1px solid #0d0d1a;">
              <div style="color:#1a1a1a;font-size:9px;letter-spacing:1px;">
                © ${new Date().getFullYear()} ${APP_NAME} · Free to play in your browser.
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

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: ShareEmailRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── Validate ───────────────────────────────────────────────────────────────
  const emailRe        = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const recipientEmail = (body.recipient_email ?? '').trim().toLowerCase()

  if (!recipientEmail || !emailRe.test(recipientEmail)) {
    return NextResponse.json({ error: 'Invalid recipient email' }, { status: 400 })
  }

  if (typeof body.session_id !== 'string' || !body.session_id) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
  }

  const { session_id, score, level, city } = body
  const supabase = createServerClient()
  const now      = new Date().toISOString()

  // ── Resolve sender email from session ─────────────────────────────────────
  let senderEmail: string | null = null
  try {
    const { data } = await supabase
      .from('sessions')
      .select('email')
      .eq('id', session_id)
      .single()
    senderEmail = data?.email ?? null
  } catch {
    // Best-effort — proceed without sender email
  }

  const senderLabel = senderEmail
    ? senderEmail.split('@')[0]   // "john" from "john@example.com"
    : 'A Palm Galaxy player'

  // ── Build invite URL with full attribution ────────────────────────────────
  const inviteUrl =
    `${APP_URL}/?utm_source=email_share` +
    `&utm_medium=email` +
    `&utm_campaign=friend_invite` +
    `&utm_content=${encodeURIComponent(session_id)}`

  // ── Check Resend is configured ────────────────────────────────────────────
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn('[share/email] RESEND_API_KEY not set — skipping send')
    // Still insert the email_shares row so the intent is tracked
    await supabase.from('email_shares').insert({
      session_id,
      sender_email:    senderEmail,
      recipient_email: recipientEmail,
      sent_at:         now,
    }).then(({ error }) => {
      if (error) console.error('[share/email] email_shares insert error (no resend):', error.message)
    })

    const response: ShareEmailResponse = { ok: true }
    return NextResponse.json(response, { status: 200 })
  }

  // ── Send via Resend ────────────────────────────────────────────────────────
  try {
    const resend = new Resend(resendKey)

    const { data: sendData, error: sendError } = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      recipientEmail,
      subject: `${senderLabel} challenged you to ${APP_NAME} 🌴⚡`,
      html:    buildInviteHtml(senderLabel, score ?? 0, level ?? 0, city ?? 'Miami', inviteUrl),
      ...(senderEmail ? { replyTo: senderEmail } : {}),
    })

    if (sendError) {
      console.error('[share/email] Resend error:', sendError)
      return NextResponse.json<ShareEmailResponse>(
        { ok: false },
        { status: 500 },
      )
    }

    const resendMessageId = sendData?.id ?? null

    // ── Insert email_shares row ──────────────────────────────────────────
    const { error: dbError } = await supabase
      .from('email_shares')
      .insert({
        session_id,
        sender_email:       senderEmail,
        recipient_email:    recipientEmail,
        resend_message_id:  resendMessageId,
        sent_at:            now,
        recipient_played:   false,
      })

    if (dbError) {
      console.error('[share/email] email_shares insert error:', dbError.message)
      // Don't fail — email was sent successfully
    }

    // ── Update session share flag ────────────────────────────────────────
    supabase
      .from('sessions')
      .update({ shared_email: true, share_clicked_at: now })
      .eq('id', session_id)
      .then(({ error }) => {
        if (error) console.error('[share/email] session update error:', error.message)
      })

    const response: ShareEmailResponse = {
      ok:               true,
      resend_message_id: resendMessageId ?? undefined,
    }

    return NextResponse.json(response, { status: 200 })

  } catch (err) {
    console.error('[share/email] Unexpected error:', err)
    return NextResponse.json<ShareEmailResponse>(
      { ok: false },
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

// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — app/api/webhooks/resend/route.ts
// File 29 of 48
//
// POST /api/webhooks/resend
//
// Receives delivery event webhooks from Resend and updates the attribution
// chain in Supabase.
//
// Resend webhook events handled:
//   email.opened   → email_shares SET opened_at
//   email.clicked  → email_shares SET clicked_at
//   email.bounced  → console.warn (no action — future: flag lead as invalid)
//   email.complained → console.warn (future: unsubscribe)
//
// Signature verification:
//   Resend signs webhooks with HMAC-SHA256 using RESEND_WEBHOOK_SECRET.
//   We verify the svix-signature header before processing any payload.
//   If RESEND_WEBHOOK_SECRET is not set, verification is skipped in dev
//   but a warning is logged.
//
// Rules:
//   - Always returns 200 to Resend (prevents retry storms on DB errors)
//   - Lookup is by resend_message_id — no session_id in webhook payload
//   - opened_at / clicked_at are only written once (first event wins)
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// ─────────────────────────────────────────────────────────────────────────────
// RESEND WEBHOOK PAYLOAD TYPES
// Resend sends a typed event object — we only need the fields we act on.
// ─────────────────────────────────────────────────────────────────────────────

interface ResendWebhookData {
  email_id?: string    // The resend_message_id we stored in email_shares
  to?:       string[]
  from?:     string
  subject?:  string
  click?:    { link?: string }
}

interface ResendWebhookEvent {
  type: string          // 'email.opened' | 'email.clicked' | 'email.bounced' | etc.
  data: ResendWebhookData
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNATURE VERIFICATION
// Resend uses Svix under the hood. The signature is in the svix-signature header.
// Format: "v1,<base64-encoded-hmac-sha256>"
// We verify against the raw request body using RESEND_WEBHOOK_SECRET.
// ─────────────────────────────────────────────────────────────────────────────

async function verifySignature(
  rawBody:   string,
  headers:   Headers,
  secret:    string,
): Promise<boolean> {
  try {
    const msgId        = headers.get('svix-id')        ?? ''
    const msgTimestamp = headers.get('svix-timestamp') ?? ''
    const msgSignature = headers.get('svix-signature') ?? ''

    if (!msgId || !msgTimestamp || !msgSignature) return false

    // Reject timestamps older than 5 minutes to prevent replay attacks
    const tsSeconds = parseInt(msgTimestamp, 10)
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (Math.abs(nowSeconds - tsSeconds) > 300) return false

    // Signed content: "{msgId}.{msgTimestamp}.{rawBody}"
    const signedContent = `${msgId}.${msgTimestamp}.${rawBody}`
    const encoder       = new TextEncoder()

    // Import the secret key (Svix secrets are "whsec_" prefixed base64)
    const secretBytes = secret.startsWith('whsec_')
      ? Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0))
      : encoder.encode(secret)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )

    const signatureBytes = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      encoder.encode(signedContent),
    )

    const computedSig = `v1,${btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))}`

    // msgSignature may contain multiple space-separated sigs — any match is valid
    const signatures = msgSignature.split(' ')
    return signatures.some(sig => sig === computedSig)
  } catch (err) {
    console.error('[webhooks/resend] Signature verification error:', err)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Read raw body (needed for signature verification) ──────────────────────
  const rawBody = await req.text()

  // ── Verify signature ───────────────────────────────────────────────────────
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
  if (webhookSecret) {
    const valid = await verifySignature(rawBody, req.headers, webhookSecret)
    if (!valid) {
      console.warn('[webhooks/resend] Signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    // Dev / staging without secret configured — allow but warn
    console.warn('[webhooks/resend] RESEND_WEBHOOK_SECRET not set — skipping verification')
  }

  // ── Parse payload ──────────────────────────────────────────────────────────
  let event: ResendWebhookEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, data } = event
  const messageId = data?.email_id ?? null

  // ── Route by event type ────────────────────────────────────────────────────
  if (!messageId) {
    // Can't do anything without a message ID — ack and move on
    return NextResponse.json({ ok: true })
  }

  const supabase = createServerClient()
  const now      = new Date().toISOString()

  try {
    switch (type) {
      // ── email.opened ─────────────────────────────────────────────────────
      case 'email.opened': {
        const { error } = await supabase
          .from('email_shares')
          .update({ opened_at: now })
          .eq('resend_message_id', messageId)
          .is('opened_at', null)   // first open only

        if (error) {
          console.error('[webhooks/resend] opened_at update error:', error.message)
        }
        break
      }

      // ── email.clicked ────────────────────────────────────────────────────
      case 'email.clicked': {
        const { error } = await supabase
          .from('email_shares')
          .update({ clicked_at: now })
          .eq('resend_message_id', messageId)
          .is('clicked_at', null)   // first click only

        if (error) {
          console.error('[webhooks/resend] clicked_at update error:', error.message)
        }
        break
      }

      // ── email.bounced ────────────────────────────────────────────────────
      case 'email.bounced': {
        console.warn('[webhooks/resend] Email bounced:', {
          messageId,
          to: data.to,
          subject: data.subject,
        })
        // Future: mark email_leads.bounced = true, suppress future sends
        break
      }

      // ── email.complained ─────────────────────────────────────────────────
      case 'email.complained': {
        console.warn('[webhooks/resend] Spam complaint:', {
          messageId,
          to: data.to,
        })
        // Future: mark sessions.unsubscribed = true
        break
      }

      // ── email.delivery_delayed ───────────────────────────────────────────
      case 'email.delivery_delayed': {
        // No action needed — Resend retries automatically
        break
      }

      default: {
        // Unknown event type — ack silently, don't error
        console.log('[webhooks/resend] Unhandled event type:', type)
        break
      }
    }
  } catch (err) {
    console.error('[webhooks/resend] Unexpected error processing event:', err)
    // Always return 200 — prevents Resend from retrying indefinitely
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}

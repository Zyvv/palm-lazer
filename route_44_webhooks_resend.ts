// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — app/api/webhooks/resend/route.ts
// File 44 of 48
//
// POST /api/webhooks/resend
//
// Receives lifecycle events from Resend for all Palm Lazer emails.
//
// Handled events:
//   email.opened  → email_shares.opened_at  = now
//   email.clicked → email_shares.clicked_at = now
//   email.bounced → email_shares.bounced_at = now
//
// Security:
//   Signature verified via svix headers before any DB write.
//   RESEND_WEBHOOK_SECRET required in env.
//
// Rules:
//   - Always return 200 — Resend retries on non-2xx
//   - Match email_shares rows by resend_id column
//   - Unknown event types are silently ignored (logged only)
//   - Runtime: edge
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { Webhook }                   from 'svix'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES — Resend webhook payload shapes
// ─────────────────────────────────────────────────────────────────────────────

interface ResendWebhookData {
  email_id?:    string   // present on most events
  from?:        string
  to?:          string[]
  subject?:     string
  click?:       { link: string; userAgent?: string; ipAddress?: string }
  bounce?:      { message?: string }
  created_at?:  string
}

interface ResendWebhookPayload {
  type: string           // 'email.sent' | 'email.delivered' | 'email.opened' | 'email.clicked' | 'email.bounced'
  data: ResendWebhookData
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT
// ─────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[webhooks/resend] Supabase env vars missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNATURE VERIFICATION
// Resend uses the svix webhook standard.
// Headers: svix-id, svix-timestamp, svix-signature
// ─────────────────────────────────────────────────────────────────────────────

async function verifySignature(
  req:     NextRequest,
  rawBody: string,
): Promise<ResendWebhookPayload | null> {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhooks/resend] RESEND_WEBHOOK_SECRET not set')
    return null
  }

  const svixId        = req.headers.get('svix-id')        ?? ''
  const svixTimestamp = req.headers.get('svix-timestamp') ?? ''
  const svixSignature = req.headers.get('svix-signature') ?? ''

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error('[webhooks/resend] Missing svix headers')
    return null
  }

  try {
    const wh = new Webhook(secret)
    const payload = wh.verify(rawBody, {
      'svix-id':        svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendWebhookPayload
    return payload
  } catch (err) {
    console.error('[webhooks/resend] Signature verification failed:', err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT HANDLERS
// Each returns silently — errors are logged, never thrown.
// ─────────────────────────────────────────────────────────────────────────────

async function handleOpened(
  supabase:  ReturnType<typeof getSupabase>,
  resendId:  string,
  now:       string,
): Promise<void> {
  const { error } = await supabase
    .from('email_shares')
    .update({ opened_at: now })
    .eq('resend_id', resendId)
    .is('opened_at', null)   // only set once — first open wins

  if (error) {
    console.error('[webhooks/resend] opened_at update error:', error.message)
  }
}

async function handleClicked(
  supabase:  ReturnType<typeof getSupabase>,
  resendId:  string,
  now:       string,
  link?:     string,
): Promise<void> {
  const update: Record<string, string | boolean> = {
    clicked_at: now,
  }

  // If clicked link is the play URL, mark recipient as having played
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://palmlazer.com'
  if (link && link.startsWith(appUrl)) {
    update.recipient_played = true
  }

  const { error } = await supabase
    .from('email_shares')
    .update(update)
    .eq('resend_id', resendId)
    .is('clicked_at', null)   // first click wins

  if (error) {
    console.error('[webhooks/resend] clicked_at update error:', error.message)
  }
}

async function handleBounced(
  supabase: ReturnType<typeof getSupabase>,
  resendId: string,
  now:      string,
): Promise<void> {
  const { error } = await supabase
    .from('email_shares')
    .update({ bounced_at: now })
    .eq('resend_id', resendId)

  if (error) {
    console.error('[webhooks/resend] bounced_at update error:', error.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Read raw body — required for svix signature verification ──────────────
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    console.error('[webhooks/resend] Failed to read request body')
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  if (!rawBody) {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  // ── Verify svix signature ─────────────────────────────────────────────────
  const payload = await verifySignature(req, rawBody)
  if (!payload) {
    // Return 200 to stop Resend retrying an invalid signature permanently.
    // Real attacks get dropped here; legitimate misconfiguration is logged above.
    return NextResponse.json({ ok: false, reason: 'invalid_signature' }, { status: 200 })
  }

  const { type, data } = payload
  const resendId = data.email_id ?? ''
  const now      = new Date().toISOString()

  // ── Guard: every event we care about needs a resend_id ───────────────────
  if (!resendId && ['email.opened', 'email.clicked', 'email.bounced'].includes(type)) {
    console.warn('[webhooks/resend] No email_id in payload for event:', type)
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // ── Route to handler ──────────────────────────────────────────────────────
  try {
    const supabase = getSupabase()

    switch (type) {
      case 'email.opened':
        await handleOpened(supabase, resendId, now)
        break

      case 'email.clicked':
        await handleClicked(supabase, resendId, now, data.click?.link)
        break

      case 'email.bounced':
        await handleBounced(supabase, resendId, now)
        break

      case 'email.sent':
      case 'email.delivered':
        // Informational — no DB write needed, but we don't error
        break

      default:
        console.log('[webhooks/resend] Unhandled event type:', type)
    }
  } catch (err) {
    console.error('[webhooks/resend] Handler error:', err)
    // Still return 200 — we logged it, no value in Resend retrying
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

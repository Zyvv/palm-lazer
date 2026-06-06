// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — app/api/share/email/route.ts
// File 43 of 48
//
// POST /api/share/email
//
// Called when a player shares the game via email from the game over screen.
//
// Steps:
//   1. Validate inputs (session_id, from_email, to_email, score, city)
//   2. Insert into email_shares (type: 'game_invite')
//   3. Send GameInvite email via Resend
//   4. Update email_shares row with resend_id
//   5. Update sessions: shared_email = true, share_clicked_at = now
//
// Rules:
//   - Max 3 share emails per session (anti-spam)
//   - to_email must be different from from_email
//   - Always 200 after validation — client is fire-and-forget
//   - Runtime: edge
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { Resend }                    from 'resend'
import { render }                    from '@react-email/render'
import { GameInvite }                from '@/emails/GameInvite'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const APP_NAME      = process.env.NEXT_PUBLIC_APP_NAME ?? 'Palm Lazer'
const APP_URL       = process.env.NEXT_PUBLIC_APP_URL  ?? 'https://palmlazer.com'
const FROM_EMAIL    = process.env.RESEND_FROM_EMAIL    ?? 'play@palmlazer.com'
const MAX_PER_SESSION = 3

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ShareEmailBody {
  session_id:  string
  from_email:  string
  to_email:    string
  score:       number
  level:       number
  city:        string
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY missing')
  return new Resend(key)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse ──────────────────────────────────────────────────────────────────
  let body: ShareEmailBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const session_id = (body.session_id ?? '').trim()
  const from_email = (body.from_email ?? '').trim().toLowerCase()
  const to_email   = (body.to_email   ?? '').trim().toLowerCase()
  const score      = typeof body.score === 'number' ? body.score : 0
  const level      = typeof body.level === 'number' ? body.level : 0
  const city       = (body.city ?? 'Miami').trim()

  // ── Validate ───────────────────────────────────────────────────────────────
  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }
  if (!isValidEmail(to_email)) {
    return NextResponse.json({ error: 'invalid_to_email' }, { status: 400 })
  }
  if (from_email && !isValidEmail(from_email)) {
    return NextResponse.json({ error: 'invalid_from_email' }, { status: 400 })
  }
  if (from_email && from_email === to_email) {
    return NextResponse.json({ error: 'cannot_share_to_self' }, { status: 400 })
  }

  const supabase = getSupabase()
  const now      = new Date().toISOString()

  // ── Anti-spam: check existing share count for this session ────────────────
  const { count, error: countError } = await supabase
    .from('email_shares')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session_id)
    .eq('email_type', 'game_invite')

  if (countError) {
    console.error('[share/email] count error:', countError.message)
    // Non-fatal — continue
  }

  if ((count ?? 0) >= MAX_PER_SESSION) {
    return NextResponse.json({ error: 'share_limit_reached' }, { status: 429 })
  }

  // ── 1. Insert email_shares row (pending resend_id) ─────────────────────────
  const shareUrl    = `${APP_URL}/share/${session_id}?ref=share_email`
  const playUrl     = `${APP_URL}/?ref=invite&from=${encodeURIComponent(from_email)}&sid=${session_id}`

  const { data: shareRow, error: shareInsertError } = await supabase
    .from('email_shares')
    .insert({
      session_id,
      email:          to_email,
      email_type:     'game_invite',
      sent_at:        now,
      product_source: 'palm_lazer',
      score,
      level,
      city,
    })
    .select('id')
    .single()

  if (shareInsertError || !shareRow) {
    console.error('[share/email] insert error:', shareInsertError?.message)
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  // ── 2. Update session share flags ─────────────────────────────────────────
  supabase
    .from('sessions')
    .update({
      shared_email:     true,
      share_clicked_at: now,
    })
    .eq('id', session_id)
    .then(({ error }) => {
      if (error) console.error('[share/email] session flag error:', error.message)
    })

  // ── 3. Send GameInvite via Resend ──────────────────────────────────────────
  ;(async () => {
    try {
      const resend = getResend()

      const html = await render(
        GameInvite({
          score,
          level,
          city,
          shareUrl,
          playUrl,
          fromEmail: from_email || undefined,
          appUrl:    APP_URL,
          appName:   APP_NAME,
        })
      )

      const subject = from_email
        ? `Someone challenged you on Palm Lazer 🌴⚡`
        : `Can you beat this Palm Lazer score? 🌴⚡`

      const { data: resendData, error: resendError } = await resend.emails.send({
        from:    `${APP_NAME} <${FROM_EMAIL}>`,
        to:      [to_email],
        subject,
        html,
        reply_to: from_email || undefined,
        tags: [
          { name: 'product',    value: 'palm_lazer'  },
          { name: 'email_type', value: 'game_invite' },
          { name: 'session_id', value: session_id    },
        ],
      })

      if (resendError) {
        console.error('[share/email] Resend error:', resendError)
        return
      }

      // ── 4. Update email_shares with resend_id ──────────────────────────
      if (resendData?.id) {
        await supabase
          .from('email_shares')
          .update({ resend_id: resendData.id })
          .eq('id', shareRow.id)
      }

    } catch (err) {
      console.error('[share/email] send error:', err)
    }
  })()

  return NextResponse.json({ ok: true }, { status: 200 })
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

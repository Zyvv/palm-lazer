// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — app/api/email/capture/route.ts
// File 42 of 48
//
// POST /api/email/capture
//
// Called at game over when player submits email.
//
// Steps:
//   1. Validate email + session_id
//   2. Insert into email_leads (upsert on email — one lead row per address)
//   3. Update sessions row: email, email_captured = true
//   4. Send ScoreCard email via Resend (immediate)
//   5. Schedule RetentionD2 at +22h via Resend scheduled_at
//   6. If max_level_reached >= 3: schedule ZyvvBridge at +48h
//
// Rules:
//   - Always 200 after validation — client is fire-and-forget
//   - Duplicate email for same session is a no-op (idempotent)
//   - Resend failures are logged, never bubble to client
//   - Runtime: edge
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { Resend }                    from 'resend'
import { render }                    from '@react-email/render'
import { ScoreCard }                 from '@/emails/ScoreCard'
import { RetentionD2 }               from '@/emails/RetentionD2'
import { ZyvvBridge }                from '@/emails/ZyvvBridge'

export const runtime = 'edge'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const APP_NAME   = process.env.NEXT_PUBLIC_APP_NAME   ?? 'Palm Lazer'
const APP_URL    = process.env.NEXT_PUBLIC_APP_URL    ?? 'https://palmlazer.com'
const ZYVV_URL   = process.env.ZYVV_APP_URL           ?? 'https://zyvv.app'
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL      ?? 'play@palmlazer.com'
const CITIES     = ['Miami', 'Tokyo', 'NYC', 'Dubai', 'Ibiza'] as const

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface EmailCaptureBody {
  session_id: string
  email:      string
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

function cityName(level: number): string {
  return CITIES[Math.min(level, CITIES.length - 1)] ?? 'Miami'
}

// +N hours from now as ISO string — used for Resend scheduled_at
function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString()
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse ──────────────────────────────────────────────────────────────────
  let body: EmailCaptureBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const email      = (body.email      ?? '').trim().toLowerCase()
  const session_id = (body.session_id ?? '').trim()

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const now      = new Date().toISOString()

  // ── Fetch session row ──────────────────────────────────────────────────────
  const { data: session, error: sessionFetchError } = await supabase
    .from('sessions')
    .select('id, email, email_captured, final_score, max_level_reached')
    .eq('id', session_id)
    .single()

  if (sessionFetchError || !session) {
    console.error('[email/capture] session fetch error:', sessionFetchError?.message)
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  // ── Idempotency — already captured for this session ───────────────────────
  if (session.email_captured && session.email === email) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 })
  }

  const score    = session.final_score        ?? 0
  const level    = session.max_level_reached  ?? 0
  const city     = cityName(level)

  // ── 1. Upsert email_leads ──────────────────────────────────────────────────
  const { error: leadError } = await supabase
    .from('email_leads')
    .upsert(
      {
        email,
        first_session_id:    session_id,
        first_score:         score,
        first_level:         level,
        first_city:          city,
        product_source:      'palm_lazer',
        created_at:          now,
        updated_at:          now,
      },
      { onConflict: 'email', ignoreDuplicates: false }
    )

  if (leadError) {
    console.error('[email/capture] email_leads upsert error:', leadError.message)
    // Non-fatal — continue
  }

  // ── 2. Update session row ──────────────────────────────────────────────────
  const { error: sessionUpdateError } = await supabase
    .from('sessions')
    .update({
      email,
      email_captured:    true,
      email_captured_at: now,
    })
    .eq('id', session_id)

  if (sessionUpdateError) {
    console.error('[email/capture] session update error:', sessionUpdateError.message)
  }

  // ── 3–6. Resend emails (fire-and-forget chain) ────────────────────────────
  ;(async () => {
    try {
      const resend         = getResend()
      const playAgainUrl   = `${APP_URL}/?ref=email_retention&sid=${session_id}`
      const shareUrl       = `${APP_URL}/share/${session_id}`

      // ── Email 1: ScoreCard — immediate ─────────────────────────────────
      const scoreCardHtml = await render(
        ScoreCard({
          score,
          level,
          city,
          shareUrl,
          playAgainUrl,
          appUrl:  APP_URL,
          appName: APP_NAME,
        })
      )

      const { data: scoreCardData, error: scoreCardError } = await resend.emails.send({
        from:    `${APP_NAME} <${FROM_EMAIL}>`,
        to:      [email],
        subject: `Your Palm Lazer score: ${score.toLocaleString('en-US')} 🌴⚡`,
        html:    scoreCardHtml,
        tags: [
          { name: 'product',    value: 'palm_lazer' },
          { name: 'email_type', value: 'score_card' },
          { name: 'session_id', value: session_id   },
        ],
      })

      if (scoreCardError) {
        console.error('[email/capture] ScoreCard send error:', scoreCardError)
      }

      // Log to email_shares
      if (scoreCardData?.id) {
        await supabase.from('email_shares').insert({
          session_id,
          email,
          resend_id:     scoreCardData.id,
          email_type:    'score_card',
          sent_at:       now,
          product_source:'palm_lazer',
        })
      }

      // ── Email 2: RetentionD2 — scheduled +22h ──────────────────────────
      const retentionHtml = await render(
        RetentionD2({
          score,
          level,
          city,
          playAgainUrl,
          appUrl:  APP_URL,
          appName: APP_NAME,
        })
      )

      const { data: retentionData, error: retentionError } = await resend.emails.send({
        from:         `${APP_NAME} <${FROM_EMAIL}>`,
        to:           [email],
        subject:      `The lazers miss you 🌴`,
        html:         retentionHtml,
        scheduled_at: hoursFromNow(22),
        tags: [
          { name: 'product',    value: 'palm_lazer'   },
          { name: 'email_type', value: 'retention_d2' },
          { name: 'session_id', value: session_id     },
        ],
      })

      if (retentionError) {
        console.error('[email/capture] RetentionD2 send error:', retentionError)
      }

      if (retentionData?.id) {
        await supabase.from('email_shares').insert({
          session_id,
          email,
          resend_id:     retentionData.id,
          email_type:    'retention_d2',
          scheduled_at:  hoursFromNow(22),
          product_source:'palm_lazer',
        })
      }

      // ── Email 3: ZyvvBridge — scheduled +48h, only level >= 3 ──────────
      if (level >= 3) {
        const zyvvHtml = await render(
          ZyvvBridge({
            score,
            level,
            city,
            zyvvUrl:   ZYVV_URL,
            appUrl:    APP_URL,
            appName:   APP_NAME,
            sessionId: session_id,
          })
        )

        const { data: zyvvData, error: zyvvError } = await resend.emails.send({
          from:         `${APP_NAME} <${FROM_EMAIL}>`,
          to:           [email],
          subject:      `You qualified for something else ⚡`,
          html:         zyvvHtml,
          scheduled_at: hoursFromNow(48),
          tags: [
            { name: 'product',    value: 'palm_lazer'   },
            { name: 'email_type', value: 'zyvv_bridge'  },
            { name: 'session_id', value: session_id     },
          ],
        })

        if (zyvvError) {
          console.error('[email/capture] ZyvvBridge send error:', zyvvError)
        }

        if (zyvvData?.id) {
          await supabase.from('email_shares').insert({
            session_id,
            email,
            resend_id:     zyvvData.id,
            email_type:    'zyvv_bridge',
            scheduled_at:  hoursFromNow(48),
            product_source:'palm_lazer',
          })
        }
      }

    } catch (err) {
      console.error('[email/capture] Resend chain error:', err)
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

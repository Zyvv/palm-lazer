// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — lib/supabase/server.ts
// File 23 of 48
//
// Server-side Supabase client.
//
// Rules:
//   - Uses SUPABASE_SERVICE_ROLE_KEY — bypasses RLS for all server writes
//   - NEVER imported by any file under components/ or hooks/
//   - NEVER imported in any 'use client' file
//   - One client per request — createServerClient() is called at the top of
//     each API route handler, not module-level (avoids edge cold-start leaks)
//   - The anon key is exposed publicly via NEXT_PUBLIC_SUPABASE_ANON_KEY but
//     is NOT used here — this module is service-role only
// ═══════════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// ENV VALIDATION
// Fail loudly at startup if the required server-only vars are missing.
// These are never prefixed NEXT_PUBLIC_ — they are never sent to the browser.
// ─────────────────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `[supabase/server] Missing required environment variable: ${key}. ` +
      `Ensure it is set in .env.local (development) or the Vercel dashboard (production).`,
    )
  }
  return value
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE TYPES
// Inline minimal type map — enough for the API routes that exist in this build.
// Extend as new tables are added. Full generated types (supabase gen types)
// can replace this once the schema is stable.
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionRow {
  id:                        string
  fingerprint:               string | null
  ip_hash:                   string | null
  country:                   string | null
  city_geo:                  string | null
  device_type:               string | null
  os:                        string | null
  browser:                   string | null
  screen_width:              number | null
  screen_height:             number | null
  referrer:                  string | null
  utm_source:                string | null
  utm_medium:                string | null
  utm_campaign:              string | null
  utm_content:               string | null
  landing_url:               string | null
  started_at:                string
  last_active_at:            string | null
  ended_at:                  string | null
  session_duration_seconds:  number | null
  email:                     string | null
  email_captured_at:         string | null
  email_capture_trigger:     string | null
  shared_tiktok:             boolean
  shared_x:                  boolean
  shared_email:              boolean
  shared_link_copied:        boolean
  share_clicked_at:          string | null
  engagement_score:          number | null
  churn_risk:                string | null
  share_propensity:          string | null
  groq_session_summary:      string | null
  product_source:            string
  zyvv_bridge_sent:          boolean
  zyvv_bridge_sent_at:       string | null
  zyvv_converted:            boolean
  zyvv_session_id:           string | null
  final_score:               number | null
  max_level_reached:         number | null
  runs_json:                 unknown | null
}

export interface GameEventRow {
  id:               string
  session_id:       string
  event_type:       string
  score:            number | null
  level_number:     number | null
  city_name:        string | null
  lives_remaining:  number | null
  frame_number:     number | null
  palm_x_position:  number | null
  laser_side:       string | null
  laser_y:          number | null
  laser_speed:      number | null
  share_platform:   string | null
  share_recipient_email: string | null
  created_at:       string
}

export interface EmailLeadRow {
  id:               string
  session_id:       string | null
  email:            string
  capture_trigger:  string | null
  score:            number | null
  level:            number | null
  city:             string | null
  created_at:       string
  product_source:   string
}

export interface Database {
  public: {
    Tables: {
      sessions: {
        Row:    SessionRow
        Insert: Partial<SessionRow>
        Update: Partial<SessionRow>
      }
      game_events: {
        Row:    GameEventRow
        Insert: Partial<GameEventRow>
      }
      email_leads: {
        Row:    EmailLeadRow
        Insert: Partial<EmailLeadRow>
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// Call this at the top of each server-side API route.
// Returns a fully-typed SupabaseClient with service-role privileges.
// ─────────────────────────────────────────────────────────────────────────────

export function createServerClient(): SupabaseClient<Database> {
  const supabaseUrl     = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey  = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      // Service role client never needs a user session
      persistSession:     false,
      autoRefreshToken:   false,
      detectSessionInUrl: false,
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        // Identify server-originated requests in Supabase logs
        'x-application-name': 'palm-galaxy-server',
      },
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE HELPERS
// Thin wrappers used across multiple API routes.
// Each helper calls createServerClient() internally — one client per call.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a single row and return it.
 * Throws on Supabase error so callers can handle via try/catch.
 */
export async function dbInsert<
  T extends keyof Database['public']['Tables'],
>(
  table:  T,
  values: Database['public']['Tables'][T]['Insert'],
): Promise<Database['public']['Tables'][T]['Row']> {
  const client = createServerClient()
  const { data, error } = await client
    .from(table as string)
    .insert(values as Record<string, unknown>)
    .select()
    .single()

  if (error) throw new Error(`[supabase/server] dbInsert(${table}): ${error.message}`)
  return data as Database['public']['Tables'][T]['Row']
}

/**
 * Update rows matching the given match object and return the updated row.
 */
export async function dbUpdate<
  T extends keyof Database['public']['Tables'],
>(
  table:  T,
  match:  Partial<Database['public']['Tables'][T]['Row']>,
  values: Database['public']['Tables'][T]['Update'],
): Promise<void> {
  const client = createServerClient()
  const { error } = await client
    .from(table as string)
    .update(values as Record<string, unknown>)
    .match(match as Record<string, unknown>)

  if (error) throw new Error(`[supabase/server] dbUpdate(${table}): ${error.message}`)
}

/**
 * Bulk-insert an array of rows. No return value — fire and track via count.
 */
export async function dbBulkInsert<
  T extends keyof Database['public']['Tables'],
>(
  table:  T,
  rows:   Array<Database['public']['Tables'][T]['Insert']>,
): Promise<void> {
  if (rows.length === 0) return
  const client = createServerClient()
  const { error } = await client
    .from(table as string)
    .insert(rows as Record<string, unknown>[])

  if (error) throw new Error(`[supabase/server] dbBulkInsert(${table}): ${error.message}`)
}

/**
 * Fetch a single row by primary key id.
 * Returns null if not found.
 */
export async function dbGetById<
  T extends keyof Database['public']['Tables'],
>(
  table: T,
  id:    string,
): Promise<Database['public']['Tables'][T]['Row'] | null> {
  const client = createServerClient()
  const { data, error } = await client
    .from(table as string)
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`[supabase/server] dbGetById(${table}, ${id}): ${error.message}`)
  return data as Database['public']['Tables'][T]['Row'] | null
}

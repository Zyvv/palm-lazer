// ═══════════════════════════════════════════════════════════════════════════
// PALM LAZER — lib/game/types.ts
// File 12 of 48
//
// Single source of truth for all TypeScript types used across:
//   - Game engine (canvas state, entities, cities)
//   - Session layer (API request/response shapes)
//   - Database rows (mirrors Supabase schema)
//   - Groq AI payloads
//   - Email / share flows
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// CITY
// ─────────────────────────────────────────────────────────────────────────────

export interface CityConfig {
  /** Internal key used for data-city attribute and DB storage */
  key: string
  /** Display name shown in HUD and overlays */
  name: string
  /** Sky gradient stops [top, mid, bottom] */
  sky: [string, string, string]
  /** Ground fill colour */
  ground: string
  /** Primary laser / neon accent */
  accent: string
  /** Secondary laser / neon accent */
  accent2: string
  /** Building height array (one value per building column) */
  buildH: number[]
  /** Building column width in px */
  buildW: number
}

// ─────────────────────────────────────────────────────────────────────────────
// LASER
// ─────────────────────────────────────────────────────────────────────────────

export type LaserSide = 'left' | 'right'

export interface Laser {
  id: number
  side: LaserSide
  /** Left edge x of the beam */
  x1: number
  /** Right edge x of the beam */
  x2: number
  /** Vertical position */
  y: number
  /** Pixels per frame (negative = moving left) */
  speed: number
  /** Set to false on collision so we can filter before next frame */
  active: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE
// ─────────────────────────────────────────────────────────────────────────────

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  /** Countdown from initial value to 0 */
  life: number
  maxLife: number
  color: string
  size: number
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'idle'       // Start screen — no session active yet
  | 'playing'    // Active gameplay
  | 'paused'     // Tab hidden / backgrounded
  | 'dead'       // Just died — brief flash before game-over screen
  | 'gameover'   // Game over screen visible

export interface GameState {
  phase:        GamePhase
  score:        number
  level:        number
  lives:        number
  frame:        number
  palmX:        number
  lasers:       Laser[]
  particles:    Particle[]
  spawnTimer:   number
  hitFlash:     number
  /** Total runs in this session (increments on each PLAY/RETRY) */
  runNumber:    number
  /** Per-run stats for the current run */
  currentRun:   RunStats
}

export interface RunStats {
  runId:            number | null   // DB bigserial id after INSERT
  startedAt:        number          // Date.now()
  score:            number
  maxLevel:         number
  maxCity:          string
  lazersDoged:      number
  livesLost:        number
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT STATE
// ─────────────────────────────────────────────────────────────────────────────

export interface InputState {
  left:  boolean
  right: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION (mirrors sessions table)
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionRow {
  id:                      string
  fingerprint:             string | null
  ip_hash:                 string | null
  country:                 string | null
  city_geo:                string | null
  device_type:             string | null
  os:                      string | null
  browser:                 string | null
  screen_width:            number | null
  screen_height:           number | null
  referrer:                string | null
  utm_source:              string | null
  utm_medium:              string | null
  utm_campaign:            string | null
  utm_content:             string | null
  landing_url:             string | null
  started_at:              string
  last_active_at:          string | null
  ended_at:                string | null
  session_duration_seconds: number | null
  email:                   string | null
  email_captured_at:       string | null
  email_capture_trigger:   string | null
  shared_tiktok:           boolean
  shared_x:                boolean
  shared_email:            boolean
  shared_link_copied:      boolean
  share_clicked_at:        string | null
  engagement_score:        number | null
  churn_risk:              ChurnRisk | null
  share_propensity:        Propensity | null
  groq_session_summary:    string | null
  product_source:          string
  zyvv_bridge_sent:        boolean
  zyvv_bridge_sent_at:     string | null
  zyvv_converted:          boolean
  zyvv_session_id:         string | null
  created_at:              string
}

export type ChurnRisk  = 'low' | 'medium' | 'high'
export type Propensity = 'low' | 'medium' | 'high'

// ─────────────────────────────────────────────────────────────────────────────
// GAME EVENTS (mirrors game_events table)
// ─────────────────────────────────────────────────────────────────────────────

export type GameEventType =
  | 'game_start'
  | 'game_over'
  | 'level_up'
  | 'lazer_dodged'
  | 'lazer_hit'
  | 'life_lost'
  | 'pause'
  | 'resume'
  | 'share_prompt_seen'
  | 'share_clicked'
  | 'email_prompt_seen'
  | 'email_submitted'
  | 'email_dismissed'

export type SharePlatform = 'tiktok' | 'x' | 'email' | 'copy'

export interface GameEventPayload {
  event_type:            GameEventType
  score?:                number
  level_number?:         number
  city_name?:            string
  lives_remaining?:      number
  palm_x_position?:      number
  frame_number?:         number
  laser_side?:           LaserSide
  laser_y?:              number
  laser_speed?:          number
  share_platform?:       SharePlatform
  share_recipient_email?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// API — /api/session/start
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionStartRequest {
  fingerprint:   string | null
  screen_width:  number
  screen_height: number
  referrer:      string | null
  utm_source:    string | null
  utm_medium:    string | null
  utm_campaign:  string | null
  utm_content:   string | null
  landing_url:   string | null
}

export interface SessionStartResponse {
  session_id: string
}

// ─────────────────────────────────────────────────────────────────────────────
// API — /api/session/event
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionEventRequest {
  session_id: string
  events:     GameEventPayload[]
}

export interface SessionEventResponse {
  inserted: number
}

// ─────────────────────────────────────────────────────────────────────────────
// API — /api/session/end
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionEndRequest {
  session_id:               string
  session_duration_seconds: number
  final_score:              number
  max_level_reached:        number
  runs:                     RunSummary[]
}

export interface RunSummary {
  run_number:           number
  duration_seconds:     number
  final_score:          number
  max_level_reached:    number
  max_city_reached:     string
  total_lazers_dodged:  number
  total_lives_lost:     number
  end_reason:           'lazer_hit' | 'quit' | 'tab_closed'
}

export interface SessionEndResponse {
  ok: boolean
  /** Groq analysis triggered async — not awaited */
  analysis_queued: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// API — /api/email/capture
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailCaptureRequest {
  session_id: string
  email:      string
  trigger:    'game_over' | 'share_prompt' | 'level_up'
  score:      number
  level:      number
  city:       string
}

export interface EmailCaptureResponse {
  ok:      boolean
  message: string
}

// ─────────────────────────────────────────────────────────────────────────────
// API — /api/share/email
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareEmailRequest {
  session_id:      string
  sender_email:    string
  recipient_email: string
  score:           number
  level:           number
  city:            string
}

export interface ShareEmailResponse {
  ok:               boolean
  resend_message_id?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ — churn prediction payload
// ─────────────────────────────────────────────────────────────────────────────

export interface GroqChurnInput {
  session_id:          string
  elapsed_seconds:     number
  events_count:        number
  current_score:       number
  current_level:       number
  runs_completed:      number
  palm_x_variance:     number   // Measure of how much the player is moving
  recent_dodge_count:  number   // Dodges in last 10s
  recent_hit_count:    number
}

export interface GroqChurnOutput {
  churn_risk:           ChurnRisk
  recommended_action:   string
  confidence:           number  // 0–1
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ — share propensity payload
// ─────────────────────────────────────────────────────────────────────────────

export interface GroqShareInput {
  session_id:        string
  final_score:       number
  runs_count:        number
  cities_reached:    string[]
  session_duration:  number
  max_level:         number
}

export interface GroqShareOutput {
  share_propensity: Propensity
  best_platform:    SharePlatform
  suggested_caption?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ — session behavioral summary
// ─────────────────────────────────────────────────────────────────────────────

export interface GroqSessionSummaryInput {
  session_id:     string
  events:         GameEventPayload[]
  total_runs:     number
  email_captured: boolean
  shared:         boolean
  final_score:    number
  max_level:      number
}

export interface GroqSessionSummaryOutput {
  summary:           string
  engagement_score:  number    // 0–10
  notable_behavior:  string
  churn_risk:        ChurnRisk
  share_propensity:  Propensity
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ — daily cohort analysis (cron)
// ─────────────────────────────────────────────────────────────────────────────

export interface GroqCohortInput {
  date:                  string
  total_sessions:        number
  avg_session_duration:  number
  email_capture_rate:    number
  share_rate:            number
  top_drop_off_city:     string
  sessions_by_source:    Record<string, number>
  avg_score:             number
}

export interface GroqCohortOutput {
  pattern_summary:                      string
  recommended_difficulty_adjustment:    string
  highest_retention_source:             string
  email_capture_opportunity:            string
}

// ─────────────────────────────────────────────────────────────────────────────
// UTM DATA — passed from page.tsx → GameShell → session/start
// ─────────────────────────────────────────────────────────────────────────────

export interface UtmData {
  utm_source:   string | null
  utm_medium:   string | null
  utm_campaign: string | null
  utm_content:  string | null
  ref:          string | null
  sid:          string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARE STATE — UI state for share/email overlay
// ─────────────────────────────────────────────────────────────────────────────

export type OverlayView =
  | 'start'
  | 'gameover'
  | 'email_capture'
  | 'share'
  | 'share_email_modal'
  | 'none'

// ─────────────────────────────────────────────────────────────────────────────
// PYTHON INTELLIGENCE SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export interface PythonSessionSummary {
  session_id:       string
  duration_seconds: number | null
  max_level_reached: number | null
  final_score:      number | null
  email_captured:   boolean | null
  shared:           boolean | null
}

export interface PythonBatchInput {
  sessions: PythonSessionSummary[]
  date:     string
}

export interface PythonBatchOutput {
  date:                    string
  total_sessions:          number
  avg_duration_seconds:    number
  email_capture_rate:      number
  share_rate:              number
  avg_final_score:         number
  note:                    string
}

// ─────────────────────────────────────────────────────────────────────────────
// OG IMAGE params
// ─────────────────────────────────────────────────────────────────────────────

export interface OgImageParams {
  /** Session ID for personalised share cards */
  sid?:    string
  /** Score to display (used when sid lookup fails) */
  score?:  string
  /** City name */
  city?:   string
  /** Level number */
  level?:  string
}

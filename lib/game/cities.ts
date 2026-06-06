// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — lib/game/cities.ts
// File 13 of 48
//
// City configuration data and helper utilities.
// Single source of truth for all city definitions — used by the canvas
// engine, the HUD, the OG image generator, and the DB event payloads.
// ═══════════════════════════════════════════════════════════════════════════

import type { CityConfig } from '@/lib/game/types'

// ─────────────────────────────────────────────────────────────────────────────
// CITY DEFINITIONS
// Order = level order. Index 0 = level 1 (Miami), etc.
// ─────────────────────────────────────────────────────────────────────────────

export const CITIES: CityConfig[] = [
  {
    key:    'miami',
    name:   'Miami',
    sky:    ['#0a0a2e', '#0d1440', '#0a2060'],
    ground: '#0d0d1a',
    accent: '#ff3aff',
    accent2:'#00ffee',
    buildH: [80, 120, 60, 140, 90, 110, 70, 130, 50, 100],
    buildW: 42,
  },
  {
    key:    'tokyo',
    name:   'Tokyo',
    sky:    ['#1a0a2e', '#2d0a40', '#1a0060'],
    ground: '#100a1a',
    accent: '#ff006a',
    accent2:'#00aaff',
    buildH: [160, 80, 200, 60, 140, 100, 180, 70, 120, 90],
    buildW: 38,
  },
  {
    key:    'nyc',
    name:   'NYC',
    sky:    ['#050510', '#0a0a20', '#050a30'],
    ground: '#080810',
    accent: '#ffcc00',
    accent2:'#ff4400',
    buildH: [220, 140, 260, 80, 200, 160, 240, 100, 180, 120],
    buildW: 50,
  },
  {
    key:    'dubai',
    name:   'Dubai',
    sky:    ['#100a00', '#1a1000', '#200800'],
    ground: '#0a0800',
    accent: '#ffaa00',
    accent2:'#ff6600',
    buildH: [300, 100, 340, 80, 260, 140, 320, 90, 200, 110],
    buildW: 44,
  },
  {
    key:    'ibiza',
    name:   'Ibiza',
    sky:    ['#000820', '#001030', '#001840'],
    ground: '#00060f',
    accent: '#ff00aa',
    accent2:'#aa00ff',
    buildH: [60, 40, 80, 30, 70, 50, 65, 35, 55, 45],
    buildW: 36,
  },
  // ── Roadmap cities (not yet active in gameplay) ────────────────────
  {
    key:    'paris',
    name:   'Paris',
    sky:    ['#0a0a18', '#121228', '#0a0a20'],
    ground: '#080810',
    accent: '#ffffff',
    accent2:'#cc88ff',
    buildH: [140, 100, 180, 70, 160, 120, 150, 90, 130, 110],
    buildW: 46,
  },
  {
    key:    'lagos',
    name:   'Lagos',
    sky:    ['#0a0800', '#140e00', '#100800'],
    ground: '#080600',
    accent: '#44ff44',
    accent2:'#ffaa22',
    buildH: [100, 70, 130, 50, 110, 80, 120, 60, 90, 75],
    buildW: 40,
  },
  {
    key:    'seoul',
    name:   'Seoul',
    sky:    ['#050010', '#0a0020', '#08001a'],
    ground: '#050008',
    accent: '#ff2222',
    accent2:'#00ffee',
    buildH: [180, 120, 220, 90, 200, 150, 210, 100, 170, 130],
    buildW: 42,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE CITIES — cities available in the current build
// Roadmap cities are defined above but not yet used in gameplay.
// ─────────────────────────────────────────────────────────────────────────────

export const ACTIVE_CITIES = CITIES.slice(0, 5)

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the city config for a given level number (0-indexed internally,
 * wraps around if level exceeds city count).
 */
export function getCityForLevel(level: number): CityConfig {
  return ACTIVE_CITIES[level % ACTIVE_CITIES.length]
}

/**
 * Returns the city config by key string (e.g. 'miami').
 * Falls back to the first city if not found.
 */
export function getCityByKey(key: string): CityConfig {
  return CITIES.find(c => c.key === key) ?? CITIES[0]
}

/**
 * Returns the display name for a level number.
 * Used in HUD, overlays, and DB event payloads.
 */
export function getCityNameForLevel(level: number): string {
  return getCityForLevel(level).name
}

/**
 * Returns the level number (0-indexed) at which a new city begins.
 * Levels advance every LEVEL_DURATION_FRAMES frames.
 */
export function getLevelFromFrame(frame: number, levelDurationFrames: number): number {
  return Math.floor(frame / levelDurationFrames)
}

/**
 * How many frames until the next city transition, given the current frame.
 */
export function framesUntilNextCity(frame: number, levelDurationFrames: number): number {
  return levelDurationFrames - (frame % levelDurationFrames)
}

/**
 * Laser spawn rate in frames for a given level.
 * Gets faster each level. Hard floor at 30 frames (2 lasers/sec at 60fps).
 */
export function spawnRateForLevel(level: number): number {
  const BASE_RATE = 120   // frames between spawns at level 0
  const DECAY     = 10    // frames reduction per level
  const FLOOR     = 30    // minimum frames between spawns
  return Math.max(FLOOR, BASE_RATE - level * DECAY)
}

/**
 * Laser speed (pixels per frame) for a given level.
 * Scales up with level plus random variance.
 */
export function laserSpeedForLevel(level: number, variance = 0): number {
  const BASE_SPEED  = 4
  const LEVEL_BONUS = 0.15
  return BASE_SPEED * (1 + level * LEVEL_BONUS) + variance
}

/**
 * Movement speed of the palm tree for a given level.
 */
export function palmSpeedForLevel(level: number): number {
  const BASE_SPEED  = 3
  const LEVEL_BONUS = 0.5
  return BASE_SPEED + level * LEVEL_BONUS
}

/**
 * Building height multiplier for a given level.
 * Buildings grow taller as cities get harder.
 */
export function buildingHeightMultiplier(level: number): number {
  return 1 + level * 0.08
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — single place to tune game feel
// ─────────────────────────────────────────────────────────────────────────────

export const GAME_CONSTANTS = {
  /** Canvas height in px */
  CANVAS_HEIGHT: 560,
  /** Ground Y offset from bottom of canvas */
  GROUND_OFFSET: 80,
  /** Palm tree hitbox half-width */
  PALM_HALF_WIDTH: 16,
  /** Palm tree total height */
  PALM_HEIGHT: 90,
  /** Near-miss threshold in px (triggers laser_dodged event) */
  NEAR_MISS_THRESHOLD: 30,
  /** Frames per level (15 seconds at 60fps) */
  LEVEL_DURATION_FRAMES: 900,
  /** Starting lives */
  STARTING_LIVES: 3,
  /** Hit flash duration in frames */
  HIT_FLASH_FRAMES: 12,
  /** Frames to delay showing email prompt after game over */
  EMAIL_PROMPT_DELAY_MS: 600,
  /** Groq churn check intervals in ms */
  CHURN_CHECK_INTERVALS_MS: [30_000, 60_000, 90_000],
  /** Event batch flush interval in ms */
  EVENT_BATCH_INTERVAL_MS: 500,
  /** Max events to hold in batch before force-flush */
  EVENT_BATCH_MAX_SIZE: 20,
  /** Minimum score before showing share prompt */
  SHARE_PROMPT_MIN_SCORE: 100,
  /** Minimum level before ZYVV bridge email is triggered */
  ZYVV_BRIDGE_MIN_LEVEL: 3,
} as const

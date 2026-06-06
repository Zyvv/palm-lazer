// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — lib/game/engine.ts
// File 14 of 48
//
// Pure game engine — zero React, zero DOM access.
// Takes a GameState + InputState, returns a new GameState.
// All side effects (canvas draw, API calls, sound) happen outside this file.
// Fully unit-testable.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  GameState,
  GamePhase,
  Laser,
  Particle,
  InputState,
  RunStats,
} from '@/lib/game/types'

import {
  GAME_CONSTANTS,
  getCityForLevel,
  spawnRateForLevel,
  laserSpeedForLevel,
  palmSpeedForLevel,
  getLevelFromFrame,
} from '@/lib/game/cities'

const {
  CANVAS_HEIGHT,
  GROUND_OFFSET,
  PALM_HALF_WIDTH,
  PALM_HEIGHT,
  NEAR_MISS_THRESHOLD,
  LEVEL_DURATION_FRAMES,
  STARTING_LIVES,
  HIT_FLASH_FRAMES,
} = GAME_CONSTANTS

// ─────────────────────────────────────────────────────────────────────────────
// LASER ID COUNTER — monotonically increasing, reset on new game
// ─────────────────────────────────────────────────────────────────────────────

let _laserIdCounter = 0

function nextLaserId(): number {
  return ++_laserIdCounter
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL STATE
// ─────────────────────────────────────────────────────────────────────────────

export function makeInitialRunStats(): RunStats {
  return {
    runId:        null,
    startedAt:    Date.now(),
    score:        0,
    maxLevel:     0,
    maxCity:      'Miami',
    lasersDoged:  0,
    livesLost:    0,
  }
}

export function makeInitialState(): GameState {
  _laserIdCounter = 0
  return {
    phase:       'idle',
    score:       0,
    level:       0,
    lives:       STARTING_LIVES,
    frame:       0,
    palmX:       0,          // set to canvasWidth / 2 on first tick
    lasers:      [],
    particles:   [],
    spawnTimer:  0,
    hitFlash:    0,
    runNumber:   0,
    currentRun:  makeInitialRunStats(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START / RESTART
// ─────────────────────────────────────────────────────────────────────────────

export function startGame(state: GameState, canvasWidth: number): GameState {
  _laserIdCounter = 0
  const runNumber = state.runNumber + 1
  return {
    ...makeInitialState(),
    phase:      'playing',
    palmX:      canvasWidth / 2,
    runNumber,
    currentRun: makeInitialRunStats(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TICK — called once per animation frame while phase === 'playing'
// Returns: { nextState, events }
// events is a list of game event types that fired this tick — the hook
// layer picks these up and batches them to the API.
// ─────────────────────────────────────────────────────────────────────────────

export type TickEvent =
  | { type: 'laser_dodged'; laser: Laser }
  | { type: 'laser_hit';    laser: Laser; palmX: number }
  | { type: 'life_lost';    livesRemaining: number }
  | { type: 'level_up';     level: number; cityName: string }
  | { type: 'game_over' }

export interface TickResult {
  nextState: GameState
  events:    TickEvent[]
}

export function tick(
  state:       GameState,
  input:       InputState,
  canvasWidth: number,
): TickResult {
  if (state.phase !== 'playing') {
    return { nextState: state, events: [] }
  }

  const events: TickEvent[] = []
  let { frame, score, level, lives, palmX, lasers, particles, spawnTimer, hitFlash, currentRun } = state

  // ── Advance frame ──────────────────────────────────────────────────────
  frame++

  // ── Score ──────────────────────────────────────────────────────────────
  score = Math.floor(frame / 6) * (level + 1)

  // ── Level from frame ───────────────────────────────────────────────────
  const newLevel = getLevelFromFrame(frame, LEVEL_DURATION_FRAMES)
  if (newLevel > level) {
    level = newLevel
    lasers = []   // clear screen on city transition
    const city = getCityForLevel(level)
    events.push({ type: 'level_up', level, cityName: city.name })
  }

  // ── Palm movement ──────────────────────────────────────────────────────
  const moveSpeed = palmSpeedForLevel(level)
  const halfW = PALM_HALF_WIDTH + 5
  if (input.left)  palmX = Math.max(halfW, palmX - moveSpeed)
  if (input.right) palmX = Math.min(canvasWidth - halfW, palmX + moveSpeed)

  // ── Spawn lasers ───────────────────────────────────────────────────────
  spawnTimer++
  const curRate = spawnRateForLevel(level)

  if (spawnTimer >= curRate) {
    spawnTimer = 0
    lasers = [...lasers, spawnLaser(canvasWidth, level)]
  }

  // Occasional double-spawn at level 2+
  if (
    level >= 2 &&
    spawnTimer === Math.floor(curRate / 2) &&
    Math.random() < 0.4
  ) {
    lasers = [...lasers, spawnLaser(canvasWidth, level)]
  }

  // ── Move lasers ────────────────────────────────────────────────────────
  lasers = lasers.map(l => ({
    ...l,
    x1: l.x1 + l.speed,
    x2: l.x2 + l.speed,
  }))

  // ── Near-miss detection ────────────────────────────────────────────────
  // Before collision pruning, check which lasers passed near the palm
  const groundY   = CANVAS_HEIGHT - GROUND_OFFSET
  const palmTop   = groundY - PALM_HEIGHT
  const palmLeft  = palmX - PALM_HALF_WIDTH
  const palmRight = palmX + PALM_HALF_WIDTH

  for (const laser of lasers) {
    if (!laser.active) continue
    if (laser.y < palmTop - NEAR_MISS_THRESHOLD) continue
    if (laser.y > groundY + 5) continue

    const laserLeft  = Math.min(laser.x1, laser.x2)
    const laserRight = Math.max(laser.x1, laser.x2)

    // Laser just passed the palm zone (within NEAR_MISS_THRESHOLD px) but
    // did NOT hit — detect the crossing moment by checking if the laser
    // body is now within the horizontal near-miss band around the palm.
    const nearMissLeft  = palmLeft  - NEAR_MISS_THRESHOLD
    const nearMissRight = palmRight + NEAR_MISS_THRESHOLD

    const inNearMissZone = laserRight > nearMissLeft && laserLeft < nearMissRight
    const notHitZone     = laserRight < palmLeft || laserLeft > palmRight

    if (inNearMissZone && notHitZone) {
      // Only fire once per laser — tag it
      if (!(laser as any)._nearMissFired) {
        ;(laser as any)._nearMissFired = true
        events.push({ type: 'laser_dodged', laser })
        currentRun = { ...currentRun, lasersDoged: currentRun.lasersDoged + 1 }
      }
    }
  }

  // ── Collision detection ────────────────────────────────────────────────
  let hitThisFrame = false

  lasers = lasers.map(laser => {
    if (!laser.active || hitThisFrame) return laser

    const laserLeft  = Math.min(laser.x1, laser.x2)
    const laserRight = Math.max(laser.x1, laser.x2)

    const yHit = laser.y > palmTop - 10 && laser.y < groundY + 5
    const xHit = laserRight > palmLeft + 5 && laserLeft < palmRight - 5

    if (yHit && xHit) {
      hitThisFrame = true
      events.push({ type: 'laser_hit', laser, palmX })
      return { ...laser, active: false }
    }

    return laser
  })

  if (hitThisFrame) {
    lives--
    hitFlash = HIT_FLASH_FRAMES
    currentRun = { ...currentRun, livesLost: currentRun.livesLost + 1 }

    // Add hit particles
    particles = [
      ...particles,
      ...makeHitParticles(palmX, groundY - PALM_HEIGHT / 2, getCityForLevel(level).accent),
    ]

    if (lives <= 0) {
      events.push({ type: 'game_over' })

      return {
        nextState: {
          ...state,
          frame, score, level, lives: 0,
          palmX, lasers, particles,
          spawnTimer, hitFlash,
          phase: 'dead',
          currentRun: {
            ...currentRun,
            score,
            maxLevel: Math.max(currentRun.maxLevel, level),
            maxCity:  getCityForLevel(level).name,
          },
        },
        events,
      }
    }

    events.push({ type: 'life_lost', livesRemaining: lives })
  }

  // ── Prune off-screen lasers ────────────────────────────────────────────
  lasers = lasers.filter(
    l => l.active !== false && l.x2 > -60 && l.x1 < canvasWidth + 60,
  )

  // ── Tick particles ─────────────────────────────────────────────────────
  particles = tickParticles(particles)

  // ── Decay hit flash ────────────────────────────────────────────────────
  if (hitFlash > 0) hitFlash--

  // ── Update run stats ───────────────────────────────────────────────────
  currentRun = {
    ...currentRun,
    score,
    maxLevel: Math.max(currentRun.maxLevel, level),
    maxCity:  getCityForLevel(level).name,
  }

  return {
    nextState: {
      ...state,
      frame, score, level, lives,
      palmX, lasers, particles,
      spawnTimer, hitFlash,
      currentRun,
    },
    events,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAWN LASER
// ─────────────────────────────────────────────────────────────────────────────

function spawnLaser(canvasWidth: number, level: number): Laser {
  const side     = Math.random() < 0.5 ? 'left' : 'right'
  const groundY  = CANVAS_HEIGHT - GROUND_OFFSET
  // Lasers spawn in the middle vertical band — not at top (stars) or ground
  const y        = (groundY - PALM_HEIGHT) * 0.2 + Math.random() * (groundY - PALM_HEIGHT) * 0.7
  const variance = Math.random() * 0.5
  const spd      = laserSpeedForLevel(level, variance)

  if (side === 'left') {
    return { id: nextLaserId(), side, x1: -20, x2: 0, y, speed: spd, active: true }
  } else {
    return { id: nextLaserId(), side, x1: canvasWidth, x2: canvasWidth + 20, y, speed: -spd, active: true }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLES
// ─────────────────────────────────────────────────────────────────────────────

export function makeHitParticles(x: number, y: number, color: string): Particle[] {
  return Array.from({ length: 16 }, () => {
    const angle = Math.random() * Math.PI * 2
    const speed = 1 + Math.random() * 3.5
    const life  = 20 + Math.floor(Math.random() * 20)
    return {
      x, y,
      vx:      Math.cos(angle) * speed,
      vy:      Math.sin(angle) * speed,
      life,
      maxLife: life,
      color,
      size:    1 + Math.random() * 2,
    }
  })
}

function tickParticles(particles: Particle[]): Particle[] {
  return particles
    .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, life: p.life - 1 }))
    .filter(p => p.life > 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// PAUSE / RESUME
// ─────────────────────────────────────────────────────────────────────────────

export function pauseGame(state: GameState): GameState {
  if (state.phase !== 'playing') return state
  return { ...state, phase: 'paused' }
}

export function resumeGame(state: GameState): GameState {
  if (state.phase !== 'paused') return state
  return { ...state, phase: 'playing' }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Format a score number for display: 12345 → '12,345' */
export function formatScore(score: number): string {
  return score.toLocaleString('en-US')
}

/** Lives remaining as heart string: 3 → '♥♥♥', 1 → '♥♡♡' */
export function formatLives(lives: number, max = STARTING_LIVES): string {
  const full  = Math.max(0, Math.min(lives, max))
  const empty = Math.max(0, max - full)
  return '♥'.repeat(full) + '♡'.repeat(empty)
}

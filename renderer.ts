// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — lib/game/renderer.ts
// File 15 of 48
//
// Pure canvas renderer — zero React, zero DOM queries, zero API calls.
// Every function receives a CanvasRenderingContext2D plus the data it needs.
// The hook layer (hooks/useGameEngine.ts) calls renderFrame() once per RAF.
// ═══════════════════════════════════════════════════════════════════════════

import type { GameState, CityConfig, Laser, Particle } from '@/lib/game/types'
import { getCityForLevel, GAME_CONSTANTS } from '@/lib/game/cities'
import { formatScore, formatLives } from '@/lib/game/engine'

const {
  CANVAS_HEIGHT,
  GROUND_OFFSET,
  PALM_HEIGHT,
  PALM_HALF_WIDTH,
  STARTING_LIVES,
} = GAME_CONSTANTS

// Derived layout constants used throughout
const GROUND_Y = CANVAS_HEIGHT - GROUND_OFFSET

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a complete frame from game state.
 * Call once per requestAnimationFrame while phase === 'playing' | 'dead'.
 * Also safe to call for the static preview frame on the start screen.
 */
export function renderFrame(
  ctx:         CanvasRenderingContext2D,
  state:       GameState,
  canvasWidth: number,
): void {
  const city = getCityForLevel(state.level)

  ctx.clearRect(0, 0, canvasWidth, CANVAS_HEIGHT)

  drawSky(ctx, city, state.frame, canvasWidth)
  drawCity(ctx, city, state.level, canvasWidth)
  drawLasers(ctx, state.lasers, city)
  drawPalm(ctx, state.palmX, state.hitFlash, city)
  drawParticles(ctx, state.particles)
  drawHUD(ctx, state, city, canvasWidth)
}

/**
 * Render the static first frame shown before any game starts.
 * Uses level 0 / Miami city, palm centred, no lasers.
 */
export function renderStaticPreview(
  ctx:         CanvasRenderingContext2D,
  canvasWidth: number,
): void {
  const city = getCityForLevel(0)
  ctx.clearRect(0, 0, canvasWidth, CANVAS_HEIGHT)
  drawSky(ctx, city, 0, canvasWidth)
  drawCity(ctx, city, 0, canvasWidth)
  drawPalm(ctx, canvasWidth / 2, 0, city)
}

// ─────────────────────────────────────────────────────────────────────────────
// SKY
// ─────────────────────────────────────────────────────────────────────────────

function drawSky(
  ctx:         CanvasRenderingContext2D,
  city:        CityConfig,
  frame:       number,
  canvasWidth: number,
): void {
  // Background gradient
  const skyGrd = ctx.createLinearGradient(0, 0, 0, GROUND_Y)
  skyGrd.addColorStop(0,   city.sky[0])
  skyGrd.addColorStop(0.5, city.sky[1])
  skyGrd.addColorStop(1,   city.sky[2])
  ctx.fillStyle = skyGrd
  ctx.fillRect(0, 0, canvasWidth, GROUND_Y)

  // Stars — deterministic positions via index seed, twinkle via sin
  const savedAlpha = ctx.globalAlpha
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 80; i++) {
    const sx = ((i * 137.508) + frame * 0.04) % canvasWidth
    const sy = (i * 73.137)  % (GROUND_Y * 0.62)
    const ss = i % 17 === 0 ? 1.5 : 0.9
    ctx.globalAlpha = 0.35 + 0.55 * Math.abs(Math.sin(frame * 0.045 + i))
    ctx.fillRect(sx, sy, ss, ss)
  }
  ctx.globalAlpha = savedAlpha

  // Moon
  const moonX = canvasWidth - 80
  const moonY = 50
  ctx.fillStyle = '#fffde8'
  ctx.beginPath()
  ctx.arc(moonX, moonY, 18, 0, Math.PI * 2)
  ctx.fill()
  // Moon shadow cutout — uses mid sky colour so it blends
  ctx.fillStyle = city.sky[1]
  ctx.beginPath()
  ctx.arc(moonX + 7, moonY - 4, 16, 0, Math.PI * 2)
  ctx.fill()
}

// ─────────────────────────────────────────────────────────────────────────────
// CITY / BUILDINGS
// ─────────────────────────────────────────────────────────────────────────────

function drawCity(
  ctx:         CanvasRenderingContext2D,
  city:        CityConfig,
  level:       number,
  canvasWidth: number,
): void {
  const colCount = city.buildH.length
  const colWidth = canvasWidth / colCount
  const heightMul = 1 + level * 0.08

  for (let i = 0; i < colCount; i++) {
    const bw = colWidth - 4
    const bh = city.buildH[i] * heightMul
    const bx = i * colWidth + 2
    const by = GROUND_Y - bh

    // Building body
    ctx.fillStyle = '#111122'
    ctx.fillRect(bx, by, bw, bh)

    // Edge outline — subtle neon border
    ctx.strokeStyle = city.accent + '55'
    ctx.lineWidth   = 0.5
    ctx.strokeRect(bx, by, bw, bh)

    // Windows — drawn with a stable pseudo-random pattern per building column
    // We use a seeded value per cell so windows don't flicker each frame.
    const winCols = Math.floor((bw - 8) / 8)
    const winRows = Math.floor((bh - 8) / 10)
    for (let wy = 0; wy < winRows; wy++) {
      for (let wx = 0; wx < winCols; wx++) {
        // Pseudo-random but stable: hash from building index + cell position
        const seed = ((i * 31 + wy * 97 + wx * 61) % 100) / 100
        if (seed < 0.45) {
          const winX = bx + 4 + wx * 8
          const winY = by + 6 + wy * 10
          // Alternate between accent and accent2 for colour variety
          ctx.fillStyle = seed < 0.28 ? city.accent + 'bb' : city.accent2 + '88'
          ctx.fillRect(winX, winY, 4, 5)
        }
      }
    }
  }

  // Ground fill
  ctx.fillStyle = city.ground
  ctx.fillRect(0, GROUND_Y, canvasWidth, GROUND_OFFSET)

  // Ground horizon line
  ctx.strokeStyle = city.accent + '99'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(0,           GROUND_Y)
  ctx.lineTo(canvasWidth, GROUND_Y)
  ctx.stroke()

  // Neon floor glow strip
  const floorGrd = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 22)
  floorGrd.addColorStop(0, city.accent + '44')
  floorGrd.addColorStop(1, 'transparent')
  ctx.fillStyle = floorGrd
  ctx.fillRect(0, GROUND_Y, canvasWidth, 22)
}

// ─────────────────────────────────────────────────────────────────────────────
// PALM TREE
// ─────────────────────────────────────────────────────────────────────────────

// Frond definitions — static so they're not re-allocated each frame
const FRONDS: ReadonlyArray<{ dx: number; dy: number; rot: number }> = [
  { dx: -32, dy: -22, rot: -0.62 },
  { dx: -20, dy: -32, rot: -0.32 },
  { dx:   0, dy: -36, rot:  0    },
  { dx:  20, dy: -32, rot:  0.32 },
  { dx:  32, dy: -22, rot:  0.62 },
  { dx: -16, dy: -14, rot: -0.92 },
  { dx:  16, dy: -14, rot:  0.92 },
]

// Trunk segment widths top → bottom
const TRUNK_WIDTHS = [5, 7, 8, 9, 8, 7, 6] as const

function drawPalm(
  ctx:      CanvasRenderingContext2D,
  palmX:    number,
  hitFlash: number,
  city:     CityConfig,
): void {
  const trunkBaseX = palmX
  const trunkTopY  = GROUND_Y - PALM_HEIGHT
  const segH       = PALM_HEIGHT / TRUNK_WIDTHS.length

  // ── Trunk ────────────────────────────────────────────────────────────────
  for (let i = 0; i < TRUNK_WIDTHS.length; i++) {
    const w  = TRUNK_WIDTHS[i]
    const tx = trunkBaseX - w / 2
    const ty = trunkTopY + i * segH
    ctx.fillStyle = i % 2 === 0 ? '#5a3a1a' : '#4a2e12'
    ctx.fillRect(tx, ty, w, segH + 1)
  }

  // ── Fronds ───────────────────────────────────────────────────────────────
  for (const f of FRONDS) {
    ctx.save()
    ctx.translate(trunkBaseX, trunkTopY)
    ctx.rotate(f.rot)

    // Outer glow stroke
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(
      f.dx * 0.3, f.dy * 0.3 + 6,
      f.dx * 0.7, f.dy * 0.7 + 9,
      f.dx, f.dy,
    )
    ctx.strokeStyle = '#2d8b00'
    ctx.lineWidth   = 4
    ctx.stroke()

    // Inner highlight stroke
    ctx.strokeStyle = '#3aaa00'
    ctx.lineWidth   = 2
    ctx.stroke()

    ctx.restore()
  }

  // ── Coconuts ─────────────────────────────────────────────────────────────
  ctx.fillStyle = '#8b5a00'
  ctx.beginPath()
  ctx.arc(trunkBaseX - 8, trunkTopY + 7, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(trunkBaseX + 6, trunkTopY + 11, 4, 0, Math.PI * 2)
  ctx.fill()

  // ── Hit flash overlay ─────────────────────────────────────────────────────
  if (hitFlash > 0) {
    const alpha = (hitFlash / GAME_CONSTANTS.HIT_FLASH_FRAMES) * 0.65
    ctx.fillStyle = `rgba(255, 50, 50, ${alpha.toFixed(3)})`
    ctx.beginPath()
    ctx.arc(trunkBaseX, trunkTopY + PALM_HEIGHT * 0.4, 34, 0, Math.PI * 2)
    ctx.fill()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LASERS
// ─────────────────────────────────────────────────────────────────────────────

function drawLasers(
  ctx:    CanvasRenderingContext2D,
  lasers: Laser[],
  city:   CityConfig,
): void {
  for (const laser of lasers) {
    if (!laser.active) continue
    drawLaser(ctx, laser, city)
  }
}

function drawLaser(
  ctx:   CanvasRenderingContext2D,
  laser: Laser,
  city:  CityConfig,
): void {
  const color = laser.side === 'left' ? city.accent : city.accent2

  // ── Core beam ────────────────────────────────────────────────────────────
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur  = 14
  ctx.strokeStyle = color
  ctx.lineWidth   = 3
  ctx.beginPath()
  ctx.moveTo(laser.x1, laser.y)
  ctx.lineTo(laser.x2, laser.y)
  ctx.stroke()
  ctx.restore()

  // ── Outer glow (wide, soft) ───────────────────────────────────────────────
  ctx.strokeStyle = color + '44'
  ctx.lineWidth   = 8
  ctx.beginPath()
  ctx.moveTo(laser.x1, laser.y)
  ctx.lineTo(laser.x2, laser.y)
  ctx.stroke()

  // ── Leading-edge hotspot ──────────────────────────────────────────────────
  // Bright circular flare at the tip of the beam — adds arcade feel
  const tipX = laser.side === 'left' ? laser.x2 : laser.x1
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur  = 20
  ctx.fillStyle   = '#ffffff'
  ctx.beginPath()
  ctx.arc(tipX, laser.y, 2.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLES
// ─────────────────────────────────────────────────────────────────────────────

function drawParticles(
  ctx:       CanvasRenderingContext2D,
  particles: Particle[],
): void {
  const savedAlpha = ctx.globalAlpha

  for (const p of particles) {
    const progress = p.life / p.maxLife          // 1 → 0 as particle dies
    ctx.globalAlpha = progress * 0.9
    ctx.fillStyle   = p.color

    const s = p.size * (0.5 + progress * 0.5)   // shrink as it fades
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s)
  }

  ctx.globalAlpha = savedAlpha
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HUD is drawn on-canvas so it stays sharp at any devicePixelRatio.
 * The DOM elements (#pg-score, #pg-level, #pg-lives) also exist as a fallback
 * for accessibility — the hook layer keeps them in sync separately.
 */
function drawHUD(
  ctx:         CanvasRenderingContext2D,
  state:       GameState,
  city:        CityConfig,
  canvasWidth: number,
): void {
  const HUD_H = 56

  // ── Top bar dark overlay ──────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0, 0, 0, 0.52)'
  ctx.fillRect(0, 0, canvasWidth, HUD_H)

  // ── Bottom edge separator ─────────────────────────────────────────────────
  ctx.strokeStyle = city.accent + '66'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(0,           HUD_H)
  ctx.lineTo(canvasWidth, HUD_H)
  ctx.stroke()

  ctx.font         = '9px "Press Start 2P", monospace'
  ctx.textBaseline = 'top'

  // ── Score (left) ──────────────────────────────────────────────────────────
  ctx.fillStyle   = '#00ff88'
  ctx.shadowColor = '#00ff88'
  ctx.shadowBlur  = 8
  ctx.fillText(`SCORE: ${formatScore(state.score)}`, 16, 12)

  // ── City name (right) ─────────────────────────────────────────────────────
  const cityLabel = city.name.toUpperCase()
  const cityW     = ctx.measureText(cityLabel).width
  ctx.fillStyle   = '#ff00ff'
  ctx.shadowColor = '#ff00ff'
  ctx.fillText(cityLabel, canvasWidth - cityW - 16, 12)

  // ── Lives (left, second row) ──────────────────────────────────────────────
  ctx.font        = '8px "Press Start 2P", monospace'
  ctx.fillStyle   = '#ffff00'
  ctx.shadowColor = '#ffff00'
  ctx.shadowBlur  = 6
  ctx.fillText(formatLives(state.lives, STARTING_LIVES), 16, 32)

  // ── Reset shadow ──────────────────────────────────────────────────────────
  ctx.shadowBlur  = 0
  ctx.shadowColor = 'transparent'
}

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL-UP FLASH OVERLAY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full-screen flash drawn on top of everything when a city transition occurs.
 * alpha should go from 1 → 0 over ~20 frames; caller manages the countdown.
 */
export function drawLevelUpFlash(
  ctx:         CanvasRenderingContext2D,
  cityName:    string,
  alpha:       number,
  canvasWidth: number,
): void {
  ctx.save()
  ctx.globalAlpha = alpha

  // Flash fill
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.fillRect(0, 0, canvasWidth, CANVAS_HEIGHT)

  // City name centred
  ctx.globalAlpha  = alpha
  ctx.font         = '13px "Press Start 2P", monospace'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = '#00eeff'
  ctx.shadowColor  = '#00eeff'
  ctx.shadowBlur   = 24
  ctx.fillText(cityName.toUpperCase(), canvasWidth / 2, CANVAS_HEIGHT / 2 - 12)

  ctx.font      = '8px "Press Start 2P", monospace'
  ctx.fillStyle = '#ffffff'
  ctx.shadowBlur = 10
  ctx.fillText('NEW CITY', canvasWidth / 2, CANVAS_HEIGHT / 2 + 14)

  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────────────
// NEAR-MISS FLASH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Brief cyan edge pulse shown when a laser passes within the near-miss band.
 * alpha: 1 → 0 over ~8 frames; caller manages the countdown.
 */
export function drawNearMissFlash(
  ctx:         CanvasRenderingContext2D,
  alpha:       number,
  canvasWidth: number,
): void {
  ctx.save()
  ctx.globalAlpha = alpha * 0.5

  const edgeW = 6
  ctx.fillStyle = '#00eeff'

  // Top
  ctx.fillRect(0, 0,              canvasWidth, edgeW)
  // Bottom
  ctx.fillRect(0, CANVAS_HEIGHT - edgeW, canvasWidth, edgeW)
  // Left
  ctx.fillRect(0,              0, edgeW, CANVAS_HEIGHT)
  // Right
  ctx.fillRect(canvasWidth - edgeW, 0, edgeW, CANVAS_HEIGHT)

  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────────────
// SCANLINES OVERLAY (optional — can be composited in CSS instead)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw CRT scanlines directly on the canvas.
 * Prefer the CSS version (#pg-scanlines) for performance; call this only when
 * rendering to an offscreen canvas (e.g., the OG image generator).
 */
export function drawScanlines(
  ctx:         CanvasRenderingContext2D,
  canvasWidth: number,
): void {
  ctx.save()
  ctx.globalAlpha = 0.12
  ctx.fillStyle   = '#000000'

  for (let y = 0; y < CANVAS_HEIGHT; y += 4) {
    ctx.fillRect(0, y + 2, canvasWidth, 2)
  }

  ctx.restore()
}

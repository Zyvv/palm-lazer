// ═══════════════════════════════════════════════════════════════════════════
// PALM GALAXY — hooks/useGameEngine.ts
// File 16 of 48
//
// The bridge between the pure game engine and React.
// Owns: RAF loop, canvas ref, input state, engine tick, renderer dispatch,
//       level-up / near-miss flash timers, and the TickEvent → callback relay.
//
// What lives here:
//   - requestAnimationFrame loop (start / stop / pause)
//   - Keyboard + touch + click input normalisation → InputState
//   - canvas resize observer
//   - engine.tick() call each frame
//   - renderer.renderFrame() call each frame
//   - level-up flash countdown
//   - near-miss flash countdown
//   - TickEvent relay via onTick callback prop
//
// What does NOT live here:
//   - API calls (useSession hook owns those)
//   - Overlay UI state (GameShell owns that)
//   - Session ID (useSession hook owns that)
// ═══════════════════════════════════════════════════════════════════════════

'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import type { GameState, InputState } from '@/lib/game/types'
import {
  makeInitialState,
  startGame,
  tick,
  pauseGame,
  resumeGame,
} from '@/lib/game/engine'
import type { TickEvent } from '@/lib/game/engine'
import {
  renderFrame,
  renderStaticPreview,
  drawLevelUpFlash,
  drawNearMissFlash,
} from '@/lib/game/renderer'
import { GAME_CONSTANTS } from '@/lib/game/cities'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_UP_FLASH_FRAMES  = 40   // frames the city-transition overlay is visible
const NEAR_MISS_FLASH_FRAMES = 8    // frames the edge-pulse is visible

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface UseGameEngineOptions {
  /** Called every frame with any TickEvents emitted by the engine */
  onTick?: (events: TickEvent[]) => void
  /** Called when phase transitions to 'dead' (use to trigger game-over UI) */
  onGameOver?: (state: GameState) => void
  /** Called on each level-up (use to update HUD city name) */
  onLevelUp?: (level: number, cityName: string) => void
}

export interface UseGameEngineReturn {
  /** Attach to <canvas> element */
  canvasRef:    React.RefObject<HTMLCanvasElement>
  /** Current game state — readable by UI layer for score, lives, etc. */
  gameState:    GameState
  /** Trigger a new game (or restart) */
  play:         () => void
  /** Externally pause the loop (tab blur, etc.) */
  pause:        () => void
  /** Resume after external pause */
  resume:       () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

export function useGameEngine(
  options: UseGameEngineOptions = {},
): UseGameEngineReturn {
  const { onTick, onGameOver, onLevelUp } = options

  // ── Refs ─────────────────────────────────────────────────────────────────
  const canvasRef          = useRef<HTMLCanvasElement>(null)
  const stateRef           = useRef<GameState>(makeInitialState())
  const inputRef           = useRef<InputState>({ left: false, right: false })
  const rafRef             = useRef<number>(0)
  const canvasWidthRef     = useRef<number>(0)
  const levelUpFlashRef    = useRef<number>(0)     // countdown in frames
  const levelUpCityRef     = useRef<string>('')    // city name for overlay text
  const nearMissFlashRef   = useRef<number>(0)     // countdown in frames
  const isRunningRef       = useRef<boolean>(false)

  // Stable callback refs so loop closure never captures stale functions
  const onTickRef          = useRef(onTick)
  const onGameOverRef      = useRef(onGameOver)
  const onLevelUpRef       = useRef(onLevelUp)
  useEffect(() => { onTickRef.current    = onTick    }, [onTick])
  useEffect(() => { onGameOverRef.current = onGameOver }, [onGameOver])
  useEffect(() => { onLevelUpRef.current  = onLevelUp  }, [onLevelUp])

  // ── React state — only what the UI layer actually reads ───────────────────
  const [gameState, setGameState] = useState<GameState>(() => makeInitialState())

  // ── Canvas resize ─────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width)
        if (w === canvasWidthRef.current) continue
        canvasWidthRef.current = w
        canvas.width  = w
        canvas.height = GAME_CONSTANTS.CANVAS_HEIGHT
        // Re-centre palm if already playing
        if (stateRef.current.phase === 'playing') {
          stateRef.current = {
            ...stateRef.current,
            palmX: w / 2,
          }
        }
      }
    })

    observer.observe(canvas.parentElement ?? canvas)
    return () => observer.disconnect()
  }, [])

  // ── RAF loop ─────────────────────────────────────────────────────────────
  const loop = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvasWidthRef.current || canvas.width || canvas.offsetWidth || 400

    const state  = stateRef.current
    const input  = inputRef.current

    // ── Tick engine ───────────────────────────────────────────────────────
    let nextState = state
    let events:  TickEvent[] = []

    if (state.phase === 'playing') {
      const result = tick(state, input, W)
      nextState = result.nextState
      events    = result.events
    }

    // ── Process events ────────────────────────────────────────────────────
    if (events.length > 0) {
      onTickRef.current?.(events)

      for (const ev of events) {
        if (ev.type === 'level_up') {
          levelUpFlashRef.current  = LEVEL_UP_FLASH_FRAMES
          levelUpCityRef.current   = ev.cityName
          onLevelUpRef.current?.(ev.level, ev.cityName)
        }
        if (ev.type === 'laser_dodged') {
          nearMissFlashRef.current = NEAR_MISS_FLASH_FRAMES
        }
        if (ev.type === 'game_over') {
          onGameOverRef.current?.(nextState)
        }
      }
    }

    // ── Commit state ──────────────────────────────────────────────────────
    stateRef.current = nextState

    // ── Render ────────────────────────────────────────────────────────────
    if (nextState.phase === 'playing' || nextState.phase === 'dead') {
      renderFrame(ctx, nextState, W)

      // Near-miss edge flash
      if (nearMissFlashRef.current > 0) {
        const alpha = nearMissFlashRef.current / NEAR_MISS_FLASH_FRAMES
        drawNearMissFlash(ctx, alpha, W)
        nearMissFlashRef.current--
      }

      // Level-up city name overlay
      if (levelUpFlashRef.current > 0) {
        const alpha = levelUpFlashRef.current / LEVEL_UP_FLASH_FRAMES
        drawLevelUpFlash(ctx, levelUpCityRef.current, alpha, W)
        levelUpFlashRef.current--
      }
    }

    // ── Sync React state (throttled — every 6 frames ~10fps UI updates) ───
    // We update React state for the HUD DOM elements and overlay logic,
    // but not every frame — canvas is the source of truth at 60fps.
    if (nextState.frame % 6 === 0 || events.length > 0) {
      setGameState(nextState)
    }

    if (isRunningRef.current) {
      rafRef.current = requestAnimationFrame(loop)
    }
  }, []) // empty deps — all live data accessed via refs

  // ── Input: keyboard ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft'  || e.key === 'a') inputRef.current.left  = true
      if (e.key === 'ArrowRight' || e.key === 'd') inputRef.current.right = true
      // Prevent page scroll while playing
      if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft'  || e.key === 'a') inputRef.current.left  = false
      if (e.key === 'ArrowRight' || e.key === 'd') inputRef.current.right = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
    }
  }, [])

  // ── Input: touch ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let touchStartX = 0

    const onTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX
      e.preventDefault()
    }

    const onTouchMove = (e: TouchEvent) => {
      const cx = e.touches[0].clientX
      inputRef.current.left  = cx < touchStartX - 10
      inputRef.current.right = cx > touchStartX + 10
      e.preventDefault()
    }

    const onTouchEnd = () => {
      inputRef.current.left  = false
      inputRef.current.right = false
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false })
    canvas.addEventListener('touchend',   onTouchEnd)

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove',  onTouchMove)
      canvas.removeEventListener('touchend',   onTouchEnd)
    }
  }, [])

  // ── Input: tap left / right half of canvas ────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onClick = (e: MouseEvent) => {
      if (stateRef.current.phase !== 'playing') return
      const rect = canvas.getBoundingClientRect()
      const cx   = e.clientX - rect.left
      const W    = canvasWidthRef.current || canvas.offsetWidth

      if (cx < W / 2) {
        inputRef.current.left = true
        setTimeout(() => { inputRef.current.left = false }, 180)
      } else {
        inputRef.current.right = true
        setTimeout(() => { inputRef.current.right = false }, 180)
      }
    }

    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }, [])

  // ── Visibility: auto-pause when tab is hidden ─────────────────────────────
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (stateRef.current.phase === 'playing') {
          stateRef.current = pauseGame(stateRef.current)
          setGameState(stateRef.current)
        }
      } else {
        if (stateRef.current.phase === 'paused') {
          stateRef.current = resumeGame(stateRef.current)
          setGameState(stateRef.current)
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  // ── Static preview on first mount ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Wait one tick for the ResizeObserver to set canvas width
    const id = requestAnimationFrame(() => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const W = canvasWidthRef.current || canvas.offsetWidth || 400
      canvas.width  = W
      canvas.height = GAME_CONSTANTS.CANVAS_HEIGHT
      canvasWidthRef.current = W
      renderStaticPreview(ctx, W)
    })

    return () => cancelAnimationFrame(id)
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const W = canvasWidthRef.current || canvas.offsetWidth || 400

    // Stop any existing loop
    isRunningRef.current = false
    cancelAnimationFrame(rafRef.current)

    // Reset input
    inputRef.current = { left: false, right: false }

    // Reset flash counters
    levelUpFlashRef.current  = 0
    nearMissFlashRef.current = 0

    // Initialise new game state
    const freshState = startGame(stateRef.current, W)
    stateRef.current = freshState
    setGameState(freshState)

    // Kick off loop
    isRunningRef.current = true
    rafRef.current = requestAnimationFrame(loop)
  }, [loop])

  const pause = useCallback(() => {
    if (stateRef.current.phase !== 'playing') return
    stateRef.current = pauseGame(stateRef.current)
    setGameState(stateRef.current)
    isRunningRef.current = false
    cancelAnimationFrame(rafRef.current)
  }, [])

  const resume = useCallback(() => {
    if (stateRef.current.phase !== 'paused') return
    stateRef.current = resumeGame(stateRef.current)
    setGameState(stateRef.current)
    isRunningRef.current = true
    rafRef.current = requestAnimationFrame(loop)
  }, [loop])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      isRunningRef.current = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return { canvasRef, gameState, play, pause, resume }
}

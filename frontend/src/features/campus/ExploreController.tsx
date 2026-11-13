import { useEffect, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { ENTRANCE } from '../../lib/officeLayout'
import { PLAYER_RADIUS, eyeAt, moveWithCollision } from '../../lib/collision'

export interface VirtualPad {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
}

interface Props {
  active: boolean
  spawn: [number, number]
  pad: RefObject<VirtualPad>
  onExit: () => void
  onNearEntrance?: (near: boolean) => void
  /** Suspends walking and look while an on-screen dialog owns the keyboard. */
  paused?: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** A focused form control owns its keystrokes; walking must not swallow letters or Escape. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/** Real first-person walk controller: pointer-lock look, WASD/Shift, drag fallback for
 *  touch and trackpads, delta-time movement, slide collision and a smooth eye height. */
export function ExploreController({ active, spawn, pad, onExit, onNearEntrance, paused = false }: Props) {
  const { camera, gl } = useThree()
  const pos = useRef({ x: spawn[0], z: spawn[1] })
  const yaw = useRef(0)
  const pitch = useRef(0)
  const eye = useRef(eyeAt(spawn[0], spawn[1]))
  const keys = useRef(new Set<string>())
  const near = useRef(false)
  const [locked, setLocked] = useState(false)
  const exitRef = useRef(onExit)
  exitRef.current = onExit

  // Reset the walker to the plaza spawn whenever Explore becomes active.
  useEffect(() => {
    if (!active) return
    const cam = camera as THREE.PerspectiveCamera
    pos.current = { x: spawn[0], z: spawn[1] }
    yaw.current = 0
    pitch.current = 0
    eye.current = eyeAt(spawn[0], spawn[1]) + 0.35
    cam.rotation.order = 'YXZ'
    cam.position.set(spawn[0], eye.current, spawn[1])
    cam.rotation.set(0, 0, 0)
    if (cam.isPerspectiveCamera) {
      cam.fov = 68
      cam.updateProjectionMatrix()
    }
    const canvas = gl.domElement
    canvas.dataset.playerX = spawn[0].toFixed(2)
    canvas.dataset.playerZ = spawn[1].toFixed(2)
    canvas.dataset.playerInside = '0'
  }, [active, spawn, camera, gl])

  // Keyboard input, focus-loss handling and Escape.
  useEffect(() => {
    if (!active || paused) return
    const held = keys.current
    const onDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.code === 'Escape') {
        // The browser releases pointer lock on Escape and that release cannot be cancelled, so the
        // first press must only free the mouse. Leaving the mode is a second, explicit press.
        if (document.pointerLockElement === gl.domElement) return
        e.preventDefault()
        exitRef.current()
        return
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault()
        held.add(e.code)
      }
    }
    const onUp = (e: KeyboardEvent) => { held.delete(e.code) }
    const clear = () => held.clear()
    const onVisibility = () => { if (document.hidden) clear() }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', onVisibility)
      held.clear()
    }
  }, [active, paused, gl])

  // Opening a dialog with a click can race the click's own pointer-lock request. Release it
  // again shortly after pausing so the visitor can reach the input and buttons.
  useEffect(() => {
    if (!active || !paused) return
    const canvas = gl.domElement
    const release = () => {
      if (document.pointerLockElement === canvas) {
        try { document.exitPointerLock() } catch { /* already gone */ }
      }
      setLocked(false)
    }
    release()
    const retry = window.setTimeout(release, 150)
    return () => window.clearTimeout(retry)
  }, [active, paused, gl])

  // Look: pointer lock on click, drag fallback when lock is unavailable (touch/trackpad).
  useEffect(() => {
    if (!active || paused) return
    const canvas = gl.domElement
    let dragging = false
    let lastX = 0
    let lastY = 0
    const onLockChange = () => setLocked(document.pointerLockElement === canvas)

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && document.pointerLockElement !== canvas) {
        try {
          const result = canvas.requestPointerLock() as unknown as Promise<void> | undefined
          if (result && typeof result.catch === 'function') result.catch(() => { /* drag fallback */ })
        } catch { /* drag fallback still works */ }
      }
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
    }
    const onPointerMove = (e: PointerEvent) => {
      let dx = 0
      let dy = 0
      if (document.pointerLockElement === canvas) {
        dx = e.movementX
        dy = e.movementY
      } else if (dragging) {
        dx = e.clientX - lastX
        dy = e.clientY - lastY
        lastX = e.clientX
        lastY = e.clientY
      }
      if (!dx && !dy) return
      yaw.current -= dx * 0.0026
      pitch.current = clamp(pitch.current - dy * 0.0022, -1.22, 1.22)
    }
    const onPointerUp = () => { dragging = false }
    const onBlur = () => { dragging = false }
    const onLockError = () => { /* keep drag mode */ }

    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onLockError)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onLockError)
      if (document.pointerLockElement === canvas) {
        try { document.exitPointerLock() } catch { /* already gone */ }
      }
      setLocked(false)
    }
  }, [active, paused, gl])

  useFrame((_, delta) => {
    if (!active || paused) return
    // Sub-step a long frame instead of clamping it: at 60 fps this is one step, but on a slow
    // machine the walker still covers the same distance per second and cannot tunnel through a
    // 0.12 m wall (each step is at most 0.05 s, i.e. 0.27 m at a sprint, under the 0.3 m radius).
    const dt = Math.min(delta, 0.25)
    const k = keys.current
    const virtual = pad.current
    let forward = 0
    let strafe = 0
    if (k.has('KeyW') || k.has('ArrowUp') || virtual?.forward) forward += 1
    if (k.has('KeyS') || k.has('ArrowDown') || virtual?.back) forward -= 1
    if (k.has('KeyD') || k.has('ArrowRight') || virtual?.right) strafe += 1
    if (k.has('KeyA') || k.has('ArrowLeft') || virtual?.left) strafe -= 1
    const len = Math.hypot(forward, strafe)
    if (len > 1) { forward /= len; strafe /= len }
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight')
    const speed = sprint ? 5.4 : 3.1
    const sin = Math.sin(yaw.current)
    const cos = Math.cos(yaw.current)
    const steps = Math.max(1, Math.ceil(dt / 0.05))
    const stepDt = dt / steps
    for (let i = 0; i < steps; i++) {
      const dx = (-sin * forward + cos * strafe) * speed * stepDt
      const dz = (-cos * forward - sin * strafe) * speed * stepDt
      if (!dx && !dz) break
      const next = moveWithCollision(pos.current.x, pos.current.z, dx, dz, PLAYER_RADIUS)
      pos.current = { x: next.x, z: next.z }
    }
    // Smooth the step between plaza, paving and the bridge deck.
    const target = eyeAt(pos.current.x, pos.current.z)
    eye.current += (target - eye.current) * (1 - Math.exp(-13 * dt))
    const cam = camera as THREE.PerspectiveCamera
    cam.position.set(pos.current.x, eye.current, pos.current.z)
    cam.rotation.set(pitch.current, yaw.current, 0, 'YXZ')

    // The entrance hint belongs to the approach, not to standing at reception.
    const outside = pos.current.z > ENTRANCE.z + 0.2
    const isNear = outside && Math.hypot(pos.current.x - ENTRANCE.x, pos.current.z - ENTRANCE.z) < 7
    if (isNear !== near.current) {
      near.current = isNear
      onNearEntrance?.(isNear)
    }
    // QA hooks: Playwright reads the real resolved position off the canvas, not a mock.
    const canvas = gl.domElement
    canvas.dataset.playerX = pos.current.x.toFixed(2)
    canvas.dataset.playerZ = pos.current.z.toFixed(2)
    canvas.dataset.playerInside = pos.current.z < ENTRANCE.z && Math.abs(pos.current.x) < 13 ? '1' : '0'
    canvas.dataset.locked = locked ? '1' : '0'
  })

  return null
}

/** Procedural surface textures.
 *
 *  Every pattern is painted once into a small offscreen canvas, cached by (kind, colour, repeat)
 *  and shared by every mesh that asks for it — no binary assets, no new dependency, no texture
 *  allocation per frame. Each material keeps the pattern in its own colour so the shared palette
 *  still drives the look, and every builder is seeded, so a reload paints the same floor.
 *
 *  A canvas context is unavailable in jsdom and in a WebGL-less browser, so every entry point is
 *  allowed to return null; `mat()` then simply renders the flat colour it always did.
 */
import * as THREE from 'three'

export type SurfaceKind =
  | 'wood' | 'tile' | 'carpet' | 'grass' | 'paving' | 'water' | 'fabric' | 'concrete'

const patternCache = new Map<string, HTMLCanvasElement | null>()
const texCache = new Map<string, THREE.Texture | null>()

/** Deterministic PRNG: identical pixels every reload, which keeps the look (and the tests) stable. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => {
    const v = (n >> shift) & 255
    return Math.max(0, Math.min(255, Math.round(v + 255 * amount)))
  }
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

function paint(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  if (patternCache.has(key)) return patternCache.get(key) ?? null
  let out: HTMLCanvasElement | null = null
  try {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (g) {
      draw(g)
      out = c
    }
  } catch {
    out = null
  }
  patternCache.set(key, out)
  return out
}

const SIZE: Record<SurfaceKind, number> = {
  wood: 256, tile: 256, carpet: 128, grass: 128, paving: 256, water: 256, fabric: 64, concrete: 128,
}

const SEED: Record<SurfaceKind, number> = {
  wood: 0x51a3, tile: 0x71e2, carpet: 0x2c91, grass: 0x9f31,
  paving: 0x4d77, water: 0x1ab3, fabric: 0x8e05, concrete: 0x3cc1,
}

function drawKind(kind: SurfaceKind, color: string, g: CanvasRenderingContext2D, n: number) {
  const random = rng(SEED[kind] ^ n)
  switch (kind) {
    case 'wood': {
      g.fillStyle = color
      g.fillRect(0, 0, n, n)
      for (let i = 0; i < 46; i++) {
        const y = random() * n
        g.strokeStyle = random() > 0.5 ? shade(color, -0.06) : shade(color, 0.05)
        g.globalAlpha = 0.25 + random() * 0.4
        g.lineWidth = 0.6 + random() * 1.4
        g.beginPath()
        g.moveTo(0, y)
        for (let x = 0; x <= n; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 1.6)
        g.stroke()
      }
      g.globalAlpha = 1
      for (let i = 0; i < 3; i++) {
        const x = random() * n
        const y = random() * n
        g.fillStyle = shade(color, -0.1)
        g.globalAlpha = 0.5
        g.beginPath()
        g.ellipse(x, y, 3 + random() * 3, 1.4 + random() * 1.6, random() * 3, 0, Math.PI * 2)
        g.fill()
      }
      g.globalAlpha = 1
      break
    }
    case 'tile': {
      const cells = 4
      const step = n / cells
      for (let iy = 0; iy < cells; iy++) {
        for (let ix = 0; ix < cells; ix++) {
          g.fillStyle = shade(color, (random() - 0.5) * 0.07)
          g.fillRect(ix * step, iy * step, step, step)
        }
      }
      g.strokeStyle = shade(color, -0.14)
      g.lineWidth = 2
      for (let i = 0; i <= cells; i++) {
        g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, n); g.stroke()
        g.beginPath(); g.moveTo(0, i * step); g.lineTo(n, i * step); g.stroke()
      }
      g.fillStyle = shade(color, -0.2)
      for (let i = 0; i < 260; i++) {
        g.globalAlpha = 0.10 + random() * 0.16
        g.fillRect(random() * n, random() * n, 1, 1)
      }
      g.globalAlpha = 1
      break
    }
    case 'carpet':
    case 'fabric': {
      g.fillStyle = color
      g.fillRect(0, 0, n, n)
      const weave = kind === 'fabric' ? 3 : 2
      for (let y = 0; y < n; y += weave) {
        for (let x = 0; x < n; x += weave) {
          g.fillStyle = shade(color, (random() - 0.5) * 0.22)
          g.fillRect(x, y, weave - 1, weave - 1)
        }
      }
      break
    }
    case 'grass': {
      g.fillStyle = color
      g.fillRect(0, 0, n, n)
      for (let i = 0; i < 900; i++) {
        g.fillStyle = random() > 0.5 ? shade(color, 0.08) : shade(color, -0.08)
        g.globalAlpha = 0.3 + random() * 0.4
        g.fillRect(random() * n, random() * n, 1.4, 1.4 + random() * 2)
      }
      g.globalAlpha = 1
      break
    }
    case 'paving': {
      const cells = 4
      const step = n / cells
      g.fillStyle = shade(color, -0.12)
      g.fillRect(0, 0, n, n)
      for (let iy = 0; iy < cells; iy++) {
        for (let ix = 0; ix < cells; ix++) {
          g.fillStyle = shade(color, (random() - 0.5) * 0.09)
          g.fillRect(ix * step + 1.5, iy * step + 1.5, step - 3, step - 3)
        }
      }
      for (let i = 0; i < 420; i++) {
        g.fillStyle = random() > 0.5 ? shade(color, 0.1) : shade(color, -0.1)
        g.globalAlpha = 0.12 + random() * 0.2
        g.fillRect(random() * n, random() * n, 1.5, 1.5)
      }
      g.globalAlpha = 1
      break
    }
    case 'water': {
      g.fillStyle = color
      g.fillRect(0, 0, n, n)
      for (let i = 0; i < 70; i++) {
        const y = random() * n
        const w = 20 + random() * 90
        const x = random() * n
        g.strokeStyle = random() > 0.4 ? shade(color, 0.12) : shade(color, -0.08)
        g.globalAlpha = 0.16 + random() * 0.3
        g.lineWidth = 1 + random() * 2.2
        g.beginPath()
        g.moveTo(x, y)
        g.quadraticCurveTo(x + w / 2, y + 2, x + w, y)
        g.stroke()
      }
      g.globalAlpha = 1
      break
    }
    case 'concrete': {
      g.fillStyle = color
      g.fillRect(0, 0, n, n)
      for (let i = 0; i < 700; i++) {
        g.fillStyle = random() > 0.5 ? shade(color, 0.06) : shade(color, -0.07)
        g.globalAlpha = 0.1 + random() * 0.16
        g.fillRect(random() * n, random() * n, 1 + random() * 2, 1 + random() * 2)
      }
      g.globalAlpha = 1
      break
    }
  }
}

/**
 * A repeating texture for `kind` tinted with `color`. `repeat` is how many tiles the pattern covers
 * on a 1 m square surface; callers pass the surface's own size in metres.
 */
export function surfaceTex(kind: SurfaceKind, color: string, repeat: [number, number]): THREE.Texture | null {
  const rx = Math.max(1, Math.round(repeat[0]))
  const ry = Math.max(1, Math.round(repeat[1]))
  const key = `t:${kind}:${color}:${rx}x${ry}`
  const hit = texCache.get(key)
  if (hit !== undefined) return hit
  const n = SIZE[kind]
  const cv = paint(`p:${kind}:${color}`, n, n, (g) => drawKind(kind, color, g, n))
  let tex: THREE.Texture | null = null
  if (cv) {
    try {
      const t = new THREE.CanvasTexture(cv)
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.repeat.set(rx, ry)
      t.anisotropy = 4
      t.colorSpace = THREE.SRGBColorSpace
      t.name = key
      t.needsUpdate = true
      tex = t
    } catch {
      tex = null
    }
  }
  texCache.set(key, tex)
  return tex
}

/** Test/report hook: has a texture actually been built in this environment? */
export function texturesAvailable(): boolean {
  return surfaceTex('tile', '#cccccc', [1, 1]) != null
}
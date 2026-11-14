/** Low-level isometric drawing on Pixi Graphics. Every helper takes world metres (x, z, height y)
 *  and projects through `iso`, so furniture sizes read the same as in the 3D scene. */
import { Container, Graphics, Matrix, Text, type TextStyleOptions } from 'pixi.js'
import { ISO_RISE, ISO_UNIT, iso } from '../../lib/iso'

export type V3 = [number, number, number]

/** Multiply an RGB colour by `f` (0…1 darkens, >1 lightens, clamped). */
export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f))
  const b = Math.min(255, Math.round((color & 255) * f))
  return (r << 16) | (g << 8) | b
}

export function mix(a: number, b: number, k: number): number {
  const ch = (s: number) => [(a >> s) & 255, (b >> s) & 255]
  const out = [16, 8, 0].map((s) => {
    const [x, y] = ch(s)
    return Math.round(x + (y - x) * k) << s
  })
  return out[0] | out[1] | out[2]
}

export function hex(css: string): number {
  return parseInt(css.replace('#', ''), 16)
}

/** Filled polygon from world points. */
export function face(g: Graphics, pts: V3[], color: number, alpha = 1, stroke?: { color: number; alpha?: number; width?: number }): Graphics {
  const flat: number[] = []
  for (const [x, z, y] of pts) {
    const p = iso(x, z, y)
    flat.push(p.x, p.y)
  }
  g.poly(flat).fill({ color, alpha })
  if (stroke) g.stroke({ color: stroke.color, alpha: stroke.alpha ?? 1, width: stroke.width ?? 1 })
  return g
}

/** Flat rectangle on the floor (or at height y), e.g. a rug or a tabletop decal. */
export function floorRect(g: Graphics, x0: number, z0: number, x1: number, z1: number, color: number, alpha = 1, y = 0): Graphics {
  return face(g, [[x0, z0, y], [x1, z0, y], [x1, z1, y], [x0, z1, y]], color, alpha)
}

/** Straight line in world space. */
export function line(g: Graphics, a: V3, b: V3, color: number, width = 1, alpha = 1): Graphics {
  const p = iso(a[0], a[1], a[2])
  const q = iso(b[0], b[1], b[2])
  g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color, width, alpha })
  return g
}

export interface BoxStyle {
  /** Side shading multipliers for the +z (screen-left) and +x (screen-right) faces. */
  left?: number
  right?: number
  top?: number
  outline?: number | null
  alpha?: number
}

/** Axis-aligned box centred on (cx, cz), from height y0 to y0 + h. Draws only the three faces the
 *  viewer can see (top, +z, +x), so it is cheap and needs no depth buffer. */
export function box(g: Graphics, cx: number, cz: number, w: number, d: number, y0: number, h: number, color: number, s: BoxStyle = {}): Graphics {
  const x0 = cx - w / 2; const x1 = cx + w / 2
  const z0 = cz - d / 2; const z1 = cz + d / 2
  const y1 = y0 + h
  const alpha = s.alpha ?? 1
  const edge = s.outline === undefined ? shade(color, 0.55) : s.outline
  const stroke = edge === null ? undefined : { color: edge, alpha: 0.35 * alpha, width: 0.6 }
  face(g, [[x0, z1, y0], [x1, z1, y0], [x1, z1, y1], [x0, z1, y1]], shade(color, s.left ?? 0.84), alpha, stroke)
  face(g, [[x1, z0, y0], [x1, z1, y0], [x1, z1, y1], [x1, z0, y1]], shade(color, s.right ?? 0.7), alpha, stroke)
  face(g, [[x0, z0, y1], [x1, z0, y1], [x1, z1, y1], [x0, z1, y1]], shade(color, s.top ?? 1), alpha, stroke)
  return g
}

/** Vertical quad in the plane z = const, spanning x0…x1 and heights y0…y1 (visible face is +z). */
export function wallZ(g: Graphics, z: number, x0: number, x1: number, y0: number, y1: number, color: number, alpha = 1): Graphics {
  return face(g, [[x0, z, y0], [x1, z, y0], [x1, z, y1], [x0, z, y1]], color, alpha)
}

/** Vertical quad in the plane x = const, spanning z0…z1 and heights y0…y1 (visible face is +x). */
export function wallX(g: Graphics, x: number, z0: number, z1: number, y0: number, y1: number, color: number, alpha = 1): Graphics {
  return face(g, [[x, z0, y0], [x, z1, y0], [x, z1, y1], [x, z0, y1]], color, alpha)
}

/** Ellipse lying on the floor plane (shadows, round rugs, table tops). */
export function floorEllipse(g: Graphics, x: number, z: number, r: number, color: number, alpha = 1, y = 0): Graphics {
  const p = iso(x, z, y)
  // A floor circle of radius r projects to an ellipse of half-width r·√2·unit and half-height
  // r·√2·unit·rise in a 2:1 dimetric view.
  const k = Math.SQRT2 * ISO_UNIT
  g.ellipse(p.x, p.y, r * k, r * k * ISO_RISE).fill({ color, alpha })
  return g
}

/** Text painted onto a wall plane. `plane: 'z'` reads along +x on a wall facing +z; `plane: 'x'`
 *  reads along -z on a wall facing +x. Font sizes are world pixels at zoom 1. */
export function wallText(
  text: string, at: V3, plane: 'x' | 'z', style: TextStyleOptions, resolution = 4,
): Container {
  const holder = new Container()
  const t = new Text({ text, style, resolution })
  t.anchor.set(0.5)
  holder.addChild(t)
  const p = iso(at[0], at[1], at[2])
  holder.setFromMatrix(new Matrix(1, plane === 'z' ? ISO_RISE : -ISO_RISE, 0, 1, p.x, p.y))
  return holder
}

/** Deterministic PRNG so the painted skyline and props never change between reloads. */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

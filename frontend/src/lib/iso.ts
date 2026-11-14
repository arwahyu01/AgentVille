/** Isometric (2:1 dimetric) projection for the 2D office view.
 *
 *  The viewer stands at the +x/+z corner of the floor plate looking toward -x/-z, so the north
 *  (z = -9) and west (x = -13) perimeter walls are the back walls and everything with a larger
 *  `x + z` is nearer to the viewer. World units stay metres (the same coordinates as
 *  `officeLayout.ts`), so the 2D view and the 3D scene agree on where every desk and person is. */

/** Screen pixels per metre along a floor axis, before the camera zoom. */
export const ISO_UNIT = 32
/** Vertical squash of the floor plane: 0.5 gives the classic 2:1 pixel-art diamond. */
export const ISO_RISE = 0.5
/** Screen pixels per metre of height, as a fraction of ISO_UNIT. */
export const ISO_HEIGHT = 1.0

export interface ScreenPoint { x: number; y: number }

/** World (x, z, height y) → unzoomed screen space. */
export function iso(x: number, z: number, y = 0): ScreenPoint {
  return {
    x: (x - z) * ISO_UNIT,
    y: (x + z) * ISO_UNIT * ISO_RISE - y * ISO_UNIT * ISO_HEIGHT,
  }
}

/** Inverse of `iso` on the floor plane (y = 0). */
export function floorAt(sx: number, sy: number): { x: number; z: number } {
  const diff = sx / ISO_UNIT
  const sum = sy / (ISO_UNIT * ISO_RISE)
  return { x: (sum + diff) / 2, z: (sum - diff) / 2 }
}

/** Painter's order: larger values are nearer the viewer and must be drawn later. */
export function depthOf(x: number, z: number): number {
  return x + z
}

/** Integer z-index for a sortable container. `bias` nudges ties (e.g. a chair back in front of
 *  the person sitting on it) without crossing to the next 1 cm step of depth. */
export function zIndexOf(x: number, z: number, bias = 0): number {
  return Math.round((depthOf(x, z) + bias) * 100)
}

/** Screen-space bounding box of a floor rectangle extruded to `height`. */
export function boxBounds(box: [number, number, number, number], height = 0): {
  minX: number; minY: number; maxX: number; maxY: number
} {
  const [x0, z0, x1, z1] = box
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
    for (const y of [0, height]) {
      const p = iso(x, z, y)
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
  }
  return { minX, minY, maxX, maxY }
}

export interface IsoView {
  /** Camera zoom applied to the world container. */
  scale: number
  /** World-container offset that centres the box in the viewport. */
  x: number
  y: number
}

/** Zoom and offset that fit a floor rectangle (with walls of `height`) inside a viewport. */
export function fitView(
  box: [number, number, number, number], viewW: number, viewH: number,
  opts: { height?: number; pad?: number; maxScale?: number; minScale?: number } = {},
): IsoView {
  const { height = 3, pad = 24, maxScale = 3, minScale = 0.25 } = opts
  const b = boxBounds(box, height)
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const fit = Math.min((viewW - pad * 2) / w, (viewH - pad * 2) / h)
  const scale = Math.min(maxScale, Math.max(minScale, fit))
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  return { scale, x: viewW / 2 - cx * scale, y: viewH / 2 - cy * scale }
}

/** Zoom about a fixed screen point (the cursor), keeping that point over the same world spot. */
export function zoomAt(view: IsoView, factor: number, px: number, py: number, min = 0.25, max = 4): IsoView {
  const scale = Math.min(max, Math.max(min, view.scale * factor))
  const k = scale / view.scale
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }
}

/** Which way a figure reads on screen for a world facing angle (0 = +z, atan2(dx, dz)).
 *  `front` is true when the face is turned toward the viewer, `flip` when it looks screen-left. */
export function facingView(facing: number): { front: boolean; flip: boolean } {
  const dx = Math.sin(facing)
  const dz = Math.cos(facing)
  return { front: dx + dz > -0.15, flip: dx - dz < 0 }
}

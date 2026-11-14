import { describe, expect, it } from 'vitest'
import { depthOf, facingView, fitView, floorAt, iso, zIndexOf, zoomAt } from './iso'
import { FLOOR } from './officeLayout'

describe('iso projection', () => {
  it('round-trips floor points through the inverse', () => {
    for (const [x, z] of [[0, 0], [-13, 9], [12.5, -8.25], [3.4, 1.7]]) {
      const p = iso(x, z)
      const back = floorAt(p.x, p.y)
      expect(back.x).toBeCloseTo(x, 6)
      expect(back.z).toBeCloseTo(z, 6)
    }
  })

  it('draws the north-west corner furthest and the south-east corner nearest', () => {
    const nw = depthOf(-FLOOR.halfX, -FLOOR.halfZ)
    const se = depthOf(FLOOR.halfX, FLOOR.halfZ)
    expect(nw).toBeLessThan(se)
    // A person just south of a desk (the chair side) is drawn over that desk.
    expect(zIndexOf(-5, -4.6 + 0.78)).toBeGreaterThan(zIndexOf(-5, -4.6))
  })

  it('lifts height straight up the screen', () => {
    const floor = iso(2, 3)
    const raised = iso(2, 3, 1.5)
    expect(raised.x).toBe(floor.x)
    expect(raised.y).toBeLessThan(floor.y)
  })

  it('fits the whole floor plate inside the viewport', () => {
    const box: [number, number, number, number] = [-FLOOR.halfX, -FLOOR.halfZ, FLOOR.halfX, FLOOR.halfZ]
    const v = fitView(box, 900, 520, { pad: 20 })
    for (const [x, z] of [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]) {
      const p = iso(x, z)
      const sx = p.x * v.scale + v.x
      const sy = p.y * v.scale + v.y
      expect(sx).toBeGreaterThanOrEqual(19)
      expect(sx).toBeLessThanOrEqual(881)
      expect(sy).toBeGreaterThanOrEqual(19)
      expect(sy).toBeLessThanOrEqual(501)
    }
  })

  it('keeps the cursor over the same world point while zooming', () => {
    const v = { scale: 1, x: 120, y: 40 }
    const z = zoomAt(v, 1.6, 300, 200)
    const worldX = (300 - v.x) / v.scale
    expect((300 - z.x) / z.scale).toBeCloseTo(worldX, 6)
    expect(z.scale).toBeCloseTo(1.6)
  })

  it('reads a north-facing desk worker from behind and a south-facing one from the front', () => {
    expect(facingView(Math.PI).front).toBe(false)
    expect(facingView(0).front).toBe(true)
    // Walking toward +x heads screen-right; toward +z heads screen-left.
    expect(facingView(Math.PI / 2).flip).toBe(false)
    expect(facingView(0).flip).toBe(true)
  })
})

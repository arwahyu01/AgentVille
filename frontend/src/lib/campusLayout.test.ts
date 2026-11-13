import { describe, expect, it } from 'vitest'
import { ENTRANCE, FLOOR } from './officeLayout'
import {
  BRIDGE, BRIDGE_APPROACH, CAFE, CAFE_APPROACH, CAMPUS_BOUNDS, CROSSWALKS,
  DISTRICT, DISTRICT_PLAZA, ENTRANCE_PROMENADE, PARK, PARKING, PARKING_LINK, PLAZA, PROMENADE,
  RIVER, ROAD, TREES, WALKS, groundHeightAt, rectContains, rectIntersects,
  type Rect,
} from './campusLayout'

const touches = (a: Rect, b: Rect): boolean =>
  a.x0 <= b.x1 + 0.001 && a.x1 >= b.x0 - 0.001 && a.z0 <= b.z1 + 0.001 && a.z1 >= b.z0 - 0.001

describe('Green Tech Campus plan', () => {
  it('puts the plaza and promenade on the real entrance centre line', () => {
    expect(ENTRANCE.z).toBe(FLOOR.halfZ)
    expect((PLAZA.z0 + PLAZA.z1) / 2).toBeGreaterThan(ENTRANCE.z)
    expect(rectContains(PLAZA, ENTRANCE.x, ENTRANCE.z + 0.2)).toBe(true)
    expect(ENTRANCE_PROMENADE.z0).toBe(ENTRANCE.z)
    expect((ENTRANCE_PROMENADE.x0 + ENTRANCE_PROMENADE.x1) / 2).toBeCloseTo(ENTRANCE.x, 6)
    expect(rectContains(ENTRANCE_PROMENADE, ...ENTRANCE.plazaSpawn)).toBe(true)
  })

  it('keeps every built element inside the bounded site', () => {
    const rects: Rect[] = [
      PLAZA, ENTRANCE_PROMENADE, ROAD, BRIDGE, RIVER, PARK, CAFE, PARKING,
      ...WALKS, ...DISTRICT,
    ]
    for (const r of rects) {
      expect(r.x0).toBeGreaterThanOrEqual(CAMPUS_BOUNDS.x0)
      expect(r.x1).toBeLessThanOrEqual(CAMPUS_BOUNDS.x1)
      expect(r.z0).toBeGreaterThanOrEqual(CAMPUS_BOUNDS.z0)
      expect(r.z1).toBeLessThanOrEqual(CAMPUS_BOUNDS.z1)
    }
  })

  it('does not drive the road, river, café or parking through the office', () => {
    const office: Rect = { x0: -FLOOR.halfX, z0: -FLOOR.halfZ, x1: FLOOR.halfX, z1: FLOOR.halfZ }
    for (const solid of [ROAD, RIVER, PARKING, CAFE]) {
      expect(rectIntersects(office, solid), `${solid.x0},${solid.z0} overlaps the office`).toBe(false)
    }
    for (const b of DISTRICT) {
      expect(rectIntersects(office, b)).toBe(false)
    }
  })

  it('connects entrance → plaza → forecourt → crosswalk → parking', () => {
    expect(touches(ENTRANCE_PROMENADE, PLAZA)).toBe(true)
    expect(PLAZA.z1).toBeGreaterThanOrEqual(23)
    expect(touches(PARKING_LINK, PARKING)).toBe(true)
    expect(WALKS.some((w) => touches(w, PARKING))).toBe(true)
    expect(WALKS.some((w) => touches(w, ROAD) || touches(w, { x0: -23, z0: 38, x1: -19, z1: 40 }))).toBe(true)
    for (const cw of CROSSWALKS) expect(rectContains(ROAD, (cw.x0 + cw.x1) / 2, (cw.z0 + cw.z1) / 2)).toBe(true)
  })

  it('connects the plaza to the bridge and both river banks', () => {
    expect(touches(BRIDGE_APPROACH, PLAZA)).toBe(true)
    expect(touches(BRIDGE_APPROACH, BRIDGE)).toBe(true)
    expect(rectIntersects(BRIDGE, RIVER)).toBe(true)
    expect(WALKS.some((w) => touches(w, BRIDGE))).toBe(true)
  })

  it('connects the plaza to the café and the park loop', () => {
    expect(touches(CAFE_APPROACH, PLAZA)).toBe(true)
    expect(touches(CAFE_APPROACH, CAFE)).toBe(true)
    expect(WALKS.some((w) => touches(w, PROMENADE))).toBe(true)
    expect(touches(PROMENADE, PARK)).toBe(true)
  })

  it('gives the Innovation District a paved route from the forecourt', () => {
    expect(WALKS.some((w) => touches(w, PLAZA) && touches(w, DISTRICT_PLAZA))).toBe(true)
  })

  it('keeps trees off every walk, plaza, rock and building', () => {
    expect(TREES.length).toBeGreaterThan(20)
    const keepClear: Rect[] = [PLAZA, ENTRANCE_PROMENADE, ROAD, PARKING, CAFE, ...WALKS]
    for (const t of TREES) {
      expect(rectContains(CAMPUS_BOUNDS, t.x, t.z, -0.4), `tree ${t.x},${t.z} outside site`).toBe(true)
      for (const r of keepClear) {
        expect(rectContains(r, t.x, t.z, 0.8), `tree ${t.x},${t.z} blocks a path`).toBe(false)
      }
      for (const b of DISTRICT) expect(rectContains(b, t.x, t.z, 1.8)).toBe(false)
    }
  })

  it('never places a tree on the entrance sightline', () => {
    for (const t of TREES) {
      const onApproach = Math.abs(t.x - ENTRANCE.x) < 3 && t.z > ENTRANCE.z - 1 && t.z < 24
      expect(onApproach).toBe(false)
    }
  })

  it('returns a different ground height on the bridge, paving and grass', () => {
    expect(groundHeightAt(-40, 15.75)).toBeCloseTo(0.16, 5)
    expect(groundHeightAt(-10.2, 18)).toBeCloseTo(0.03, 5)
    expect(groundHeightAt(-2, 44)).toBe(0)
    expect(groundHeightAt(38, 12)).toBe(0)
  })
})

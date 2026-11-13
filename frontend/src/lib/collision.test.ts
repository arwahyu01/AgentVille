import { describe, expect, it } from 'vitest'
import { ENTRANCE, ROOMS, WALLS } from './officeLayout'
import {
  CAMPUS_VISIT_POINTS, ENTRANCE_INSIDE, ENTRANCE_OUTSIDE, EYE_HEIGHT, OFFICE_BOXES,
  PLAYER_RADIUS, blockedAt, eyeAt, isOfficeInterior, moveWithCollision, wallBoxes,
} from './collision'
import { BRIDGE, CAMPUS_BOUNDS, RIVER, TREES, groundHeightAt } from './campusLayout'

/** Deterministic breadth-first walk over the real collision world, on a 0.25 m grid.
 *  A hand-picked list of waypoints would not prove the route is actually walkable. */
function reachable(start: [number, number], goal: [number, number], region = {
  x0: -14.5, z0: -11, x1: 18.5, z1: 26,
}, step = 0.25): boolean {
  const nx = Math.ceil((region.x1 - region.x0) / step) + 1
  const nz = Math.ceil((region.z1 - region.z0) / step) + 1
  const seen = new Uint8Array(nx * nz)
  const toCell = (p: [number, number]): [number, number] => [
    Math.round((p[0] - region.x0) / step),
    Math.round((p[1] - region.z0) / step),
  ]
  const [sx, sz] = toCell(start)
  const [gx, gz] = toCell(goal)
  const queue: [number, number][] = [[sx, sz]]
  seen[sz * nx + sx] = 1
  for (let head = 0; head < queue.length; head++) {
    const [cx, cz] = queue[head]
    if (cx === gx && cz === gz) return true
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = cx + dx
      const z = cz + dz
      if (x < 0 || z < 0 || x >= nx || z >= nz) continue
      const key = z * nx + x
      if (seen[key]) continue
      seen[key] = 1
      if (blockedAt(region.x0 + x * step, region.z0 + z * step)) continue
      queue.push([x, z])
    }
  }
  return false
}

describe('collision world', () => {
  it('keeps the entrance aisle walkable from the plaza to the lobby', () => {
    for (let z = ENTRANCE.z + 11; z >= ENTRANCE_INSIDE[1] - 0.2; z -= 0.2) {
      const x = ENTRANCE.x
      expect(blockedAt(x, z), `entrance aisle blocked at ${x},${z.toFixed(2)}`).toBe(false)
    }
    expect(blockedAt(ENTRANCE_OUTSIDE[0], ENTRANCE_OUTSIDE[1])).toBe(false)
    expect(isOfficeInterior(ENTRANCE_INSIDE[0], ENTRANCE_INSIDE[1])).toBe(true)
  })

  it('actually connects plaza → entrance → lobby → corridor', () => {
    expect(reachable(ENTRANCE.plazaSpawn, ENTRANCE_INSIDE)).toBe(true)
    expect(reachable(ENTRANCE_INSIDE, [0, 0])).toBe(true)
    // The walk must cross the real doorway, not slip through a glazed bay.
    expect(reachable([ENTRANCE.x, ENTRANCE.z + 2], [ENTRANCE.x, ENTRANCE.z - 2])).toBe(true)
  })

  it('keeps every room doorway open and the wall beside it solid', () => {
    for (const room of Object.values(ROOMS)) {
      const [dx, dz] = room.door
      expect(blockedAt(dx, dz), `${room.id} door blocked`).toBe(false)
      const away = room.band === 'north' ? -0.5 : 0.5
      expect(blockedAt(dx, dz + away), `${room.id} door approach blocked`).toBe(false)
      // A solid pier either side of a 1.1 m doorway is what proves the door is real.
      expect(blockedAt(dx + 1.3, dz), `${room.id} wall beside door is walk-through`).toBe(true)
    }
  })

  it('splits a wall segment around its doorway', () => {
    const pieces = wallBoxes([-13, 9], [13, 9], { at: 2.8, width: 2.6 })
    expect(pieces).toHaveLength(2)
    expect(pieces[0]).toMatchObject({ x0: -13, x1: -11.5 })
    expect(pieces[1]).toMatchObject({ x0: -8.9, x1: 13 })
    for (let x = -12.9; x < 12.9; x += 0.1) {
      if (x > -11.5 && x < -8.9) continue
      const solid = pieces.some((p) => x >= p.x0 && x <= p.x1)
      expect(solid).toBe(true)
    }
  })

  it('blocks the shell, furniture and river, and leaves the bridge deck open', () => {
    expect(blockedAt(-13, 0)).toBe(true)
    expect(blockedAt(13, 0)).toBe(true)
    expect(blockedAt(0, -9)).toBe(true)
    expect(blockedAt(0, 9)).toBe(true)
    expect(blockedAt(-12.15, 4.6)).toBe(true) // reception desk on the west wall
    expect(blockedAt(-10.2, 3.7)).toBe(false) // the door→corridor lane itself stays clear
    expect(blockedAt(-8.15, 6.9)).toBe(true) // waiting sofa
    expect(blockedAt(-11.35, 6.95)).toBe(true) // front-desk greeter
    expect(blockedAt(-10.2, 6.95)).toBe(false) // entrance aisle beside the greeter
    expect(blockedAt(-40, 0)).toBe(true) // river
    expect(blockedAt(RIVER.x0 + 1, RIVER.z1 - 1)).toBe(true)
    expect(blockedAt((BRIDGE.x0 + BRIDGE.x1) / 2, 15.75)).toBe(false)
    expect(blockedAt((BRIDGE.x0 + BRIDGE.x1) / 2, BRIDGE.z0 + 0.02)).toBe(true) // rail
  })

  it('blocks tree trunks and keeps the bounds closed', () => {
    for (const t of TREES.slice(0, 12)) expect(blockedAt(t.x, t.z)).toBe(true)
    expect(blockedAt(CAMPUS_BOUNDS.x0 - 0.1, 0)).toBe(true)
    expect(blockedAt(CAMPUS_BOUNDS.x1 + 0.1, 0)).toBe(true)
    expect(blockedAt(0, CAMPUS_BOUNDS.z0 - 0.1)).toBe(true)
    expect(blockedAt(0, CAMPUS_BOUNDS.z1 + 0.1)).toBe(true)
  })

  it('offers unblocked destinations across the whole campus', () => {
    for (const [x, z] of CAMPUS_VISIT_POINTS) {
      expect(blockedAt(x, z), `visit point ${x},${z} is inside a solid`).toBe(false)
      expect(blockedAt(x, z)).toBe(false)
    }
  })

  it('actually walks from the plaza to the bridge, café, park and district', () => {
    // Same breadth-first proof as the office, over the full bounded site at 0.5 m resolution:
    // the river has one crossing and the road has crosswalks, so this fails if a prop, tree or
    // rail accidentally seals a route rather than merely narrowing it.
    const site = { x0: -57.5, z0: -57.5, x1: 57.5, z1: 57.5 }
    for (const point of CAMPUS_VISIT_POINTS.slice(1)) {
      expect(reachable(ENTRANCE.plazaSpawn, point, site, 0.5),
        `no walkable campus route to ${point[0]},${point[1]}`).toBe(true)
    }
  })

  it('leaves a straight guest lane from the main door to the corridor doorway', () => {
    // The entrance and the lobby→corridor doorway share the x=-10.2 axis, so the whole lane has
    // to be walkable at the player's own width, not merely passable by a detour.
    for (let z = ENTRANCE.z - 0.2; z >= 1.9; z -= 0.2) {
      expect(blockedAt(ENTRANCE.x, z), `guest lane blocked at ${ENTRANCE.x},${z.toFixed(2)}`).toBe(false)
    }
    // Reception is visible from the door: it sits in the west quarter, on the walking line's left.
    expect(blockedAt(-12.15, 4.6)).toBe(true)
    expect(ROOMS.lobby.box[0]).toBeLessThan(-12.15)
  })

  it('slides along a wall instead of stopping dead', () => {
    // Facing the west curtain wall, clear of the reception fitout: the x push is rejected, the z
    // push still resolves.
    const at = moveWithCollision(-12.2, 7.0, -0.6, 0.5)
    expect(at.hit).toBe(true)
    expect(at.x).toBeCloseTo(-12.2, 6)
    expect(at.z).toBeCloseTo(7.5, 6)
    // A clear step resolves fully with no hit flag.
    const free = moveWithCollision(0, 25, 0.5, -0.5)
    expect(free).toEqual({ x: 0.5, z: 24.5, hit: false })
    // Never lands inside a solid, even when pushed repeatedly at one.
    let p = { x: -12.2, z: 7.0 }
    for (let i = 0; i < 40; i++) p = moveWithCollision(p.x, p.z, -0.4, 0)
    expect(blockedAt(p.x, p.z)).toBe(false)
    expect(p.x).toBeGreaterThan(-13)
  })

  it('keeps the office blockers inside the office plate', () => {
    for (const b of OFFICE_BOXES) {
      expect(b.x1).toBeGreaterThan(b.x0)
      expect(b.z1).toBeGreaterThan(b.z0)
      expect(b.x0).toBeGreaterThanOrEqual(-13.2)
      expect(b.x1).toBeLessThanOrEqual(13.2)
      expect(b.z0).toBeGreaterThanOrEqual(-9.2)
      expect(b.z1).toBeLessThanOrEqual(9.2)
    }
    expect(WALLS.length).toBeGreaterThan(14)
  })

  it('raises the eye on the bridge deck and lowers it on the pavement and grass', () => {
    expect(eyeAt(-40, 15.75)).toBeCloseTo(0.16 + EYE_HEIGHT, 5)
    expect(eyeAt(ENTRANCE.plazaSpawn[0], ENTRANCE.plazaSpawn[1])).toBeCloseTo(0.03 + EYE_HEIGHT, 5)
    expect(eyeAt(-2, 44)).toBeCloseTo(EYE_HEIGHT, 5)
    expect(eyeAt(-40, 15.75) - eyeAt(-2, 44)).toBeCloseTo(0.16, 5)
  })

  it('does not over-block the open plaza clearing', () => {
    const clearing: [number, number][] = [
      [ENTRANCE.x, 11], [ENTRANCE.x, 14], [ENTRANCE.x, 17],
      [ENTRANCE.x - 3, 12], [ENTRANCE.x + 3, 12],
      [ENTRANCE.x - 3, 19], [ENTRANCE.x + 3, 19],
    ]
    for (const [x, z] of clearing) {
      expect(groundHeightAt(x, z)).toBeGreaterThan(0)
      expect(blockedAt(x, z, PLAYER_RADIUS / 2), `${x},${z} too tight`).toBe(false)
    }
  })
})

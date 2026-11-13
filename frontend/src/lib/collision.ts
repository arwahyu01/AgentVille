/** Pure collision world for the office + compact campus.
 *
 *  The renderer, the first-person controller and the tests all read the same
 *  blockers. Nothing here touches React or Three: a position is walkable or it
 *  is not, which keeps the movement contract testable without a browser.
 */
import {
  ENTRANCE, FLOOR, ROOMS, WALLS, type Room,
} from './officeLayout'
import {
  BENCHES, BIKE_RACKS, BRIDGE, CAFE_CHAIRS, CAFE_COUNTER, CAFE_TABLES,
  CAMPUS_BOUNDS, CARS, DISTRICT, LAMPS, PARK_PAVILION, PLANTERS, PORTAL_POSTS,
  RIVER, SHRUBS, TREES, groundHeightAt, type Rect,
} from './campusLayout'

export interface Box {
  x0: number
  z0: number
  x1: number
  z1: number
}

export interface Round {
  x: number
  z: number
  r: number
}

export type Ground = 'paving' | 'grass' | 'bridge' | 'water'

export const PLAYER_RADIUS = 0.3
export const EYE_HEIGHT = 1.64

const box = (x0: number, z0: number, x1: number, z1: number): Box => ({
  x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1),
})

/* ── office walls ──────────────────────────────────────────────────────────── */

const WALL_T = 0.12

/** Split one wall segment into solid pieces around its doorway (if it has one). */
export function wallBoxes(a: [number, number], b: [number, number], door?: { at: number; width: number }): Box[] {
  const horizontal = Math.abs(a[1] - b[1]) < 1e-6
  const start = horizontal ? a[0] : a[1]
  const end = horizontal ? b[0] : b[1]
  const dir = Math.sign(end - start) || 1
  const pieces: [number, number][] = []
  if (door) {
    const d0 = start + (door.at - door.width / 2) * dir
    const d1 = start + (door.at + door.width / 2) * dir
    const lo = Math.min(d0, d1)
    const hi = Math.max(d0, d1)
    const min = Math.min(start, end)
    const max = Math.max(start, end)
    if (lo > min + 0.01) pieces.push([min, lo])
    if (hi < max - 0.01) pieces.push([hi, max])
  } else {
    pieces.push([Math.min(start, end), Math.max(start, end)])
  }
  return pieces.map(([p0, p1]) => horizontal
    ? box(p0, a[1] - WALL_T / 2, p1, a[1] + WALL_T / 2)
    : box(a[0] - WALL_T / 2, p0, a[0] + WALL_T / 2, p1))
}

/* ── office furniture ──────────────────────────────────────────────────────── */

const FURNITURE_BOXES: Box[] = [
  // Lobby: reception faces east from the west wall, keeping the door→corridor lane clear.
  box(-12.6, 3.2, -11.7, 6.0),       // reception desk (2.6 wide along z at -12.15 / 4.6)
  box(-13, 3.6, -12.72, 5.6),        // slatted logo backdrop on the west wall
  box(-8.62, 5.96, -7.68, 7.84),     // two-seat sofa against the east wall
  box(-9.55, 6.35, -8.95, 7.45),     // coffee table
  box(-8.54, 7.86, -7.76, 8.64),     // armchair beside the entrance
  // Pantry: wet run, tall fridge, bistro tables.
  box(12.35, 4.2, 13, 8.2),
  box(12.3, 2.3, 13, 3.2),
  // Server room racks (three on the north wall, two on the west wall).
  box(-12.6, -8.95, -10.2, -8.35),
  box(-12.95, -6.5, -12.3, -5.0),
  // Corridor-adjacent heavy pieces.
  box(-7.8 - 0.7, -8.7, -7.8 + 0.7, -8.25),   // dev credenza west
  box(-2.2 - 0.7, -8.7, -2.2 + 0.7, -8.25),   // dev credenza east
  box(-8.6, -4.75, -8.25, -3.65),             // dev shelf
  box(-6.5 - 0.55, 2.2, -6.5 + 0.55, 2.6),    // analyst credenza
  box(-2.8, 2.75, -2.45, 4.05),               // analyst shelf
  box(-2.35, 2.4, -2.05, 3.8),                // design material library
  box(9.75 - 0.6, -8.7, 9.75 + 0.6, -8.25),   // admin credenza
  box(12.35, -8.7, 12.95, -7.5),              // admin filing
  box(5.3, -8.6, 5.9, -8.0),                  // security shelf
  // Customer service / teller hall: the counter run and the waiting bench.
  box(-1.15, -8.26, 5.15, -7.54),             // teller counter along the north wall
  box(4.67, -4.4, 5.23, -2.8),                // waiting bench on the east wall
  box(8.5, 2.45, 8.95, 3.55),                 // meeting credenza
  box(6.2 - 0.95, 7.95, 6.2 + 0.95, 8.85),    // meeting sofa
  // Meeting table.
  box(6.2 - 1.45, 5.6 - 0.62, 6.2 + 1.45, 5.6 + 0.62),
]

const FURNITURE_ROUNDS: Round[] = [
  // Lobby greenery.
  { x: -12.5, z: 8.4, r: 0.3 },
  // Front-desk greeter stands south of reception, off the entrance aisle.
  { x: -11.35, z: 6.95, r: 0.28 },
  // Pantry bistro tables.
  { x: 10.3, z: 4.2, r: 0.42 }, { x: 10.6, z: 7.2, r: 0.42 },
  // Loose plants and small trees around the fitouts.
  { x: -8.05, z: -2.35, r: 0.24 }, { x: -1.85, z: -2.3, r: 0.2 },
  { x: -1.0, z: -2.35, r: 0.2 }, { x: 4.6, z: -7.4, r: 0.28 },
  { x: -2.8, z: 8.2, r: 0.24 }, { x: -2.15, z: 8.2, r: 0.28 },
  { x: 3.05, z: 2.4, r: 0.2 }, { x: 9.4, z: -2.4, r: 0.2 },
  { x: 8.6, z: -3.2, r: 0.2 }, { x: 9.45, z: 8.3, r: 0.2 },
  { x: 4.0, z: 2.4, r: 0.2 },
  // Teller-hall queue stanchions and the visitor chairs on the consultation desks.
  { x: -0.6, z: -7.0, r: 0.16 }, { x: -0.6, z: -5.8, r: 0.16 }, { x: -0.6, z: -4.6, r: 0.16 },
  { x: 4.6, z: -7.0, r: 0.16 }, { x: 4.6, z: -5.8, r: 0.16 }, { x: 4.6, z: -4.6, r: 0.16 },
  { x: 0.2, z: -4.62, r: 0.29 }, { x: 2.0, z: -4.62, r: 0.29 }, { x: 3.8, z: -4.62, r: 0.29 },
]

/** Desks and chairs derived from the same station anchors the agents use. */
function stationFurniture(): { boxes: Box[]; rounds: Round[] } {
  const boxes: Box[] = []
  const rounds: Round[] = []
  for (const room of Object.values(ROOMS)) {
    if (room.id === 'meeting') {
      for (const [x, z] of room.stations) rounds.push({ x, z, r: 0.28 })
      continue
    }
    if (room.id === 'lobby' || room.id === 'pantry' || room.id === 'server') continue
    const wide = room.id === 'cs' || room.id === 'analyst' || room.id === 'design' || room.id === 'security'
    for (const [x, z] of room.stations) {
      const halfW = wide ? 0.72 : 0.78
      boxes.push(box(x - halfW, z - 0.4, x + halfW, z + 0.4))
      if (room.kind === 'dept' || room.id === 'security') rounds.push({ x, z: z + 0.82, r: 0.29 })
    }
  }
  return { boxes, rounds }
}

const stations = stationFurniture()

export const OFFICE_BOXES: Box[] = [
  ...WALLS.flatMap((seg) => wallBoxes(seg.a, seg.b, seg.door)),
  ...FURNITURE_BOXES,
  ...stations.boxes,
]
export const OFFICE_CIRCLES: Round[] = [...FURNITURE_ROUNDS, ...stations.rounds]

/* ── campus solids ─────────────────────────────────────────────────────────── */

function benchBox(x: number, z: number, ry: number): Box {
  const along = Math.abs(Math.cos(ry)) > 0.5
  return along ? box(x - 0.8, z - 0.28, x + 0.8, z + 0.28) : box(x - 0.28, z - 0.8, x + 0.28, z + 0.8)
}

function rackBoxes(): Box[] {
  // Four slender rack rails, enough to stop the player walking through the rack.
  return BIKE_RACKS.flatMap(({ x, z, n }) => Array.from({ length: n }, (_, i) =>
    box(x - 0.32, z - 0.3 + i * 0.55, x + 0.32, z + 0.2 + i * 0.55)))
}

export const CAMPUS_BOXES: Box[] = [
  ...DISTRICT.map((b) => box(b.x0, b.z0, b.x1, b.z1)),
  ...PLANTERS.map((p) => box(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2)),
  ...BENCHES.map((b) => benchBox(b.x, b.z, b.ry)),
  ...CARS.map((c) => box(c.x - 0.92, c.z - 2.1, c.x + 0.92, c.z + 2.1)),
  box(CAFE_COUNTER.x0, CAFE_COUNTER.z0, CAFE_COUNTER.x1, CAFE_COUNTER.z1),
  // Bridge rails keep the player on the deck.
  box(BRIDGE.x0, BRIDGE.z0 - 0.08, BRIDGE.x1, BRIDGE.z0 + 0.05),
  box(BRIDGE.x0, BRIDGE.z1 - 0.05, BRIDGE.x1, BRIDGE.z1 + 0.08),
  // Pavilion posts.
  box(PARK_PAVILION.x0, PARK_PAVILION.z0, PARK_PAVILION.x0 + 0.24, PARK_PAVILION.z0 + 0.24),
  box(PARK_PAVILION.x1 - 0.24, PARK_PAVILION.z0, PARK_PAVILION.x1, PARK_PAVILION.z0 + 0.24),
  box(PARK_PAVILION.x0, PARK_PAVILION.z1 - 0.24, PARK_PAVILION.x0 + 0.24, PARK_PAVILION.z1),
  box(PARK_PAVILION.x1 - 0.24, PARK_PAVILION.z1 - 0.24, PARK_PAVILION.x1, PARK_PAVILION.z1),
  ...rackBoxes(),
  // River segments either side of the bridge: water is not walkable.
  box(RIVER.x0, RIVER.z0, RIVER.x1, BRIDGE.z0 - 0.05),
  box(RIVER.x0, BRIDGE.z1 + 0.05, RIVER.x1, RIVER.z1),
  // Office shell so the player cannot walk through the façade.
  ...OFFICE_BOXES,
]

export const CAMPUS_CIRCLES: Round[] = [
  ...TREES.map((t) => ({ x: t.x, z: t.z, r: t.trunk + 0.06 })),
  ...SHRUBS.map((s) => ({ x: s.x, z: s.z, r: s.r * 0.6 })),
  ...LAMPS.map((l) => ({ x: l.x, z: l.z, r: l.tall ? 0.16 : 0.12 })),
  ...PORTAL_POSTS,
  ...CAFE_TABLES.map((t) => ({ x: t.x, z: t.z, r: 0.52 })),
  ...CAFE_CHAIRS.map((c) => ({ x: c.x, z: c.z, r: 0.24 })),
  ...OFFICE_CIRCLES,
]

/* ── queries ───────────────────────────────────────────────────────────────── */

export function circleHitsBox(x: number, z: number, r: number, b: Box): boolean {
  const cx = Math.max(b.x0, Math.min(x, b.x1))
  const cz = Math.max(b.z0, Math.min(z, b.z1))
  const dx = x - cx
  const dz = z - cz
  return dx * dx + dz * dz < r * r
}

/** True when a circle of `radius` at (x, z) intersects any solid or leaves the site. */
export function blockedAt(x: number, z: number, radius = PLAYER_RADIUS): boolean {
  if (x < CAMPUS_BOUNDS.x0 + radius || x > CAMPUS_BOUNDS.x1 - radius) return true
  if (z < CAMPUS_BOUNDS.z0 + radius || z > CAMPUS_BOUNDS.z1 - radius) return true
  for (const b of CAMPUS_BOXES) if (circleHitsBox(x, z, radius, b)) return true
  for (const c of CAMPUS_CIRCLES) {
    const dx = x - c.x
    const dz = z - c.z
    const reach = radius + c.r
    if (dx * dx + dz * dz < reach * reach) return true
  }
  return false
}

/** Axis-separated slide movement. Returns the resolved position; never enters a solid. */
export function moveWithCollision(
  x: number, z: number, dx: number, dz: number, radius = PLAYER_RADIUS,
): { x: number; z: number; hit: boolean } {
  let nx = x
  let nz = z
  let hit = false
  if (dx !== 0) {
    const tryX = nx + dx
    if (!blockedAt(tryX, nz, radius)) nx = tryX
    else hit = true
  }
  if (dz !== 0) {
    const tryZ = nz + dz
    if (!blockedAt(nx, tryZ, radius)) nz = tryZ
    else hit = true
  }
  return { x: nx, z: nz, hit }
}

export function clampToCampus(x: number, z: number, radius = PLAYER_RADIUS): { x: number; z: number } {
  return {
    x: Math.max(CAMPUS_BOUNDS.x0 + radius, Math.min(CAMPUS_BOUNDS.x1 - radius, x)),
    z: Math.max(CAMPUS_BOUNDS.z0 + radius, Math.min(CAMPUS_BOUNDS.z1 - radius, z)),
  }
}

/** Camera height at a point. Kept separate from collision so the controller can ease it. */
export function eyeAt(x: number, z: number): number {
  return groundHeightAt(x, z) + EYE_HEIGHT
}

/** Exit point just outside the entrance, used by the proximity hint and tests. */
export const ENTRANCE_OUTSIDE: [number, number] = [ENTRANCE.x, ENTRANCE.z + 1.6]
export const ENTRANCE_INSIDE = ENTRANCE.spawn
export const OFFICE_CENTER: [number, number] = [0, 0]
export const CAMPUS_VISIT_POINTS: [number, number][] = [
  [ENTRANCE.x, 18],
  [0, 25],
  [39, 12],
  [-38, 15.75],
  [-23, 44],
]

/** A handful of fitness checks used by tests and by the QA debug hook. */
export function isOfficeInterior(x: number, z: number): boolean {
  return x > -FLOOR.halfX && x < FLOOR.halfX && z > -FLOOR.halfZ && z < FLOOR.halfZ
}

export function rectOfRoom(room: Room): Rect {
  return { x0: room.box[0], z0: room.box[1], x1: room.box[2], z1: room.box[3] }
}

/** Deterministic, bounded Green Tech Campus plan.
 *
 *  One world unit is one metre. The office footprint is x[-13,13], z[-9,9] and the
 *  main entrance is on the south facade at x=-10.2, z=+9. Every outdoor path,
 *  tree and solid is derived from this data so the renderer, collision and the
 *  tests cannot drift apart. The campus is compact and bounded: the hills beyond
 *  CAMPUS_BOUNDS are landscape, not playable ground.
 */
import { ENTRANCE, FLOOR } from './officeLayout'

export interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

export interface Circle {
  x: number
  z: number
  r: number
}

export interface Building {
  id: string
  label: string
  x0: number
  z0: number
  x1: number
  z1: number
  height: number
  wall: string
  glass: string
  roof: string
}

export interface Tree {
  x: number
  z: number
  /** Canopy radius, metres. */
  r: number
  /** Trunk height before the canopy starts. */
  h: number
  /** Collision radius of the trunk. */
  trunk: number
  kind: number
}

export const CAMPUS_BOUNDS: Rect = { x0: -58, z0: -58, x1: 58, z1: 58 }

/* ── office forecourt ──────────────────────────────────────────────────────── */

/** Directly in front of the real entrance. The central promenade lines up with it. */
export const PLAZA: Rect = { x0: -17, z0: 9, x1: -3, z1: 23 }
export const ENTRANCE_PROMENADE: Rect = { x0: -11.7, z0: 9, x1: -8.7, z1: 23 }
export const FORECOURT: Rect = { x0: -17, z0: 23, x1: 4, z1: 29 }

/** Vehicle network: one east-west road with two sidewalks. */
export const SIDEWALK_SOUTH: Rect = { x0: -56, z0: 29, x1: 56, z1: 31 }
export const ROAD: Rect = { x0: -56, z0: 31, x1: 56, z1: 36 }
export const SIDEWALK_NORTH: Rect = { x0: -56, z0: 36, x1: 56, z1: 38 }
export const DROP_OFF_LANE: Rect = { x0: -2, z0: 23, x1: 4, z1: 31 }

/* ── river, bridge and west bank ───────────────────────────────────────────── */

export const RIVER: Rect = { x0: -46, z0: -58, x1: -34, z1: 58 }
export const BRIDGE: Rect = { x0: -50, z0: 14, x1: -30, z1: 17.5 }
export const RIVERWALK: Rect = { x0: -33.5, z0: -40, x1: -30, z1: 28 }
export const BRIDGE_APPROACH: Rect = { x0: -30, z0: 14, x1: -17, z1: 17.5 }
export const WEST_BANK_PATH: Rect = { x0: -58, z0: 14, x1: -50, z1: 17.5 }

/* ── park, café, district, parking ─────────────────────────────────────────── */

export const PARK: Rect = { x0: 30, z0: -8, x1: 50, z1: 28 }
export const PROMENADE: Rect = { x0: -17, z0: 19, x1: 50, z1: 22 }
export const CAFE_APPROACH: Rect = { x0: -3, z0: 13, x1: 15, z1: 16 }

export const CAFE: Rect = { x0: 15, z0: 10, x1: 28, z1: 18 }
export const CAFE_PERGOLA: Rect = { x0: 16, z0: 11, x1: 25, z1: 17.5 }
export const CAFE_COUNTER: Rect = { x0: 25.4, z0: 11.5, x1: 27.4, z1: 16.5 }

export const PARKING: Rect = { x0: -32, z0: 40, x1: -10, z1: 56 }
export const PARKING_LINK: Rect = { x0: -23, z0: 38, x1: -19, z1: 40 }
export const CROSSWALK_WEST: Rect = { x0: -23, z0: 29, x1: -19, z1: 38 }
export const CROSSWALK_EAST: Rect = { x0: 36, z0: 29, x1: 40, z1: 38 }

/** Bounded support buildings; interiors are intentionally not enterable. */
export const DISTRICT: Building[] = [
  { id: 'innovation-lab', label: 'INNOVATION LAB', x0: -32, z0: -44, x1: -22, z1: -34, height: 9, wall: '#e8e3d8', glass: '#a9c8c7', roof: '#c6bcaa' },
  { id: 'ai-research', label: 'AI RESEARCH', x0: -18, z0: -46, x1: -8, z1: -36, height: 12, wall: '#d9dedc', glass: '#9dbcc4', roof: '#aeb8b4' },
  { id: 'creative-studio', label: 'CREATIVE STUDIO', x0: -4, z0: -42, x1: 6, z1: -33, height: 8, wall: '#eadfd3', glass: '#c8b7a6', roof: '#b8a58f' },
  { id: 'collaboration-hub', label: 'COLLABORATION HUB', x0: 10, z0: -44, x1: 24, z1: -33, height: 10, wall: '#dfe4dd', glass: '#9fc1b4', roof: '#b9c2b6' },
]

export const DISTRICT_PLAZA: Rect = { x0: -34, z0: -27, x1: 34, z1: -22 }
export const DISTRICT_SPINE: Rect = { x0: -21, z0: -27, x1: 21, z1: -22 }
export const PARK_PAVILION: Rect = { x0: 36, z0: 0, x1: 42, z1: 5 }

/** Paved walks. Vegetation and props are filtered against this list. */
export const WALKS: Rect[] = [
  ENTRANCE_PROMENADE,
  PROMENADE,
  CAFE_APPROACH,
  BRIDGE_APPROACH,
  BRIDGE,
  RIVERWALK,
  WEST_BANK_PATH,
  CROSSWALK_WEST,
  CROSSWALK_EAST,
  PARKING_LINK,
  // Park loop.
  { x0: 30, z0: -8, x1: 33, z1: 22 },
  { x0: 30, z0: -8, x1: 47, z1: -5 },
  { x0: 44, z0: -8, x1: 47, z1: 22 },
  { x0: 30, z0: 7, x1: 47, z1: 10 },
  // District forecourt links.
  { x0: -29, z0: -34, x1: -26, z1: -22 },
  { x0: -15, z0: -36, x1: -12, z1: -22 },
  { x0: -1, z0: -33, x1: 2, z1: -22 },
  { x0: 15, z0: -33, x1: 18, z1: -22 },
  // North axis: a walk around the west flank of the office joins the forecourt to the district
  // plaza, so the Innovation District is not a lawn-only detour.
  { x0: -18, z0: -22, x1: -15, z1: 11 },
]

export const CROSSWALKS: Rect[] = [
  { x0: -23, z0: 31, x1: -19, z1: 36 },
  { x0: 36, z0: 31, x1: 40, z1: 36 },
]

/* ── street furniture ──────────────────────────────────────────────────────── */

export const LAMPS: { x: number; z: number; tall: boolean }[] = [
  { x: -14.6, z: 12, tall: false }, { x: -5.4, z: 12, tall: false },
  { x: -14.6, z: 17, tall: false }, { x: -5.4, z: 17, tall: false },
  { x: -14.6, z: 22, tall: false }, { x: -5.4, z: 22, tall: false },
  { x: -20, z: 20.5, tall: false }, { x: 6, z: 20.5, tall: false },
  { x: 16, z: 20.5, tall: false }, { x: 28, z: 20.5, tall: false },
  { x: 39, z: 20.5, tall: false }, { x: 48, z: 20.5, tall: false },
  { x: -44, z: 10.5, tall: false }, { x: -44, z: 21, tall: false },
  { x: -26, z: 29.6, tall: true }, { x: -8, z: 29.6, tall: true },
  { x: 10, z: 29.6, tall: true }, { x: 28, z: 29.6, tall: true },
  { x: 46, z: 29.6, tall: true }, { x: -34, z: 37.4, tall: true },
  { x: -12, z: 37.4, tall: true }, { x: 20, z: 37.4, tall: true },
]

export const BENCHES: { x: number; z: number; ry: number }[] = [
  { x: -15.1, z: 13.5, ry: Math.PI / 2 }, { x: -4.9, z: 13.5, ry: -Math.PI / 2 },
  { x: -15.1, z: 19.8, ry: Math.PI / 2 }, { x: -4.9, z: 19.8, ry: -Math.PI / 2 },
  { x: 34.5, z: 14, ry: Math.PI / 2 }, { x: 42.5, z: 14, ry: -Math.PI / 2 },
  { x: 39, z: 6.4, ry: 0 }, { x: -31.2, z: 4, ry: -Math.PI / 2 },
  { x: -31.2, z: 9, ry: -Math.PI / 2 }, { x: -31.2, z: 23, ry: -Math.PI / 2 },
]

export const PLANTERS: { x: number; z: number; w: number; d: number }[] = [
  { x: -12.5, z: 10.4, w: 0.8, d: 0.8 }, { x: -7.9, z: 10.4, w: 0.8, d: 0.8 },
  { x: -16.2, z: 12, w: 0.7, d: 1.8 }, { x: -3.8, z: 12, w: 0.7, d: 1.8 },
  { x: -16.2, z: 20, w: 0.7, d: 1.8 }, { x: -3.8, z: 20, w: 0.7, d: 1.8 },
  { x: 15.6, z: 10.6, w: 1.2, d: 0.8 }, { x: 27.4, z: 10.6, w: 1.2, d: 0.8 },
  { x: 15.6, z: 17.4, w: 1.2, d: 0.8 }, { x: 27.4, z: 17.4, w: 1.2, d: 0.8 },
  { x: 34, z: 0.2, w: 0.9, d: 0.9 }, { x: 44, z: 0.2, w: 0.9, d: 0.9 },
]

/** Entrance canopy posts stand outside the door, clear of the 2.6 m opening. */
export const PORTAL_POSTS: Circle[] = [
  { x: ENTRANCE.x - 2.15, z: ENTRANCE.z + 1.8, r: 0.14 },
  { x: ENTRANCE.x + 2.15, z: ENTRANCE.z + 1.8, r: 0.14 },
]

export const CARS: { x: number; z: number; ry: number; color: string }[] = [
  { x: -29.2, z: 42.4, ry: 0, color: '#d7ddd9' },
  { x: -25.2, z: 42.4, ry: 0, color: '#7f9f95' },
  { x: -21.2, z: 42.4, ry: 0, color: '#b7a28b' },
  { x: -17.2, z: 42.4, ry: 0, color: '#8d9aa8' },
]

export const CAFE_TABLES: { x: number; z: number }[] = [
  { x: 18, z: 13.2 }, { x: 21, z: 13.2 },
  { x: 18, z: 15.8 }, { x: 21, z: 15.8 },
]

export const CAFE_CHAIRS: { x: number; z: number; ry: number }[] = [
  { x: 17.3, z: 13.2, ry: 0 }, { x: 22.3, z: 15.8, ry: Math.PI },
  { x: 17.3, z: 15.8, ry: 0 }, { x: 22.3, z: 13.2, ry: Math.PI },
  { x: 19.4, z: 14.5, ry: Math.PI / 2 }, { x: 19.6, z: 13.9, ry: -Math.PI / 2 },
]

export const BIKE_RACKS: { x: number; z: number; n: number }[] = [
  { x: -12.4, z: 24.4, n: 4 },
  { x: 26.4, z: 8.6, n: 3 },
]

/* ── nature ────────────────────────────────────────────────────────────────── */

function hits(r: Rect, x: number, z: number, pad: number): boolean {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad
}

const OFFICE: Rect = { x0: -FLOOR.halfX, z0: -FLOOR.halfZ, x1: FLOOR.halfX, z1: FLOOR.halfZ }

const TREE_EXCLUSIONS: { r: Rect; pad: number }[] = [
  { r: OFFICE, pad: 2.4 },
  { r: PLAZA, pad: 1.3 },
  { r: FORECOURT, pad: 1 },
  { r: ROAD, pad: 1.2 },
  { r: SIDEWALK_SOUTH, pad: 0.6 },
  { r: SIDEWALK_NORTH, pad: 0.6 },
  { r: RIVER, pad: 0.8 },
  { r: BRIDGE, pad: 1.2 },
  { r: PARKING, pad: 1.2 },
  { r: CAFE, pad: 1.4 },
  { r: DISTRICT_PLAZA, pad: 0.8 },
  ...WALKS.map((r) => ({ r, pad: 1.1 })),
  ...DISTRICT.map((b) => ({ r: b, pad: 2.2 })),
]

const TREE_ZONES: Rect[] = [
  { x0: 31, z0: -4, x1: 49, z1: 26 },       // park
  { x0: -56, z0: -46, x1: -48, z1: 42 },    // west bank
  { x0: -34, z0: -56, x1: 34, z1: -49 },    // north belt
  { x0: 50, z0: -30, x1: 56, z1: 44 },      // east belt
  { x0: -44, z0: 48, x1: 48, z1: 56 },      // south belt
  { x0: 8, z0: 6, x1: 14, z1: 24 },         // between office and café
  { x0: -34, z0: -22, x1: 34, z1: -12 },    // district lawn
]

export const TREES: Tree[] = (() => {
  const trees: Tree[] = []
  let seed = 0x5eeda11e
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const blocked = (x: number, z: number) =>
    TREE_EXCLUSIONS.some(({ r, pad }) => hits(r, x, z, pad)) ||
    trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.1)
  for (let i = 0; i < 420 && trees.length < 58; i++) {
    const zone = TREE_ZONES[i % TREE_ZONES.length]
    const x = zone.x0 + random() * (zone.x1 - zone.x0)
    const z = zone.z0 + random() * (zone.z1 - zone.z0)
    if (blocked(x, z)) continue
    trees.push({
      x, z,
      r: 1.5 + random() * 0.9,
      h: 2.1 + random() * 1.3,
      trunk: 0.16 + random() * 0.08,
      kind: Math.floor(random() * 4),
    })
  }
  return trees
})()

export const SHRUBS: Circle[] = (() => {
  const out: Circle[] = []
  let seed = 0xc0ffee
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const zones: Rect[] = [
    { x0: -18, z0: 9.4, x1: -2, z1: 22.6 },
    { x0: 14, z0: 9.5, x1: 29, z1: 18.5 },
    { x0: 30, z0: -4, x1: 50, z1: 26 },
    { x0: -33, z0: -40, x1: -29, z1: 27 },
  ]
  for (let i = 0; i < 180 && out.length < 46; i++) {
    const zone = zones[i % zones.length]
    const x = zone.x0 + random() * (zone.x1 - zone.x0)
    const z = zone.z0 + random() * (zone.z1 - zone.z0)
    if (TREE_EXCLUSIONS.some(({ r, pad }) => hits(r, x, z, pad - 0.2))) continue
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 1.5)) continue
    out.push({ x, z, r: 0.34 + random() * 0.24 })
  }
  return out
})()

export const HILLS: { x: number; z: number; r: number; h: number; color: string }[] = [
  { x: -92, z: -104, r: 48, h: 26, color: '#8da49a' },
  { x: -18, z: -124, r: 62, h: 34, color: '#9caf9f' },
  { x: 66, z: -116, r: 52, h: 28, color: '#a9b8a5' },
  { x: 118, z: -44, r: 56, h: 24, color: '#b2c0b2' },
  { x: 116, z: 54, r: 48, h: 20, color: '#b7c4b8' },
  { x: 48, z: 118, r: 68, h: 28, color: '#a5b6a8' },
  { x: -58, z: 116, r: 58, h: 22, color: '#98ad9f' },
  { x: -122, z: 24, r: 52, h: 25, color: '#8fa79b' },
]

/* ── helpers shared by the renderer, collision and tests ───────────────────── */

export function rectContains(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0
}

/** Paved surfaces (for footstep height and material selection). */
export const PAVED: Rect[] = [
  PLAZA, FORECOURT, ROAD, SIDEWALK_SOUTH, SIDEWALK_NORTH, DROP_OFF_LANE,
  PARKING, CAFE, CAFE_APPROACH, DISTRICT_PLAZA, ...WALKS,
]

export function groundHeightAt(x: number, z: number): number {
  if (rectContains(BRIDGE, x, z, 0)) return 0.16
  if (PAVED.some((r) => rectContains(r, x, z, 0))) return 0.03
  return 0
}

export function onBridge(x: number, z: number): boolean {
  return rectContains(BRIDGE, x, z, 0)
}

export function onRiver(x: number, z: number): boolean {
  return rectContains(RIVER, x, z, 0)
}

export const CAMPUS_CENTER = { x: 0, z: 2 }
export const CAMPUS_VIEW = {
  pos: [58, 48, 74] as [number, number, number],
  look: [0, 1.4, 2] as [number, number, number],
  fov: 46,
}

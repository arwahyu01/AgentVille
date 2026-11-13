import type { Agent } from '../types'

// Scale: 1 world unit = 1 metre. Ceiling sits at 3.0, desk tops at 0.74.
export const FLOOR = { halfX: 13, halfZ: 9, height: 3 }
export const CORRIDOR = { halfZ: 1.7 }
export const PARTITION_H = 2.45
export const DOOR_W = 1.1
export const DOOR_H = 2.15

/** The building faces south (+z): the default camera sits on +z and the lobby is in the south
 * band. The main entrance is cut through that facade, directly on the lobby's centre line. */
export const ENTRANCE = {
  x: -10.2,
  z: FLOOR.halfZ,
  width: 2.6,
  height: 2.5,
  /** Just inside the lobby, on the clear aisle in front of reception. */
  spawn: [-10.2, 7.85] as [number, number],
  /** Where Explore starts when the user first opens the campus. */
  plazaSpawn: [-10.2, 18.0] as [number, number],
  /** Forecourt footprint used by the campus blockout and the walk tests. */
  plaza: { x0: -17, z0: FLOOR.halfZ, x1: -3, z1: 22 },
}


export type RoomKind = 'dept' | 'server' | 'meeting' | 'support'
export type Partition = 'glass' | 'solid'

export interface Room {
  id: string
  label: string
  kind: RoomKind
  /** [x0, z0, x1, z1] footprint on the floor plane. */
  box: [number, number, number, number]
  center: [number, number]
  half: [number, number]
  /** 'north' rooms hang off the south side of the corridor, 'south' rooms off the north side. */
  band: 'north' | 'south'
  /** Soft accent used for the rug, signage band and trim of this zone. */
  accent: string
  partition: Partition
  /** Workstation / seat anchors inside the room (world x/z). */
  stations: [number, number][]
  /** Where a figure stands relative to its station anchor, so it never clips the desk. */
  figureOffset: [number, number]
  /** Seat anchor relative to the station, or null when the station has no chair to sit on. */
  seatOffset: [number, number] | null
  /** Facing (radians) at a station; `seatFaces` overrides it per station index. */
  figureFacing: number
  seatFaces?: number[]
  /** Doorway on the corridor-facing edge. */
  door: [number, number]
  /** z of the corridor spine node this room connects to. */
  spineZ: number
}

const NORTH = -CORRIDOR.halfZ
const SOUTH = CORRIDOR.halfZ
const FACE_NORTH = Math.PI
const FACE_SOUTH = 0

function room(
  id: string,
  label: string,
  kind: RoomKind,
  box: [number, number, number, number],
  accent: string,
  stations: [number, number][],
  opts: { partition?: Partition; seatFaces?: number[]; doorX?: number; figureOffset?: [number, number]; seatOffset?: [number, number] | null; figureFacing?: number } = {},
): Room {
  const [x0, z0, x1, z1] = box
  const band: Room['band'] = z1 <= 0 ? 'north' : 'south'
  const center: [number, number] = [(x0 + x1) / 2, (z0 + z1) / 2]
  const half: [number, number] = [(x1 - x0) / 2, (z1 - z0) / 2]
  const doorX = opts.doorX ?? center[0]
  return {
    id, label, kind, box, center, half, band, accent,
    partition: opts.partition ?? 'glass',
    stations,
    figureOffset: opts.figureOffset ?? (band === 'north' ? [0, 1.02] : [0, -1.02]),
    // Every department uses the same camera-readable rig: chair on the +z side of the desk,
    // monitor on the -z side, screen toward +z. The meeting room's anchors are already chairs;
    // support zones have no chair, so figures stand at the station instead.
    seatOffset: opts.seatOffset ?? (kind === 'dept' ? [0, 0.78] : null),
    figureFacing: opts.figureFacing ?? (kind === 'dept' ? FACE_NORTH
      : band === 'north' ? FACE_NORTH : FACE_SOUTH),
    seatFaces: opts.seatFaces,
    door: [doorX, band === 'north' ? NORTH : SOUTH],
    spineZ: 0,
  }
}

const HALF_PI = Math.PI / 2

// Ten zones around one daylight corridor. Ids are shared with backend app/rooms.py; the six
// original ids (dev, server, analyst, design, admin, meeting) keep their meaning.
export const ROOMS: Record<string, Room> = {
  // Lobby staff stand clear of the reception desk, the waiting sofa and the backdrop: one on the
  // west aisle, one in the open floor east of reception.
  lobby: room('lobby', 'Lobby & Reception', 'support', [-13, SOUTH, -7.4, 9], '#d3a878',
    [[-12.15, 7.3], [-8.15, 4.9]]),
  analyst: room('analyst', 'Analyst / Research', 'dept', [-7.4, SOUTH, -2.4, 9], '#79a37f',
    [[-6.2, 7.4], [-3.6, 7.4], [-6.2, 4.6], [-3.6, 4.6]]),
  design: room('design', 'Design Studio', 'dept', [-2.4, SOUTH, 3.4, 9], '#c58ba0',
    [[-1.5, 7.4], [0.5, 7.4], [2.5, 7.4], [-1.5, 4.6], [0.5, 4.6], [2.5, 4.6]]),
  meeting: room('meeting', 'Meeting Room', 'meeting', [3.4, SOUTH, 9, 9], '#8f86bd',
    [[5.3, 4.6], [6.2, 4.6], [7.1, 4.6], [5.3, 6.6], [6.2, 6.6], [7.1, 6.6], [4.5, 5.6], [7.9, 5.6]],
    { seatFaces: [0, 0, 0, Math.PI, Math.PI, Math.PI, HALF_PI, -HALF_PI], figureOffset: [0, 0], seatOffset: [0, 0] }),
  pantry: room('pantry', 'Pantry', 'support', [9, SOUTH, 13, 9], '#d1975f',
    [[10.2, 4.1], [12.1, 4.1]]),
  server: room('server', 'Server / Database', 'server', [-13, -9, -8.6, NORTH], '#8b93b8',
    [[-12.0, -3.2], [-9.5, -3.2]], { partition: 'solid' }),
  dev: room('dev', 'Development', 'dept', [-8.6, -9, -1.4, NORTH], '#58a89c',
    [[-7.3, -7.4], [-5.0, -7.4], [-2.7, -7.4], [-7.3, -4.6], [-5.0, -4.6], [-2.7, -4.6]]),
  // Zone 2: a counter hall. Teller windows run along the north wall; the desk stations are the
  // customer-service consultations in the open floor in front of them.
  cs: room('cs', 'Customer Service', 'dept', [-1.4, -9, 5.4, NORTH], '#7fb0c9',
    [[0.2, -3.9], [2.0, -3.9], [3.8, -3.9]]),
  security: room('security', 'Security Control', 'support', [5.4, -9, 9, NORTH], '#6f8f9c',
    [[6.35, -7.0], [8.25, -7.0], [7.3, -3.7]], { partition: 'solid' }),
  admin: room('admin', 'Administration', 'dept', [9, -9, 13, NORTH], '#c2a86a',
    [[10.1, -7.2], [12.0, -7.2], [10.1, -4.4], [12.0, -4.4]]),
}

export const ROOM_ORDER: string[] = [
  'lobby', 'cs', 'dev', 'server', 'analyst', 'design', 'admin', 'security', 'pantry', 'meeting',
]

// Mirrors rooms.py OPERATIONAL_ROLES: simulation staff that the planner can never bind work to.
export const OPERATIONAL_ROLES: ReadonlySet<string> = new Set(['Housekeeping', 'Security'])

// Mirrors backend app/rooms.py ROLE_ROOM so the scene seats people the same way the orchestrator does.
export const ROLE_ROOM: Record<string, string> = {
  'Frontend Developer': 'dev',
  'Backend Developer': 'dev',
  Developer: 'dev',
  'QA Engineer': 'dev',
  'Data Analyst': 'server',
  Researcher: 'analyst',
  'Product Analyst': 'analyst',
  'UI/UX Designer': 'design',
  'Content Creator': 'design',
  Administrator: 'admin',
  Reviewer: 'admin',
  'AI Coordinator': 'admin',
  // Simulation-only staff (never planner roles; mirrors rooms.py OPERATIONAL_ROLES).
  Housekeeping: 'pantry',
  Security: 'security',
}

export type WallKind = 'curtain' | 'glass' | 'solid'

export interface WallSegment {
  key: string
  a: [number, number]
  b: [number, number]
  kind: WallKind
  height: number
  /** Doorway punched at `at` metres from `a`, `width` metres wide. */
  door?: { at: number; width: number }
}

/**
 * Every wall the scene needs, derived from the room footprints so the plan stays the single
 * source of truth. Shared side edges are emitted once; the corridor edge carries the doorway.
 */
function buildWalls(): WallSegment[] {
  const { halfX, halfZ } = FLOOR
  const walls: WallSegment[] = [
    { key: 'perim-n', a: [-halfX, -halfZ], b: [halfX, -halfZ], kind: 'curtain', height: FLOOR.height },
    {
      key: 'perim-s', a: [-halfX, halfZ], b: [halfX, halfZ], kind: 'curtain', height: FLOOR.height,
      door: { at: ENTRANCE.x + halfX, width: ENTRANCE.width },
    },
    { key: 'perim-w', a: [-halfX, -halfZ], b: [-halfX, halfZ], kind: 'curtain', height: FLOOR.height },
    { key: 'perim-e', a: [halfX, -halfZ], b: [halfX, halfZ], kind: 'curtain', height: FLOOR.height },
  ]
  const list = Object.values(ROOMS)
  const seen = new Set<string>()
  for (const r of list) {
    const [x0, z0, x1, z1] = r.box
    // Corridor frontage: always glazed so every zone reads from the main camera, even the
    // restricted ones — their door carries the access control instead.
    const corridorZ = r.band === 'north' ? z1 : z0
    walls.push({
      key: `front-${r.id}`,
      a: [x0, corridorZ], b: [x1, corridorZ],
      kind: 'glass', height: PARTITION_H,
      door: { at: r.door[0] - x0, width: DOOR_W },
    })
    // Side partitions, deduped so a shared boundary is built once. Perimeter edges are left to
    // the curtain wall.
    for (const x of [x0, x1]) {
      if (Math.abs(x) === halfX) continue
      const key = `side-${x.toFixed(2)}-${Math.min(z0, z1).toFixed(2)}-${Math.max(z0, z1).toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)
      const neighbour = list.find((o) => o.id !== r.id && o.band === r.band && (o.box[0] === x || o.box[2] === x))
      walls.push({
        key, a: [x, z0], b: [x, z1],
        kind: r.partition === 'solid' || neighbour?.partition === 'solid' ? 'solid' : 'glass',
        height: PARTITION_H,
      })
    }
  }
  return walls
}

export const WALLS: WallSegment[] = buildWalls()

/** Room the point (x, z) falls inside; falls back to the nearest centre for corridor positions. */
export function roomAt(x: number, z: number): Room {
  for (const r of Object.values(ROOMS)) {
    const [x0, z0, x1, z1] = r.box
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return r
  }
  let best = ROOMS.admin
  let bestDist = Infinity
  for (const r of Object.values(ROOMS)) {
    const d = Math.hypot(r.center[0] - x, r.center[1] - z)
    if (d < bestDist) { bestDist = d; best = r }
  }
  return best
}

export function roomById(id?: string | null): Room {
  return (id && ROOMS[id]) || ROOMS.admin
}

export function stationInRoom(room: Room, index: number): [number, number] {
  const stations = room.stations
  return stations[Math.abs(index) % stations.length]
}

/** Where a figure's feet actually go for a station: the anchor plus the room's standing offset. */
export function figureAt(room: Room, index: number): { x: number; z: number; facing: number } {
  const [sx, sz] = stationInRoom(room, index)
  const faces = room.seatFaces
  return {
    x: sx + room.figureOffset[0],
    z: sz + room.figureOffset[1],
    facing: faces ? faces[Math.abs(index) % faces.length] : room.figureFacing,
  }
}

/** Seat anchor for a station, plus whether a chair actually exists there. Figures sit only where
 * the fitout placed a chair, otherwise they stand at `figureAt`. */
export function seatAt(room: Room, index: number): { x: number; z: number; facing: number; seated: boolean } {
  const standing = figureAt(room, index)
  if (!room.seatOffset) return { ...standing, seated: false }
  const [sx, sz] = stationInRoom(room, index)
  return { x: sx + room.seatOffset[0], z: sz + room.seatOffset[1], facing: standing.facing, seated: true }
}

export function roomForRole(role: string): Room {  return ROOMS[ROLE_ROOM[role] ?? 'admin'] ?? ROOMS.admin
}

/** Home anchor: where an agent sits when idle or after finishing work. */
export function homePosition(agent: Agent): [number, number] {
  const room = (agent.current_room ? ROOMS[agent.current_room] : undefined) ?? roomForRole(agent.role)
  return stationInRoom(room, agent.id)
}

/** Waypoint route between two rooms: exit through the source door, ride the corridor spine
 * (z = 0), then enter the target door. Empty when already home, so the scene applies no motion. */
export function pathBetween(fromRoom: Room, toRoom: Room): [number, number][] {
  if (fromRoom === toRoom) return []
  return [
    fromRoom.door,
    [fromRoom.door[0], fromRoom.spineZ],
    [toRoom.door[0], toRoom.spineZ],
    toRoom.door,
  ]
}

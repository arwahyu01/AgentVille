import { describe, expect, it } from 'vitest'
import roomsSource from '../../../backend/app/rooms.py?raw'
import { CORRIDOR, FLOOR, DOOR_W, ROOMS, ROOM_ORDER, ROLE_ROOM, WALLS, figureAt, pathBetween, roomAt, roomById, roomForRole, seatAt, stationInRoom } from './officeLayout'
import { poseFor, routeTo } from './activity'
import type { Agent } from '../types'

function agent(overrides: Partial<Agent>): Agent {
  return { id: 1, name: 'A', role: 'Developer', status: 'idle', position_x: 0, position_z: 0, ...overrides }
}

const inside = (r: { box: [number, number, number, number] }, p: [number, number]) =>
  p[0] > r.box[0] && p[0] < r.box[2] && p[1] > r.box[1] && p[1] < r.box[3]

describe('office layout', () => {
  const ids = Object.keys(ROOMS)

  it('lays out the ten planned zones', () => {
    expect(new Set(ids).size).toBe(10)
    expect(new Set(ROOM_ORDER).size).toBe(10)
    for (const id of ROOM_ORDER) expect(ROOMS[id]).toBeTruthy()
  })

  it('gives every department at least one workstation', () => {
    for (const id of ids) expect(ROOMS[id].stations.length).toBeGreaterThan(0)
  })

  it('maps every known role to a real room', () => {
    for (const role of Object.keys(ROLE_ROOM)) {
      expect(ROOMS[ROLE_ROOM[role]]).toBeTruthy()
      expect(roomForRole(role)).toBe(ROOMS[ROLE_ROOM[role]])
    }
  })

  it('does not overlap room footprints', () => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ROOMS[ids[i]]
        const b = ROOMS[ids[j]]
        const overlapX = Math.abs(a.center[0] - b.center[0]) < a.half[0] + b.half[0] - 0.05
        const overlapZ = Math.abs(a.center[1] - b.center[1]) < a.half[1] + b.half[1] - 0.05
        // Two rectangles collide only when they overlap on BOTH axes.
        expect(overlapX && overlapZ, `rooms ${a.id} and ${b.id} overlap`).toBe(false)
      }
    }
  })

  it('keeps every room, station and door inside the floor plate', () => {
    for (const room of Object.values(ROOMS)) {
      expect(Math.abs(room.box[0])).toBeLessThanOrEqual(FLOOR.halfX + 0.001)
      expect(Math.abs(room.box[2])).toBeLessThanOrEqual(FLOOR.halfX + 0.001)
      expect(Math.abs(room.box[1])).toBeLessThanOrEqual(FLOOR.halfZ + 0.001)
      expect(Math.abs(room.box[3])).toBeLessThanOrEqual(FLOOR.halfZ + 0.001)
      for (const s of room.stations) expect(inside(room, s), `${room.id} station ${s} escapes the room`).toBe(true)
    }
  })

  it('puts every door on the corridor edge and clear of the side walls', () => {
    for (const room of Object.values(ROOMS)) {
      const corridorZ = room.band === 'north' ? -CORRIDOR.halfZ : CORRIDOR.halfZ
      expect(room.door[1]).toBeCloseTo(corridorZ, 6)
      expect(Math.abs(room.door[0] - room.center[0]), `${room.id} door clips its side wall`)
        .toBeLessThan(room.half[0] - DOOR_W / 2)
    }
  })

  it('leaves walking clearance between neighbouring workstations', () => {
    for (const room of Object.values(ROOMS)) {
      // Conference seats deliberately cluster around the table; every other zone needs an aisle.
      if (room.kind === 'meeting') continue
      for (let i = 0; i < room.stations.length; i++) {
        for (let j = i + 1; j < room.stations.length; j++) {
          const [ax, az] = room.stations[i]
          const [bx, bz] = room.stations[j]
          const gap = Math.hypot(ax - bx, az - bz)
          expect(gap, `${room.id} stations ${i}/${j} are too close`).toBeGreaterThanOrEqual(1.7)
        }
      }
    }
  })

  it('seats a figure beside its desk, never inside it', () => {
    for (const room of Object.values(ROOMS)) {
      for (let i = 0; i < room.stations.length; i++) {
        const f = figureAt(room, i)
        expect(inside(room, [f.x, f.z]), `${room.id} seat ${i} escapes the room`).toBe(true)
      }
    }
  })

  it('routes between rooms through the door and corridor spine, and never inside the same room', () => {
    const route = pathBetween(ROOMS.dev, ROOMS.admin)
    expect(route[0]).toEqual(ROOMS.dev.door)
    expect(route[route.length - 1]).toEqual(ROOMS.admin.door)
    expect(route.every((p) => Array.isArray(p) && p.length === 2)).toBe(true)
    expect(pathBetween(ROOMS.dev, ROOMS.dev)).toEqual([])
  })

  it('finishes a route at the station so nobody glides through furniture', () => {
    const anchor: [number, number] = [-9, 3]
    const route = routeTo(ROOMS.dev, ROOMS.lobby, anchor)
    expect(route[route.length - 1]).toEqual(anchor)
    // The corridor leg stays inside the corridor band.
    expect(route[2][1]).toBe(0)
  })

  it('wraps the station index so any agent id lands on a real anchor', () => {
    const room = ROOMS.dev
    expect(stationInRoom(room, 0)).toEqual(room.stations[0])
    expect(stationInRoom(room, room.stations.length)).toEqual(room.stations[0])
  })

  it('falls back to a known room for an unknown id', () => {
    expect(roomById('nonsense')).toBe(ROOMS.admin)
    expect(roomById(null)).toBe(ROOMS.admin)
  })

  it('resolves a point to the room that actually contains it', () => {
    expect(roomAt(...(ROOMS.dev.stations[0] as [number, number]))).toBe(ROOMS.dev)
    expect(roomAt(0, 0), 'corridor centre is not a room interior').not.toBe(ROOMS.meeting)
  })

  it('builds each interior boundary exactly once', () => {
    const keys = WALLS.map((w) => w.key)
    expect(new Set(keys).size).toBe(keys.length)
    const sides = WALLS.filter((w) => w.key.startsWith('side-'))
    expect(sides.length).toBeGreaterThan(0)
    expect(sides.length).toBeLessThan(Object.keys(ROOMS).length * 2)
  })

  it('seats figures only where the fitout put a chair, and always inside the room', () => {
    const dev = seatAt(ROOMS.dev, 0)
    expect(dev.seated).toBe(true)
    expect(Math.abs(dev.z - ROOMS.dev.stations[0][1])).toBeCloseTo(0.78, 5)
    expect(dev.facing).toBe(ROOMS.dev.figureFacing)

    const meeting = seatAt(ROOMS.meeting, 3)
    expect(meeting.seated).toBe(true)
    expect([meeting.x, meeting.z]).toEqual(ROOMS.meeting.stations[3])
    expect(meeting.facing).toBe(ROOMS.meeting.seatFaces?.[3])

    const lobby = seatAt(ROOMS.lobby, 0)
    expect(lobby.seated).toBe(false)
    expect([lobby.x, lobby.z]).toEqual([
      ROOMS.lobby.stations[0][0] + ROOMS.lobby.figureOffset[0],
      ROOMS.lobby.stations[0][1] + ROOMS.lobby.figureOffset[1],
    ])

    for (const id of ROOM_ORDER) {
      const room = ROOMS[id]
      for (let i = 0; i < room.stations.length; i++) {
        expect(inside(room, [seatAt(room, i).x, seatAt(room, i).z]), `${id} seat ${i} leaves the room`).toBe(true)
      }
    }
  })

  it('uses one camera-readable rig in both bands: chair +z, screen toward +z', () => {
    for (const id of ['dev', 'cs', 'admin', 'analyst', 'design']) {
      const room = ROOMS[id]
      const seat = seatAt(room, 0)
      expect(seat.seated).toBe(true)
      // The chair sits on the camera side of the desk and the occupant faces the monitor.
      expect(seat.z - room.stations[0][1]).toBeCloseTo(0.78, 5)
      expect(seat.facing).toBeCloseTo(Math.PI, 5)
    }
    // South-band departments used to face the corridor; they now match the north-band rig.
    expect(ROOMS.analyst.figureFacing).toBe(ROOMS.dev.figureFacing)
    expect(ROOMS.design.figureFacing).toBe(ROOMS.dev.figureFacing)
  })
})

describe('backend room contract', () => {
  // Vite's `?raw` import of the real Python module: the layout test and the backend can no longer
  // drift apart without failing here.
  const source = roomsSource

  it('agrees with the backend on the room ids', () => {
    const block = /ROOM_IDS\s*=\s*\(([^)]*)\)/.exec(source)?.[1] ?? ''
    const ids = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(ids.sort()).toEqual(Object.keys(ROOMS).sort())
  })

  it('agrees with the backend on the role → room mapping', () => {
    const block = /ROLE_ROOM[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? ''
    const pairs = [...block.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])
    expect(Object.fromEntries(pairs)).toEqual(ROLE_ROOM)
  })
})

describe('event-driven pose projection', () => {
  it('keeps an idle agent parked at its home room — no motion without an event', () => {
    const pose = poseFor(agent({ current_room: 'dev' }))
    expect(pose.kind).toBe('ambient')
    expect(pose.targetRoom).toBeNull()
    expect(pose.homeRoom).toBe(ROOMS.dev)
  })

  it('reads a working agent settled at its desk as work, not travel', () => {
    const pose = poseFor(agent({ current_room: 'dev', status: 'working' }))
    expect(pose.kind).toBe('work')
    expect(pose.targetRoom).toBeNull()
  })

  it('flags travel when a handoff event moved the agent toward another room', () => {
    const pose = poseFor(agent({ current_room: 'dev', target_room: 'admin', status: 'working' }))
    expect(pose.kind).toBe('travel')
    expect(pose.targetRoom).toBe(ROOMS.admin)
  })

  it('distinguishes a meeting destination from an ordinary handoff trip', () => {
    const pose = poseFor(agent({ current_room: 'dev', target_room: 'meeting', status: 'reviewing' }))
    expect(pose.kind).toBe('meeting')
    expect(pose.targetRoom).toBe(ROOMS.meeting)
  })
})

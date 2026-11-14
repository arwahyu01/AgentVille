import { describe, expect, it } from 'vitest'
import { activityLine, latestByAgent, newestMotionEvent, parseUtc, poseFor, pulseAge, routeTo, stationSlots } from './activity'
import { ROOMS, seatAt } from './officeLayout'
import type { Agent, StreamEvent } from '../types'

const atlas: Agent = { id: 1, name: 'Atlas', role: 'AI Coordinator', status: 'idle', position_x: -4.2, position_z: -0.25 }

function event(overrides: Partial<StreamEvent>): StreamEvent {
  return {
    kind: 'task',
    id: 1, taskId: 10, type: 'step_started', message: 'Step started',
    conversationId: null, agentId: 2, provider: 'qoder', model: 'Efficient', stepIndex: 2,
    createdAt: '2026-10-24T03:00:00', ...overrides,
  }
}

describe('office activity', () => {
  it('labels a workstation with the real journal frame, including step and provider', () => {
    expect(activityLine(atlas, event({}))).toBe('step started #2 · qoder')
  })

  it('falls back to the backend status when no event has been seen for that agent', () => {
    expect(activityLine({ ...atlas, status: 'waiting' })).toBe('waiting')
    expect(activityLine(atlas, event({ type: 'action_write', message: 'Edit App.tsx' }))).toBe('Edit App.tsx')
  })

  it('keeps only the newest frame per agent and ignores frames without an owner', () => {
    const map = latestByAgent([
      event({ id: 5, agentId: 2 }),
      event({ id: 9, agentId: 2, type: 'step_completed' }),
      event({ id: 7, agentId: null }),
      event({ id: 4, agentId: 3 }),
    ])
    expect(Object.keys(map)).toEqual(['2', '3'])
    expect(map[2].type).toBe('step_completed')
  })

  it('reads naive backend timestamps as UTC so freshness is not locale-dependent', () => {
    expect(parseUtc('2026-10-24T03:00:00')).toBe(parseUtc('2026-10-24T03:00:00Z'))
    expect(parseUtc('2026-10-24T03:00:00+08:00')).toBeLessThan(parseUtc('2026-10-24T03:00:00Z'))
  })

  it('ages a pulse from the event clock and never invents one without an event', () => {
    const now = Date.UTC(2026, 9, 24, 3, 0, 10)
    expect(pulseAge(event({ createdAt: '2026-10-24T03:00:00' }), now)).toBeCloseTo(10, 5)
    expect(pulseAge(undefined, now)).toBe(Infinity)
    expect(pulseAge(event({ createdAt: null }), now)).toBe(Infinity)
  })

  it('picks the newest travel frame for an agent even when replayed out of order', () => {
    const stream = [
      event({ id: 12, type: 'travel_started', actorAgentId: 2, toRoom: 'admin' }),
      event({ id: 9, type: 'travel_arrived', actorAgentId: 2, toRoom: 'admin' }),
      event({ id: 7, type: 'step_started', actorAgentId: 2 }),
    ]
    // newestMotionEvent keys on id, not array position, so a reconnect replay lands on the tail.
    expect(newestMotionEvent(2, stream)?.id).toBe(12)
    expect(newestMotionEvent(3, stream)).toBeUndefined()
  })

  it('projects agent state into a pose without inventing motion (replay is deterministic)', () => {
    const home = { ...atlas, current_room: 'admin' }
    expect(poseFor(home).kind).toBe('ambient')
    // Same inputs → same pose, so rebuilding the whole journal after a drop gives identical results.
    expect(poseFor(home)).toEqual(poseFor(home))
    const travelling = { ...home, target_room: 'dev', status: 'working' as const }
    expect(poseFor(travelling).kind).toBe('travel')
    expect(poseFor(travelling).targetRoom?.id).toBe('dev')
  })

  it('rounds the desk when leaving or entering a south-band seat', () => {
    const seat = seatAt(ROOMS.analyst, 0)
    const start: [number, number] = [seat.x, seat.z]
    // Leaving: the first leg goes sideways down a desk gap, not straight through the desk.
    const out = routeTo(ROOMS.analyst, ROOMS.dev, undefined, start)
    expect(out[0][1]).toBeCloseTo(seat.z, 5)
    expect(Math.abs(out[0][0] - seat.x)).toBeGreaterThan(0.8)
    expect(out[1][1]).toBeCloseTo(ROOMS.analyst.box[1] + 0.55, 5)
    // Arriving: the last leg is the same lane in reverse, then the seat.
    const back = routeTo(ROOMS.dev, ROOMS.analyst, start)
    expect(back[back.length - 1]).toEqual(start)
    expect(Math.abs(back[back.length - 2][0] - seat.x)).toBeGreaterThan(0.8)
    // North-band seats already face the door, so they keep the direct route.
    const north = seatAt(ROOMS.dev, 0)
    const direct = routeTo(ROOMS.cs, ROOMS.dev, [north.x, north.z], [ROOMS.cs.stations[0][0], ROOMS.cs.stations[0][1] + 0.78])
    expect(direct[direct.length - 1]).toEqual([north.x, north.z])
    expect(direct[direct.length - 2][1]).toBeCloseTo(ROOMS.dev.door[1], 5)
  })

  it('never walks a seated south-band figure across a desk', () => {
    // Desk footprints from Furniture.Workstation: 1.5 x 0.75, centred on each station.
    const deskHit = (roomId: string, x: number, z: number) => ROOMS[roomId].stations.some(
      ([sx, sz]) => Math.abs(x - sx) < 0.75 && Math.abs(z - sz) < 0.375)
    const clear = (roomId: string, a: [number, number], b: [number, number]) => {
      for (let i = 0; i <= 80; i++) {
        const t = i / 80
        const x = a[0] + (b[0] - a[0]) * t
        const z = a[1] + (b[1] - a[1]) * t
        expect(deskHit(roomId, x, z), `${roomId} route crosses a desk at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(false)
      }
    }
    for (const roomId of ['analyst', 'design']) {
      const room = ROOMS[roomId]
      for (let i = 0; i < room.stations.length; i++) {
        const seat = seatAt(room, i)
        const start: [number, number] = [seat.x, seat.z]
        const out = routeTo(room, ROOMS.dev, undefined, start)
        let prev = start
        for (const point of out.slice(0, 2)) { clear(roomId, prev, point); prev = point }
        const back = routeTo(ROOMS.dev, room, start)
        prev = back[back.length - 3]
        for (const point of back.slice(-2)) { clear(roomId, prev, point); prev = point }
      }
    }
  })

  it('seats the whole seeded roster without double-booking a station', () => {
    const roster: Agent[] = [
      ['Atlas', 'AI Coordinator'], ['Nova', 'Data Analyst'], ['Pixel', 'Content Creator'],
      ['Byte', 'Developer'], ['Sage', 'Researcher'], ['Quill', 'Administrator'],
      ['Proof', 'Reviewer'], ['Scout', 'Product Analyst'], ['Ink', 'UI/UX Designer'],
      ['Blaze', 'Frontend Developer'], ['Forge', 'Backend Developer'], ['Gauge', 'QA Engineer'],
    ].map(([name, role], i) => ({ id: i + 1, name, role, status: 'idle', position_x: 0, position_z: 0 }))
    const slots = stationSlots(roster)
    const taken = new Set<string>()
    for (const a of roster) {
      const room = poseFor(a).homeRoom
      const slot = slots[a.id]
      expect(slot, `${a.name} has no station`).toBeTypeOf('number')
      expect(slot).toBeLessThan(room.stations.length)
      const key = `${room.id}:${slot}`
      expect(taken.has(key), `${a.name} double-booked ${key}`).toBe(false)
      taken.add(key)
    }
    // Ids that wrap a small room still land on distinct anchors.
    expect(new Set([4, 10, 11, 12].map((id) => slots[id])).size).toBe(4)
  })
})

import { describe, expect, it } from 'vitest'
import { stationSlots } from '../../lib/activity'
import { ROOMS, seatAt } from '../../lib/officeLayout'
import type { Agent, ClaudeSession } from '../../types'
import { BREAK_AFTER_MS, PANTRY_SPOTS, claudeBubble, claudeGoals, claudeNames, freeDesks } from './claudeSeats'

const NOW = Date.parse('2026-11-14T10:00:00Z')

const agent = (id: number, role: string): Agent => ({ id, name: `A${id}`, role, status: 'idle', position_x: 0, position_z: 0 })

const session = (id: string, over: Partial<ClaudeSession> = {}): ClaudeSession => ({
  session_id: id, project: 'AgentVille', cwd: '/x/AgentVille', status: 'working', activity: 'Edit App.tsx',
  permission_mode: 'default', tool_count: 3, started_at: '2026-11-14T09:00:00Z',
  updated_at: new Date(NOW - 5_000).toISOString(), events: [], ...over,
})

describe('claude desks', () => {
  it('never hands a Claude session a desk an agent already owns', () => {
    const agents = [agent(2, 'Developer'), agent(10, 'Frontend Developer'), agent(9, 'UI/UX Designer')]
    const slots = stationSlots(agents)
    const desks = freeDesks(agents, slots)
    const taken = agents.map((a) => `${a.role === 'UI/UX Designer' ? 'design' : 'dev'}:${slots[a.id]}`)
    for (const d of desks) expect(taken).not.toContain(`${d.room.id}:${d.index}`)
    expect(desks.length).toBe(ROOMS.dev.stations.length + ROOMS.design.stations.length
      + ROOMS.analyst.stations.length + ROOMS.admin.stations.length + ROOMS.cs.stations.length - 3)
  })

  it('seats a working session, stands a waiting one, sends a quiet finished one to the pantry', () => {
    const desks = freeDesks([], {})
    const goals = claudeGoals([
      session('a'),
      session('b', { status: 'waiting' }),
      session('c', { status: 'completed', updated_at: new Date(NOW - BREAK_AFTER_MS - 1000).toISOString() }),
    ], desks, NOW)
    const seat = seatAt(desks[0].room, desks[0].index)
    expect(goals.a.seated).toBe(true)
    expect(goals.a.point).toEqual([seat.x, seat.z])
    expect(goals.a.kind).toBe('work')
    expect(goals.b.seated).toBe(false)
    expect(goals.b.room.id).toBe(desks[1].room.id)
    expect(goals.c.room.id).toBe('pantry')
  })

  it('stands overflow sessions in the corridor instead of sharing a chair', () => {
    const goals = claudeGoals([session('a'), session('b')], [], NOW)
    expect(goals.a.point).not.toEqual(goals.b.point)
    expect(goals.a.seated).toBe(false)
  })
})

describe('claude labels', () => {
  it('adds a short id only when two sessions share a folder', () => {
    const names = claudeNames([session('1234abcd'), session('9876ffff'), session('zz', { project: 'kafe' })])
    expect(names['1234abcd']).toBe('AgentVille ·1234')
    expect(names.zz).toBe('kafe')
  })

  it('shows a finished line briefly, a live line always', () => {
    expect(claudeBubble(session('a'), NOW, false)).toBe('Edit App.tsx')
    const done = session('b', { status: 'completed', activity: 'Selesai: ok' })
    expect(claudeBubble(done, NOW, false)).toBe('Selesai: ok')
    expect(claudeBubble({ ...done, updated_at: new Date(NOW - 60_000).toISOString() }, NOW, false)).toBeNull()
    expect(claudeBubble({ ...done, updated_at: new Date(NOW - 60_000).toISOString() }, NOW, true)).toBe('Selesai: ok')
  })
})

describe('pantry spots', () => {
  it('are distinct, inside the pantry and not on top of each other', () => {
    const [x0, z0, x1, z1] = ROOMS.pantry.box
    for (const [x, z] of PANTRY_SPOTS) {
      expect(x).toBeGreaterThan(x0 + 0.3)
      expect(x).toBeLessThan(x1 - 0.7) // counter run along the east wall
      expect(z).toBeGreaterThan(z0 + 0.3)
      expect(z).toBeLessThan(z1 - 0.2)
    }
    for (let i = 0; i < PANTRY_SPOTS.length; i++) {
      for (let j = i + 1; j < PANTRY_SPOTS.length; j++) {
        const d = Math.hypot(PANTRY_SPOTS[i][0] - PANTRY_SPOTS[j][0], PANTRY_SPOTS[i][1] - PANTRY_SPOTS[j][1])
        expect(d, `spots ${i} and ${j}`).toBeGreaterThanOrEqual(0.6)
      }
    }
  })

  it('give every seeded agent id its own break spot', () => {
    const spots = Array.from({ length: 14 }, (_, i) => PANTRY_SPOTS.length - 1 - ((i + 1) % PANTRY_SPOTS.length))
    expect(new Set(spots).size).toBe(14)
  })
})

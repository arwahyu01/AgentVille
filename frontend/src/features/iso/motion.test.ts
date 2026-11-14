import { describe, expect, it } from 'vitest'
import { ROOMS, seatAt } from '../../lib/officeLayout'
import type { Agent } from '../../types'
import type { SocialCue } from '../office/socialScript'
import { agentTag, goalFor, initialMotion, stepMotion } from './motion'

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 2, name: 'Byte', role: 'Developer', status: 'idle', position_x: 0, position_z: 0, ...over,
})

describe('2D motion goals', () => {
  it('seats a department agent at its own desk chair', () => {
    const g = goalFor(agent(), 1)
    const seat = seatAt(ROOMS.dev, 1)
    expect(g.room.id).toBe('dev')
    expect(g.seated).toBe(true)
    expect(g.point).toEqual([seat.x, seat.z])
  })

  it('keeps simulation staff standing at their post', () => {
    const g = goalFor(agent({ id: 14, role: 'Security', current_room: 'security', status: 'working' }), 0)
    expect(g.room.id).toBe('security')
    expect(g.seated).toBe(false)
  })

  it('follows a backend target room, not a guess', () => {
    const g = goalFor(agent({ current_room: 'dev', target_room: 'meeting' }), 0)
    expect(g.room.id).toBe('meeting')
    expect(g.kind).toBe('meeting')
  })

  it('lets a social cue override only the visual goal', () => {
    const cue = {
      id: 'c1', kind: 'coffee', role: 'host', agentId: 2, partnerId: 3, roomId: 'pantry',
      destination: [10.5, 5.0], faceTarget: [11.5, 5.0], seated: false,
      talkStart: 0, talkEnd: 0, endsAt: 0, lines: [], basis: 'x',
    } as unknown as SocialCue
    const g = goalFor(agent(), 0, cue)
    expect(g.social).toBe(true)
    expect(g.room.id).toBe('pantry')
    expect(g.facing).toBeCloseTo(Math.PI / 2)
  })
})

describe('2D motion steps', () => {
  it('walks door to door and sits down on arrival', () => {
    const home = goalFor(agent(), 0)
    const s = initialMotion(home, 2)
    expect(s.sit).toBe(1)
    const away = goalFor(agent({ current_room: 'dev', target_room: 'meeting' }), 0)
    stepMotion(s, away, 0.016)
    expect(s.route.length).toBeGreaterThan(0)
    for (let i = 0; i < 2000 && (s.route.length > 0 || s.moving); i++) stepMotion(s, away, 0.033)
    for (let i = 0; i < 120; i++) stepMotion(s, away, 0.033)
    expect(s.x).toBeCloseTo(away.point[0], 1)
    expect(s.z).toBeCloseTo(away.point[1], 1)
    expect(s.sit).toBeGreaterThan(0.9)
  })

  it('stays standing while it is still walking', () => {
    const s = initialMotion(goalFor(agent(), 0), 2)
    const away = goalFor(agent({ current_room: 'dev', target_room: 'pantry' }), 0)
    for (let i = 0; i < 40; i++) stepMotion(s, away, 0.033)
    expect(s.moving).toBe(true)
    expect(s.sit).toBeLessThan(0.3)
  })
})

describe('agent tag', () => {
  it('prefers the real task id, otherwise the role tag', () => {
    expect(agentTag(agent(), 23)).toBe('T-23')
    expect(agentTag(agent())).toBe('DEV')
  })
})

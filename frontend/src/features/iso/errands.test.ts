import { describe, expect, it } from 'vitest'
import { ROOMS, seatAt } from '../../lib/officeLayout'
import type { Agent, StreamEvent, Task } from '../../types'
import { BREAK_END_MS, BREAK_START_MS, ERRAND_S, breakGoalFor, errandFor, latestErrandByAgent } from './errands'

const NOW = Date.parse('2026-11-14T10:00:00Z')
const agent = (id: number, name: string, role: string, over: Partial<Agent> = {}): Agent => ({
  id, name, role, status: 'idle', position_x: 0, position_z: 0, ...over,
})
const blaze = agent(10, 'Blaze', 'Frontend Developer')
const quill = agent(5, 'Quill', 'Administrator')
const proof = agent(7, 'Proof', 'Reviewer')
const agents = [blaze, quill, proof]
const slots = { 10: 1, 5: 0, 7: 2 }

const frame = (over: Partial<StreamEvent> = {}): StreamEvent => ({
  kind: 'task', id: 40, taskId: 3, type: 'handoff_requested', message: 'Handoff from step 1 to step 2',
  conversationId: 1, agentId: 10, provider: null, model: null, stepIndex: 1,
  actorAgentId: 10, recipientAgentId: 5, fromRoom: 'dev', toRoom: 'admin',
  createdAt: new Date(NOW - 3_000).toISOString(), ...over,
})

describe('errands', () => {
  it('walks the producer to the recipient desk carrying the artifact', () => {
    const e = errandFor(frame(), agents, slots, NOW)!
    const seat = seatAt(ROOMS.admin, 0)
    expect(e.kind).toBe('handoff')
    expect(e.carrying).toBe(true)
    expect(e.label).toBe('Serah terima ke Quill')
    expect(e.goal.room.id).toBe('admin')
    expect(e.goal.point[1]).toBe(seat.z)
    expect(Math.abs(e.goal.point[0] - seat.x)).toBeCloseTo(0.8, 5)
    expect(e.goal.point[0]).toBeGreaterThan(ROOMS.admin.box[0])
    expect(e.goal.point[0]).toBeLessThan(ROOMS.admin.box[2])
    expect(e.goal.seated).toBe(false)
  })

  it('sends the reviewer with the findings and nothing in hand', () => {
    const e = errandFor(frame({ id: 41, type: 'review_visit', actorAgentId: 7, agentId: 7,
      message: 'Temuan QC untuk langkah 1: ringkasan kurang angka' }), agents, slots, NOW)!
    expect(e.kind).toBe('review')
    expect(e.carrying).toBe(false)
    expect(e.label).toContain('ringkasan kurang angka')
  })

  it('ends after the window and ignores unusable frames', () => {
    const old = new Date(NOW - (ERRAND_S + 1) * 1000).toISOString()
    expect(errandFor(frame({ createdAt: old }), agents, slots, NOW)).toBeNull()
    expect(errandFor(frame({ type: 'travel_started' }), agents, slots, NOW)).toBeNull()
    expect(errandFor(frame({ recipientAgentId: null }), agents, slots, NOW)).toBeNull()
    expect(errandFor(frame({ recipientAgentId: 10 }), agents, slots, NOW)).toBeNull()
    expect(errandFor(frame({ recipientAgentId: 999 }), agents, slots, NOW)).toBeNull()
    expect(errandFor(undefined, agents, slots, NOW)).toBeNull()
  })

  it('tracks the newest errand frame per actor', () => {
    let map = latestErrandByAgent({}, frame({ id: 40 }))
    map = latestErrandByAgent(map, frame({ id: 44 }))
    map = latestErrandByAgent(map, frame({ id: 42 }))
    expect(map[10].id).toBe(44)
    expect(latestErrandByAgent(map, frame({ id: 50, type: 'step_started' }))).toBe(map)
  })
})

describe('after-work break', () => {
  const done = (ago: number): Task => ({
    id: 3, title: 't', description: '', status: 'completed', priority: 'normal', agent_id: 10, parent_id: 1,
    run_mode: 'ai', artifact_path: '', created_at: '', updated_at: new Date(NOW - ago).toISOString(),
  })
  const finished = { ...blaze, status: 'completed' as const }

  it('goes to the pantry shortly after finishing and comes back later', () => {
    expect(breakGoalFor(finished, done(BREAK_START_MS - 1000), NOW)).toBeNull()
    expect(breakGoalFor(finished, done(60_000), NOW)?.room.id).toBe('pantry')
    expect(breakGoalFor(finished, done(BREAK_END_MS + 1000), NOW)).toBeNull()
  })

  it('never pulls away someone who is not really finished', () => {
    expect(breakGoalFor({ ...finished, status: 'working' }, done(60_000), NOW)).toBeNull()
    expect(breakGoalFor({ ...finished, current_room: 'dev', target_room: 'meeting' }, done(60_000), NOW)).toBeNull()
    expect(breakGoalFor(finished, { ...done(60_000), status: 'running' }, NOW)).toBeNull()
    expect(breakGoalFor(finished, undefined, NOW)).toBeNull()
    expect(breakGoalFor(agent(13, 'Dusty', 'Housekeeping', { status: 'completed' }), done(60_000), NOW)).toBeNull()
  })
})

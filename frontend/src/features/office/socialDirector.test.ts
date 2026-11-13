import { describe, expect, it } from 'vitest'
import type { Agent, Task, TaskStatus } from '../../types'
import { SocialDirector } from './socialDirector'
import { SOCIAL_ROOM_IDS, type CueMap } from './socialScript'

function agent(id: number, role: string, room: string): Agent {
  return {
    id,
    name: `Agent ${id}`,
    role,
    status: 'completed',
    position_x: 0,
    position_z: 0,
    current_room: room,
  }
}

let serial = 800

function task(agentId: number, status: TaskStatus, title: string): Task {
  serial += 1
  return {
    id: serial,
    title,
    description: '',
    status,
    priority: 'normal',
    agent_id: agentId,
    parent_id: null,
    run_mode: 'manual',
    artifact_path: '',
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
  }
}

const roster: Agent[] = [
  agent(1, 'Developer', 'dev'),
  agent(2, 'Developer', 'dev'),
  agent(3, 'QA Engineer', 'dev'),
  agent(4, 'Backend Developer', 'dev'),
  agent(5, 'UI/UX Designer', 'design'),
  agent(6, 'Content Creator', 'design'),
  agent(7, 'Data Analyst', 'server'),
  agent(8, 'Researcher', 'analyst'),
  agent(9, 'Product Analyst', 'analyst'),
  agent(10, 'Administrator', 'admin'),
  agent(11, 'Reviewer', 'admin'),
  agent(12, 'AI Coordinator', 'admin'),
  agent(13, 'Frontend Developer', 'dev'),
  agent(14, 'Backend Developer', 'dev'),
]

function firstCue(director: SocialDirector, agents: Agent[], tasks: Task[] = [], limit = 120_000) {
  let at = 0
  let cues: CueMap = {}
  for (let t = 0; t <= limit; t += 1000) {
    cues = director.tick(agents, tasks, t).cues
    if (Object.keys(cues).length) { at = t; break }
  }
  return { at, cues }
}

describe('social director', () => {
  it('is deterministic for a fixed seed and clock', () => {
    const collect = () => {
      const director = new SocialDirector({ fast: true, seed: 202 })
      const frames: CueMap[] = []
      for (let t = 0; t <= 90_000; t += 1000) frames.push(director.tick(roster, [], t).cues)
      return frames
    }
    const a = collect()
    const b = collect()
    expect(a).toEqual(b)
    expect(a.some((frame) => Object.keys(frame).length > 0)).toBe(true)
  })

  it('never double-books an agent, exceeds the caps or crowds one room', () => {
    const director = new SocialDirector({ fast: true, seed: 11 })
    let maxPairs = 0
    let maxSolos = 0
    let sawCue = false

    for (let t = 0; t <= 240_000; t += 1000) {
      const { cues } = director.tick(roster, [], t)
      const values = Object.values(cues)
      if (values.length) sawCue = true
      expect(new Set(values.map((cue) => cue.agentId)).size).toBe(values.length)
      for (const cue of values) expect(SOCIAL_ROOM_IDS).toContain(cue.roomId)

      const pairIds = [...new Set(values.filter((cue) => cue.partnerId != null).map((cue) => cue.id))]
      const pairRooms: string[] = []
      for (const id of pairIds) {
        const group = values.filter((cue) => cue.id === id)
        expect(group).toHaveLength(2)
        expect(new Set(group.map((cue) => cue.role))).toEqual(new Set(['host', 'guest']))
        expect(group[0].roomId).toBe(group[1].roomId)
        expect(group[0].partnerId).toBe(group[1].agentId)
        pairRooms.push(group[0].roomId)
      }
      expect(new Set(pairRooms).size).toBe(pairRooms.length)

      const solos = values.filter((cue) => cue.partnerId == null)
      const soloCount = new Map<string, number>()
      for (const cue of solos) {
        expect(pairRooms).not.toContain(cue.roomId)
        soloCount.set(cue.roomId, (soloCount.get(cue.roomId) ?? 0) + 1)
      }
      for (const [room, count] of soloCount) {
        expect(count).toBeLessThanOrEqual(room === 'pantry' || room === 'lobby' ? 2 : 1)
      }

      maxPairs = Math.max(maxPairs, pairIds.length)
      maxSolos = Math.max(maxSolos, solos.length)
    }

    expect(sawCue).toBe(true)
    expect(maxPairs).toBeLessThanOrEqual(3)
    expect(maxSolos).toBeLessThanOrEqual(2)
  })

  it('never starts a cue for a colleague with open work', () => {
    const director = new SocialDirector({ fast: true, seed: 5 })
    const blocked = roster.map((a) => (a.id === 1 ? { ...a, status: 'idle' as const } : a))
    const tasks = [task(1, 'running', 'open task')]
    let sawOthers = false
    for (let t = 0; t <= 60_000; t += 1000) {
      const { cues } = director.tick(blocked, tasks, t)
      expect(cues[1]).toBeUndefined()
      if (Object.keys(cues).length) sawOthers = true
    }
    expect(sawOthers).toBe(true)
  })

  it('cancels the whole pair when one participant starts working', () => {
    const director = new SocialDirector({ fast: true, seed: 31 })
    const { at, cues } = firstCue(director, roster)
    const first = Object.values(cues)[0]
    expect(first).toBeDefined()
    const members = first.partnerId != null ? [first.agentId, first.partnerId] : [first.agentId]
    const changed = roster.map((a) => members.includes(a.id) ? { ...a, status: 'working' as const } : a)
    const after = director.tick(changed, [], at + 1000).cues
    for (const id of members) expect(after[id]).toBeUndefined()
  })

  it('rests participants for a while after their encounter ends', () => {
    const director = new SocialDirector({ fast: true, seed: 41 })
    const { cues } = firstCue(director, roster)
    const first = Object.values(cues)[0]
    expect(first).toBeDefined()
    const members = first.partnerId != null ? [first.agentId, first.partnerId] : [first.agentId]
    const removeAt = Math.ceil(first.endsAt / 1000) * 1000
    for (let t = removeAt; t < removeAt + 30_000; t += 1000) {
      const { cues: later } = director.tick(roster, [], t)
      for (const id of members) expect(later[id]).toBeUndefined()
    }
  })
})

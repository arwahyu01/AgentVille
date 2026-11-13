import { describe, expect, it } from 'vitest'
import { blockedAt } from '../../lib/collision'
import type { Agent, Task, TaskStatus } from '../../types'
import {
  OPEN_TASK_STATUSES, SOCIAL_ANCHOR, SOCIAL_ROOM_IDS, activeSocialLine, basisFor,
  buildPairLines, clipTitle, hasOpenTask, isEligibleAgent, pairPoints,
  restingPose, socialRoute, travelSeconds, wanderPoint, type RestingPose,
} from './socialScript'

let serial = 100

function agent(
  id: number,
  role: string,
  room: string,
  status: Agent['status'] = 'completed',
  extra: Partial<Agent> = {},
): Agent {
  return {
    id,
    name: `Agent ${id}`,
    role,
    status,
    position_x: 0,
    position_z: 0,
    current_room: room,
    ...extra,
  }
}

function task(
  agentId: number | null,
  status: TaskStatus,
  title: string,
  id: number = (serial += 1),
): Task {
  return {
    id,
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

describe('social eligibility', () => {
  it('blocks every open task status and allows finished work', () => {
    const statuses: TaskStatus[] = ['pending', 'clarifying', 'awaiting_approval', 'approved', 'queued', 'running', 'reviewing']
    for (const status of statuses) {
      expect(OPEN_TASK_STATUSES.has(status)).toBe(true)
      expect(hasOpenTask(5, [task(5, status, 'open work')])).toBe(true)
      expect(isEligibleAgent(agent(5, 'Developer', 'dev', 'idle'), [task(5, status, 'open work')])).toBe(false)
    }
    for (const status of ['completed', 'failed', 'cancelled'] as TaskStatus[]) {
      expect(OPEN_TASK_STATUSES.has(status)).toBe(false)
      expect(hasOpenTask(5, [task(5, status, 'done work')])).toBe(false)
      expect(isEligibleAgent(agent(5, 'Developer', 'dev', 'completed'), [task(5, status, 'done work')])).toBe(true)
    }
  })

  it('keeps staff, travel, meetings and active workers at their post', () => {
    expect(isEligibleAgent(agent(1, 'Housekeeping', 'pantry', 'idle'), [])).toBe(false)
    expect(isEligibleAgent(agent(2, 'Security', 'security', 'idle'), [])).toBe(false)
    expect(isEligibleAgent(agent(3, 'Developer', 'dev', 'completed', { target_room: 'meeting' }), [])).toBe(false)
    expect(isEligibleAgent(agent(4, 'Developer', 'meeting', 'completed'), [])).toBe(false)
    for (const status of ['working', 'waiting', 'reviewing'] as Agent['status'][]) {
      expect(isEligibleAgent(agent(6, 'Developer', 'dev', status), [])).toBe(false)
    }
    for (const status of ['idle', 'completed', 'failed'] as Agent['status'][]) {
      expect(isEligibleAgent(agent(7, 'Developer', 'dev', status), [])).toBe(true)
    }
  })

  it('uses a stable backend basis across refreshed object identities', () => {
    const original = agent(8, 'Developer', 'dev', 'completed')
    const refreshed = { ...original }
    expect(basisFor(original, [])).toBe(basisFor(refreshed, []))
    expect(basisFor(original, [task(8, 'running', 'new work')])).not.toBe(basisFor(original, []))
  })
})

describe('social anchors', () => {
  it('places every chat and roam mark on walkable floor', () => {
    expect([...SOCIAL_ROOM_IDS]).toEqual(['lobby', 'pantry', 'analyst', 'design', 'dev', 'cs', 'admin'])
    for (const roomId of SOCIAL_ROOM_IDS) {
      const [ax, az] = SOCIAL_ANCHOR[roomId]
      expect(blockedAt(ax, az, 0.32), `${roomId} anchor`).toBe(false)
      for (const [x, z] of pairPoints(roomId)) {
        expect(blockedAt(x, z, 0.32), `${roomId} pair point`).toBe(false)
      }
      for (const slot of [0, 1]) {
        const [x, z] = wanderPoint(roomId, slot)
        expect(blockedAt(x, z, 0.32), `${roomId} wander ${slot}`).toBe(false)
      }
    }
  })

  it('keeps the meeting, server and security rooms out of the social map', () => {
    expect(SOCIAL_ANCHOR).not.toHaveProperty('meeting')
    expect(SOCIAL_ANCHOR).not.toHaveProperty('server')
    expect(SOCIAL_ANCHOR).not.toHaveProperty('security')
  })
})

describe('social script', () => {
  const host = agent(11, 'Developer', 'dev')
  const guest = agent(12, 'UI/UX Designer', 'design')

  it('quotes only completed task titles, clipped to the agreed length', () => {
    const longTitle = 'Merapikan halaman onboarding yang sudah selesai dikerjakan bersama tim desain dan tim developer minggu lalu'
    const clipped = clipTitle(longTitle)
    expect(clipped.length).toBeLessThanOrEqual(48)
    expect(clipped.endsWith('…')).toBe(true)
    const lines = buildPairLines('chat', host, guest, 'dev', [task(11, 'completed', longTitle)], 10_000, 77)
    const work = lines.lines.filter((line) => line.tone === 'work')
    expect(work.length).toBeGreaterThan(0)
    expect(work[0].text).toContain(clipped)
    expect(work[0].text).not.toMatch(/running|pending|queued|provider|opencode|qoder|persen|%/i)
  })

  it('falls back to room chatter when nobody has finished anything', () => {
    const lines = buildPairLines('chat', host, guest, 'pantry', [task(11, 'running', 'still open')], 10_000, 4)
    expect(lines.lines.some((line) => line.tone === 'work')).toBe(false)
    expect(lines.lines.map((line) => line.text).join(' ')).not.toMatch(/running|pending|queued|provider|opencode|qoder/i)
  })

  it('is deterministic for a given seed and keeps a conversation under nine seconds', () => {
    const a = buildPairLines('chat', host, guest, 'dev', [], 20_000, 1234)
    const b = buildPairLines('chat', host, guest, 'dev', [], 20_000, 1234)
    expect(a).toEqual(b)
    expect(a.talkEnd - 20_000).toBeLessThanOrEqual(9000)
    const greeting = buildPairLines('greet', host, guest, 'dev', [], 20_000, 1234)
    expect(greeting.lines).toHaveLength(2)
    expect(greeting.lines.map((line) => line.speakerId)).toEqual([host.id, guest.id])
  })

  it('shows a line only to its own speaker during its own window', () => {
    const built = buildPairLines('greet', host, guest, 'dev', [], 5_000, 9)
    const first = built.lines[0]
    expect(activeSocialLine({ ...cueFor(host, built.lines, 5_000, built.talkEnd) }, host.id, first.at)).toBe(first)
    expect(activeSocialLine(cueFor(host, built.lines, 5_000, built.talkEnd), guest.id, first.at)).toBeNull()
    expect(activeSocialLine(cueFor(host, built.lines, 5_000, built.talkEnd), guest.id, first.until + 10)).toBe(built.lines[1])
    expect(activeSocialLine(cueFor(host, built.lines, 5_000, built.talkEnd), host.id, built.talkEnd + 1)).toBeNull()
  })
})

function cueFor(a: Agent, lines: ReturnType<typeof buildPairLines>['lines'], talkStart: number, talkEnd: number) {
  return {
    id: 'test', kind: 'greet' as const, role: 'host' as const, agentId: a.id, partnerId: null,
    roomId: 'dev', destination: [0, 0] as [number, number], faceTarget: [0, 0] as [number, number],
    seated: false, talkStart, talkEnd, endsAt: talkEnd + 1000, lines, basis: '',
  }
}

describe('social movement', () => {
  it('walks a seated colleague out through the aisle instead of over the desk', () => {
    const dev = agent(21, 'Developer', 'dev')
    const rest: RestingPose = restingPose(dev, 0)
    expect(rest.seated).toBe(true)
    const route = socialRoute(rest.room, rest.room, [-3.9, -3.2], [rest.x, rest.z])
    expect(route.length).toBeGreaterThan(1)
    expect(route[route.length - 1]).toEqual([-3.9, -3.2])
    expect(route[0][0]).not.toBe(rest.x)
  })

  it('estimates a longer trip between rooms than within one room', () => {
    const from = { x: -3.9, z: -3.2, room: restingPose(agent(22, 'Developer', 'dev'), 0).room }
    const pantry = restingPose(agent(23, 'Administrator', 'pantry'), 0).room
    const same = travelSeconds(from, from.room, [from.x + 1, from.z])
    const cross = travelSeconds(from, pantry, [9.9, 5.6])
    expect(same).toBeGreaterThan(0)
    expect(cross).toBeGreaterThan(same)
  })
})

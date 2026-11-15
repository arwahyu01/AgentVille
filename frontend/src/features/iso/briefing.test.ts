import { describe, expect, it } from 'vitest'
import { ROOMS } from '../../lib/officeLayout'
import type { Agent, StreamEvent } from '../../types'
import { BRIEFING_S, briefingActive, briefingFor, briefingGoal, briefingTopic, isPlanBriefing, parseParticipants } from './briefing'
import { PRESENTER_SPOT } from './poses'

const NOW = Date.parse('2026-11-15T10:00:00Z')
const agent = (id: number, name: string, role: string): Agent => ({ id, name, role, status: 'idle', position_x: 0, position_z: 0 })
const agents = [agent(1, 'Atlas', 'AI Coordinator'), agent(9, 'Ink', 'UI/UX Designer'), agent(10, 'Blaze', 'Frontend Developer')]

const frame = (over: Partial<StreamEvent> = {}): StreamEvent => ({
  kind: 'task', id: 50, taskId: 3, type: 'meeting_started',
  message: 'Rencana v1: Halaman kopi dua langkah (briefing tim · peserta: Atlas, Ink, Blaze)',
  conversationId: 3, agentId: 1, provider: null, model: null, stepIndex: null,
  createdAt: new Date(NOW - 2_000).toISOString(), ...over,
})

describe('briefing frame', () => {
  it('recognises the plan briefing but not the QC meeting', () => {
    expect(isPlanBriefing(frame())).toBe(true)
    expect(isPlanBriefing(frame({ message: 'QC meeting: Buatkan halaman (participants: Ink, Blaze)' }))).toBe(false)
    expect(isPlanBriefing(frame({ type: 'meeting_ended' }))).toBe(false)
  })

  it('reads the topic and the participants from the message', () => {
    expect(parseParticipants(frame().message)).toEqual(['Atlas', 'Ink', 'Blaze'])
    expect(parseParticipants('Rencana v1: x (menunggu persetujuan · peserta: Sage)')).toEqual(['Sage'])
    expect(parseParticipants('Rencana v1: tanpa peserta')).toEqual([])
    expect(briefingTopic(frame().message)).toBe('Rencana v1: Halaman kopi dua langkah')
    // Long topics are cut at a word boundary with an ellipsis, never mid-word.
    const long = briefingTopic('Rencana v9: Riset keamanan aplikasi dua langkah lengkap (briefing tim · peserta: A)')
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(44)
    expect(long).toBe('Rencana v9: Riset keamanan aplikasi dua…')
    // A single very long word still fits.
    expect(briefingTopic('Rencana v1: ' + 'x'.repeat(80) + ' (briefing tim · peserta: A)').length).toBe(44)
  })
})

describe('briefingFor', () => {
  it('makes the Coordinator the presenter and seats everyone else in order', () => {
    const b = briefingFor(frame(), agents)!
    expect(b.leaderId).toBe(1)
    expect(b.seats).toEqual({ 9: 0, 10: 1 })
    expect(b.topic).toBe('Rencana v1: Halaman kopi dua langkah')
  })

  it('ignores unknown names, other events and an empty crew', () => {
    expect(briefingFor(frame({ message: 'Rencana v1: x (briefing tim · peserta: Nadia)' }), agents)).toBeNull()
    expect(briefingFor(frame({ type: 'step_started' }), agents)).toBeNull()
    expect(briefingFor(null, agents)).toBeNull()
    expect(briefingFor(frame({ createdAt: null }), agents)).toBeNull()
    const noLeader = briefingFor(frame({ message: 'Rencana v1: x (briefing tim · peserta: Ink)' }), agents)!
    expect(noLeader.leaderId).toBeNull()
    expect(noLeader.seats).toEqual({ 9: 0 })
  })

  it('is active only for a short window after the frame', () => {
    const b = briefingFor(frame(), agents)
    expect(briefingActive(b, NOW)).toBe(true)
    expect(briefingActive(b, NOW + (BRIEFING_S + 1) * 1000)).toBe(false)
    expect(briefingActive(b, NOW - 60_000)).toBe(false)
    expect(briefingActive(null, NOW)).toBe(false)
  })
})

describe('briefingGoal', () => {
  it('stands the leader at the presenter spot and seats the rest at the table', () => {
    const b = briefingFor(frame(), agents)!
    expect(briefingGoal(b, 1)!.point).toEqual(PRESENTER_SPOT)
    const ink = briefingGoal(b, 9)!
    const blaze = briefingGoal(b, 10)!
    expect(ink.room.id).toBe('meeting')
    expect(ink.seated).toBe(true)
    expect(ink.point).not.toEqual(blaze.point)
    for (const g of [ink, blaze]) {
      const [x0, z0, x1, z1] = ROOMS.meeting.box
      expect(g.point[0]).toBeGreaterThan(x0)
      expect(g.point[0]).toBeLessThan(x1)
      expect(g.point[1]).toBeGreaterThan(z0)
      expect(g.point[1]).toBeLessThan(z1)
    }
    expect(briefingGoal(b, 999)).toBeNull()
  })
})

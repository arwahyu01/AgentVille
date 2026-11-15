/** The team briefing the leader holds when a plan is proposed, replayed in the 2D office.
 *
 *  The backend signs a plan off immediately, so the briefing starts and ends inside one request:
 *  there is never a moment where the crew is "in the meeting room" in the database. The journal
 *  does keep the `meeting_started` frame, with the topic and the participants' names, so the
 *  office replays the briefing from it for a few seconds: everyone walks to the room, the
 *  Coordinator presents beside the screen, and the screen shows the topic. After that the normal
 *  state (desks, work, breaks) takes over again. No frame, no briefing. */
import { parseUtc } from '../../lib/activity'
import { ROOMS, seatAt } from '../../lib/officeLayout'
import type { Agent, StreamEvent } from '../../types'
import type { MotionGoal } from './motion'
import { presenterGoal } from './poses'

/** How long the replay holds the crew in the meeting room. */
export const BRIEFING_S = 14

export interface Briefing {
  eventId: number
  startedAt: number
  /** Text for the meeting-room screen, e.g. "Rencana v1: Halaman kopi dua langkah". */
  topic: string
  /** The Coordinator among the participants, who presents. */
  leaderId: number | null
  /** Agent id → meeting seat index, for everyone except the leader. */
  seats: Record<number, number>
}

export function isPlanBriefing(event: Pick<StreamEvent, 'type' | 'message'>): boolean {
  return event.type === 'meeting_started' && /^Rencana v\d+/i.test(event.message)
}

/** Names after "peserta:" in the frame's message, in order. */
export function parseParticipants(message: string): string[] {
  const m = message.match(/peserta:\s*([^)]*)\)?\s*$/i)
  if (!m) return []
  return m[1].split(',').map((n) => n.trim()).filter(Boolean)
}

export const TOPIC_MAX = 44

/** The text before the participants, cut at a word boundary so the screen never shows half a word. */
export function briefingTopic(message: string): string {
  const head = message.split(' (')[0].trim()
  if (head.length <= TOPIC_MAX) return head
  const cut = head.slice(0, TOPIC_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 12 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export function briefingFor(event: StreamEvent | null | undefined, agents: Agent[]): Briefing | null {
  if (!event || !isPlanBriefing(event)) return null
  const startedAt = event.createdAt ? parseUtc(event.createdAt) : NaN
  if (!Number.isFinite(startedAt)) return null
  const byName = new Map(agents.map((a) => [a.name, a]))
  const people = parseParticipants(event.message).map((n) => byName.get(n)).filter((a): a is Agent => !!a)
  if (people.length === 0) return null
  const leader = people.find((a) => a.role === 'AI Coordinator') ?? null
  const seats: Record<number, number> = {}
  let next = 0
  for (const a of people) if (a !== leader) seats[a.id] = next++
  return { eventId: event.id, startedAt, topic: briefingTopic(event.message), leaderId: leader?.id ?? null, seats }
}

export function briefingActive(b: Briefing | null, now: number): b is Briefing {
  return !!b && now >= b.startedAt && (now - b.startedAt) / 1000 <= BRIEFING_S
}

/** Where an agent stands during the briefing, or null when it is not part of it. */
export function briefingGoal(b: Briefing, agentId: number): MotionGoal | null {
  if (b.leaderId === agentId) return presenterGoal()
  const index = b.seats[agentId]
  if (index == null) return null
  const seat = seatAt(ROOMS.meeting, index)
  return {
    key: `briefing:${b.eventId}:${index}`,
    room: ROOMS.meeting,
    point: [seat.x, seat.z],
    facing: seat.facing,
    seated: seat.seated,
    social: false,
    kind: 'meeting',
  }
}

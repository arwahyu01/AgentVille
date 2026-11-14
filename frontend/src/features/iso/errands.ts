/** Short trips the office replays from real journal frames, plus the after-work break. Pure.
 *
 *  The backend records a handoff or a QC visit as one instant (the trip out and back are written
 *  in the same transaction), so there is no in-between state to draw. The 2D office therefore
 *  replays the trip from the frame itself: for a few seconds after a `handoff_requested` or
 *  `review_visit` frame, its actor walks to the recipient's desk, then goes back to whatever the
 *  backend state says. No frame, no trip. */
import { parseUtc, poseFor } from '../../lib/activity'
import { OPERATIONAL_ROLES, ROOMS, seatAt } from '../../lib/officeLayout'
import type { Agent, StreamEvent, Task } from '../../types'
import { PANTRY_SPOTS } from './claudeSeats'
import type { MotionGoal } from './motion'

export type ErrandKind = 'handoff' | 'review'

const KIND_BY_TYPE: Record<string, ErrandKind> = { handoff_requested: 'handoff', review_visit: 'review' }
/** How long the actor stays out for one frame (walk there and stand at the desk). */
export const ERRAND_S = 18

export interface Errand {
  kind: ErrandKind
  goal: MotionGoal
  /** A handoff carries the artifact; a review visit brings words. */
  carrying: boolean
  label: string
}

export function isErrandEvent(event: Pick<StreamEvent, 'type'>): boolean {
  return event.type in KIND_BY_TYPE
}

/** Newest errand frame per acting agent. */
export function latestErrandByAgent(
  current: Record<number, StreamEvent>, event: StreamEvent,
): Record<number, StreamEvent> {
  const actor = event.actorAgentId
  if (actor == null || !isErrandEvent(event)) return current
  const known = current[actor]
  if (known && known.id >= event.id) return current
  return { ...current, [actor]: event }
}

export function errandFor(
  event: StreamEvent | undefined, agents: Agent[], slots: Record<number, number>, now: number = Date.now(),
): Errand | null {
  if (!event) return null
  const kind = KIND_BY_TYPE[event.type]
  if (!kind || event.actorAgentId == null || event.recipientAgentId == null) return null
  if (event.actorAgentId === event.recipientAgentId) return null
  const at = event.createdAt ? parseUtc(event.createdAt) : NaN
  const age = (now - at) / 1000
  if (!Number.isFinite(age) || age < 0 || age > ERRAND_S) return null
  const recipient = agents.find((a) => a.id === event.recipientAgentId)
  if (!recipient) return null
  const pose = poseFor(recipient)
  const room = pose.targetRoom ?? pose.homeRoom
  const seat = seatAt(room, slots[recipient.id] ?? 0)
  // Stand beside the recipient's chair, on the side with more room, facing them.
  const side = seat.x <= room.center[0] ? 1 : -1
  const x = Math.min(room.box[2] - 0.4, Math.max(room.box[0] + 0.4, seat.x + side * 0.8))
  return {
    kind,
    carrying: kind === 'handoff',
    label: kind === 'handoff' ? `Serah terima ke ${recipient.name}` : event.message.trim(),
    goal: {
      key: `errand:${event.id}`,
      room,
      point: [x, seat.z],
      facing: Math.atan2(seat.x - x, 0.0001),
      seated: false,
      social: false,
      kind: 'travel',
    },
  }
}

// ── After-work break ─────────────────────────────────────────────────────────────────────────

export const BREAK_START_MS = 20_000
export const BREAK_END_MS = 5 * 60_000

/** An agent whose last task completed a moment ago steps out to the pantry for a few minutes,
 *  then returns to its desk. Derived from the real task row (status + updated_at); an agent that
 *  is working, waiting, travelling or has never finished anything stays where the backend put it. */
export function breakGoalFor(agent: Agent, task: Task | undefined, now: number = Date.now()): MotionGoal | null {
  if (OPERATIONAL_ROLES.has(agent.role) || agent.status !== 'completed') return null
  if (agent.target_room && agent.target_room !== agent.current_room) return null
  if (!task || task.status !== 'completed') return null
  const quiet = now - parseUtc(task.updated_at)
  if (!Number.isFinite(quiet) || quiet < BREAK_START_MS || quiet > BREAK_END_MS) return null
  // Agents fill the pantry spots from the end; Claude sessions fill them from the start.
  const k = PANTRY_SPOTS.length - 1 - (Math.abs(agent.id) % PANTRY_SPOTS.length)
  const [x, z] = PANTRY_SPOTS[k]
  return {
    key: `break:${k}`,
    room: ROOMS.pantry,
    point: [x, z],
    facing: Math.atan2(10.45 - x, 5.6 - z),
    seated: false,
    social: false,
    kind: 'ambient',
  }
}

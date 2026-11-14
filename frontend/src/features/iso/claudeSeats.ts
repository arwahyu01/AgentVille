/** Where Claude Code sessions sit in the 2D office. Pure, so it can be tested without Pixi.
 *
 *  Rules, all derived from the session status the hooks reported:
 *  - each session gets a free department desk (one no AgentVille agent uses), in start order;
 *  - `working` sits and types, `waiting` stands up at the desk with a "!" (it needs you);
 *  - a session that finished (`completed`/`idle`) and stayed quiet for a few minutes takes a break
 *    in the pantry, like a colleague whose work is done;
 *  - sessions beyond the free desks stand along the corridor. */
import { poseFor } from '../../lib/activity'
import { ROOMS, seatAt, type Room } from '../../lib/officeLayout'
import type { Agent, ClaudeSession } from '../../types'
import type { MotionGoal } from './motion'

export const DESK_ROOMS = ['dev', 'design', 'analyst', 'admin', 'cs'] as const
export const BREAK_AFTER_MS = 3 * 60_000
/** A finished turn keeps its "Selesai: …" bubble this long. */
export const DONE_BUBBLE_MS = 20_000

/** Standing spots in the pantry, clear of the tables, stools and counter. Claude sessions take them
 *  from the first; agents on break take them from the last, so the two rarely meet. */
export const PANTRY_SPOTS: [number, number][] = [
  [9.85, 5.05], [11.25, 5.35], [10.15, 6.45], [11.55, 6.55], [9.75, 3.15], [11.85, 3.25], [10.9, 8.2], [9.7, 7.9],
  [9.5, 4.2], [11.2, 4.2], [10.4, 2.6], [11.4, 2.4], [9.5, 6.0], [11.2, 7.5], [10.4, 8.7], [11.5, 8.6],
]
export const CORRIDOR_SPOTS: [number, number][] = [
  [-4.2, 0.55], [-2.2, -0.55], [1.2, 0.55], [3.0, -0.55], [5.0, 0.55], [-8.0, -0.55], [8.6, 0.55], [-10.0, 0.55],
]

export interface Desk { room: Room; index: number }

/** Department desks no AgentVille agent occupies (home or destination), in a stable order. */
export function freeDesks(agents: Agent[], slots: Record<number, number>): Desk[] {
  const taken = new Set<string>()
  for (const a of agents) {
    const p = poseFor(a)
    const room = p.targetRoom ?? p.homeRoom
    taken.add(`${room.id}:${slots[a.id] ?? 0}`)
  }
  const out: Desk[] = []
  for (const id of DESK_ROOMS) {
    ROOMS[id].stations.forEach((_, index) => {
      if (!taken.has(`${id}:${index}`)) out.push({ room: ROOMS[id], index })
    })
  }
  return out
}

export function onBreak(session: ClaudeSession, now: number): boolean {
  if (session.status !== 'completed' && session.status !== 'idle') return false
  const quiet = now - Date.parse(session.updated_at)
  return Number.isFinite(quiet) && quiet > BREAK_AFTER_MS
}

/** Goals for every session, keyed by session id. `sessions` must be in start order. */
export function claudeGoals(sessions: ClaudeSession[], desks: Desk[], now: number): Record<string, MotionGoal> {
  const out: Record<string, MotionGoal> = {}
  let breakIndex = 0
  sessions.forEach((s, i) => {
    if (onBreak(s, now)) {
      const k = breakIndex++ % PANTRY_SPOTS.length
      const [x, z] = PANTRY_SPOTS[k]
      // Face the bistro table between the spots.
      const facing = Math.atan2(10.45 - x, 5.6 - z)
      out[s.session_id] = {
        key: `claude:break:${k}`, room: ROOMS.pantry, point: [x, z], facing,
        seated: false, social: false, kind: 'ambient',
      }
      return
    }
    const desk = desks[i]
    if (!desk) {
      const [x, z] = CORRIDOR_SPOTS[(i - desks.length) % CORRIDOR_SPOTS.length]
      out[s.session_id] = {
        key: `claude:corridor:${i}`, room: roomOfCorridor(), point: [x, z], facing: 0,
        seated: false, social: false, kind: s.status === 'working' ? 'work' : 'ambient',
      }
      return
    }
    const seat = seatAt(desk.room, desk.index)
    const seated = s.status !== 'waiting'
    out[s.session_id] = {
      key: `claude:${desk.room.id}:${desk.index}:${seated ? 1 : 0}`,
      room: desk.room,
      point: [seat.x, seat.z],
      facing: seat.facing,
      seated,
      social: false,
      kind: s.status === 'working' ? 'work' : 'ambient',
    }
  })
  return out
}

/** The corridor has no Room of its own; the lobby is the nearest walkable zone for routing, and
 *  `routeTo` leaves through the room door onto the spine, which is where these spots sit. */
function roomOfCorridor(): Room {
  return ROOMS.lobby
}

/** Project folder as the name, with a short id when two sessions share a folder. */
export function claudeNames(sessions: ClaudeSession[]): Record<string, string> {
  const seen: Record<string, number> = {}
  for (const s of sessions) seen[s.project] = (seen[s.project] ?? 0) + 1
  const out: Record<string, string> = {}
  for (const s of sessions) {
    const base = s.project || 'claude'
    out[s.session_id] = seen[s.project] > 1 ? `${base} ·${s.session_id.slice(0, 4)}` : base
  }
  return out
}

/** Which line a session's bubble shows right now, or null for none. */
export function claudeBubble(s: ClaudeSession, now: number, selected: boolean): string | null {
  if (!s.activity) return null
  if (selected || s.status === 'working' || s.status === 'waiting' || s.status === 'failed') return s.activity
  const age = now - Date.parse(s.updated_at)
  return s.status === 'completed' && age < DONE_BUBBLE_MS ? s.activity : null
}

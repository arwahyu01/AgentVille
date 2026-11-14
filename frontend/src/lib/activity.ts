import type { Agent, StreamEvent, Task, TaskStatus } from '../types'
import { ROOMS, pathBetween, roomForRole, type Room } from './officeLayout'

/** SQLite/JSON timestamps are naive UTC; without the Z they would be read as local time. */
export function parseUtc(stamp: string): number {
  const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(stamp)
  return new Date(hasZone ? stamp : `${stamp}Z`).getTime()
}

/** Newest journal frame per agent — the only thing allowed to say what a workstation is doing. */
export function latestByAgent(events: StreamEvent[]): Record<number, StreamEvent> {
  const map: Record<number, StreamEvent> = {}
  for (const event of events) {
    if (event.agentId == null) continue
    const known = map[event.agentId]
    if (!known || event.id > known.id) map[event.agentId] = event
  }
  return map
}

export function activityLine(agent: Agent, event?: StreamEvent): string {
  if (!event) return agent.status
  // Per-tool frames already carry a readable line ("Edit App.tsx").
  if (event.type.startsWith('action_') && event.message.trim()) return event.message.trim()
  const step = event.stepIndex != null ? ` #${event.stepIndex}` : ''
  const provider = event.provider ? ` · ${event.provider}` : ''
  return `${event.type.replace(/_/g, ' ')}${step}${provider}`
}

/** True while the frame is fresh enough to deserve a pulse under the workstation. */
export function pulseAge(event: StreamEvent | undefined, now: number = Date.now()): number {
  if (!event?.createdAt) return Infinity
  return (now - parseUtc(event.createdAt)) / 1000
}

export type MotionKind = 'ambient' | 'work' | 'travel' | 'meeting'

export interface AgentPose {
  agentId: number
  kind: MotionKind
  /** Room the agent is stationed in when not travelling. */
  homeRoom: Room
  /** Room the agent is currently in (or leaving). */
  currentRoom: Room
  /** Room the agent is heading to, or null once settled. */
  targetRoom: Room | null
}

/** Project the persisted, event-driven agent state into a pose the scene can render. Rooms only
 * change through backend assignment/handoff/meeting events, so this never invents motion: an idle
 * figure whose target equals its home simply rests at its department station (kind ambient/work). */
export function poseFor(agent: Agent): AgentPose {
  const current = (agent.current_room ? ROOMS[agent.current_room] : undefined) ?? roomForRole(agent.role)
  const targetId = agent.target_room && agent.target_room !== agent.current_room ? agent.target_room : null
  const target = targetId ? (ROOMS[targetId] ?? current) : null
  let kind: MotionKind
  if (targetId === 'meeting') kind = 'meeting'
  else if (target) kind = 'travel'
  else kind = agent.status === 'idle' ? 'ambient' : 'work'
  return { agentId: agent.id, kind, homeRoom: current, currentRoom: current, targetRoom: target }
}

/** South-band chairs sit on the far side of the desk from the door, so a seated figure has to
 * round the desk instead of walking over it. The lane runs down the gap between two desk columns
 * and stops in the clear strip in front of the front row. Returns seat -> side lane -> front lane. */
function southDetour(room: Room, seat: [number, number]): [number, number][] {
  if (room.band !== 'south' || room.kind !== 'dept' || !room.seatOffset) return []
  const inRoom = (x: number) => x > room.box[0] + 0.35 && x < room.box[2] - 0.35
  const lanes = [seat[0] - 1.0, seat[0] + 1.0].filter(inRoom)
  if (!lanes.length) return []
  const laneX = lanes.sort((a, b) => Math.abs(a - room.center[0]) - Math.abs(b - room.center[0]))[0]
  return [[laneX, seat[1]], [laneX, room.box[1] + 0.55]]
}

function isSeatOf(room: Room, p: [number, number]): boolean {
  if (!room.seatOffset) return false
  return room.stations.some(([x, z]) =>
    Math.hypot(p[0] - (x + room.seatOffset![0]), p[1] - (z + room.seatOffset![1])) < 0.5)
}

/** Waypoints (world x/z) the figure walks to reach a room and settle on its station: exit through
 * the source door, ride the corridor, enter the target door, then step up to the desk. Returns just
 * the station when the agent is already in the room, so nobody teleports or walks through a wall. */
export function routeTo(
  from: Room, to: Room, destination?: [number, number], start?: [number, number],
): [number, number][] {
  if (from === to) return []
  const route = pathBetween(from, to)
  const leaving = start && isSeatOf(from, start) ? southDetour(from, start) : []
  const arriving = destination ? southDetour(to, destination).reverse() : []
  return [...leaving, ...route, ...arriving, ...(destination ? [destination] : [])]
}

/** The freshest travel/handoff event for a given agent, used to fire a pulse the moment it moves. */
export function newestMotionEvent(agentId: number, events: StreamEvent[]): StreamEvent | undefined {
  let found: StreamEvent | undefined
  for (const event of events) {
    if (event.actorAgentId !== agentId) continue
    if (!['travel_started', 'travel_arrived', 'handoff_requested', 'handoff_accepted'].includes(event.type)) continue
    if (!found || event.id > found.id) found = event
  }
  return found
}

/** How far a task reads as done, keyed only to the backend task status — never to invented motion.
 * The values are eye-pleasing stops along the real lifecycle, not a claim of elapsed work. */
const STATUS_PROGRESS: Record<TaskStatus, number> = {
  pending: 0.08, clarifying: 0.2, awaiting_approval: 0.34, approved: 0.46,
  queued: 0.56, running: 0.74, reviewing: 0.9, completed: 1, failed: 1, cancelled: 1,
}

/** The task an agent is actually carrying: its most recent open assignment, else the freshest one. */
export function taskOfAgent(agentId: number, tasks: Task[]): Task | undefined {
  let best: Task | undefined
  for (const task of tasks) {
    if (task.agent_id !== agentId) continue
    const open = task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled'
    const bestOpen = best ? best.status !== 'completed' && best.status !== 'failed' && best.status !== 'cancelled' : false
    if (!best || (open && !bestOpen) || (open === bestOpen && task.id > best.id)) best = task
  }
  return best
}

/** Everything the on-screen dialogue box needs to say what a person is doing and how far along,
 * all derived from real backend state: the latest journal frame, the task row and the agent row. */
export interface WorkBrief {
  /** What the person is doing right now, from the newest real event (or the honest idle phrase). */
  doing: string
  /** Human word for the lifecycle stage, e.g. "Running", "In review", "Resting". */
  stage: string
  /** 0–1 completion stop from the task status. */
  fraction: number
  /** Plan step index the backend reports, if any. */
  step: number | null
  task: Task | null
}

const IDLE_PHRASE: Record<Agent['status'], string> = {
  idle: 'Resting at the desk — no active event.',
  working: 'Working the current step.',
  waiting: 'Waiting on a handoff or approval.',
  reviewing: 'Reading a review comment.',
  completed: 'Last assignment wrapped up.',
  failed: 'Last assignment failed — standing by.',
}

const STAGE_WORD: Record<Agent['status'], string> = {
  idle: 'Resting', working: 'Working', waiting: 'Waiting',
  reviewing: 'In review', completed: 'Completed', failed: 'Failed',
}

export function workBrief(agent: Agent, task: Task | undefined, event: StreamEvent | undefined): WorkBrief {
  const doing = event?.message?.trim() || IDLE_PHRASE[agent.status]
  const step = event?.stepIndex ?? agent.active_step_index ?? null
  return {
    doing,
    stage: STAGE_WORD[agent.status],
    fraction: task ? STATUS_PROGRESS[task.status] : agent.status === 'completed' ? 1 : 0,
    step,
    task: task ?? null,
  }
}

/** Collision-free station index per agent.
 * `stations[id % n]` alone parks two people in the same chair as soon as a department's cohort
 * wraps — guaranteed with the twelve seeded agents against rooms of two to six desks. Each room's
 * cohort is walked in id order and handed consecutive anchors starting at the first member's
 * natural slot, so seats stay put while the roster is unchanged and never double-book. */
export function stationSlots(agents: Agent[]): Record<number, number> {
  const cohorts = new Map<string, Agent[]>()
  for (const a of agents) {
    const p = poseFor(a)
    const room = p.targetRoom ?? p.homeRoom
    const list = cohorts.get(room.id)
    if (list) list.push(a)
    else cohorts.set(room.id, [a])
  }
  const out: Record<number, number> = {}
  for (const [id, cohort] of cohorts) {
    const count = ROOMS[id].stations.length
    const sorted = [...cohort].sort((x, y) => x.id - y.id)
    const base = sorted[0].id % count
    sorted.forEach((a, k) => { out[a.id] = (base + k) % count })
  }
  return out
}

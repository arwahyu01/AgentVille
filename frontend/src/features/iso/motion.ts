/** Renderer-independent movement for one person in the 2D office.
 *
 *  It mirrors the 3D `AgentFigure` rules exactly: the goal comes from backend state through
 *  `poseFor` (home desk, or a target room set by an assignment/handoff/meeting event), a local
 *  social cue may override only the visual goal, and a route is rebuilt only when that goal
 *  changes. Kept free of Pixi so it can be unit-tested. */
import { poseFor, routeTo, type MotionKind } from '../../lib/activity'
import {
  OPERATIONAL_ROLES, figureAt, roomAt, roomById, seatAt, stationInRoom, type Room,
} from '../../lib/officeLayout'
import { socialRoute, type SocialCue } from '../office/socialScript'
import type { Agent } from '../../types'

export interface MotionGoal {
  /** Changes only when the destination changes; a new key rebuilds the route. */
  key: string
  room: Room
  point: [number, number]
  facing: number
  seated: boolean
  social: boolean
  kind: MotionKind
}

export interface MotionState {
  x: number
  z: number
  facing: number
  route: [number, number][]
  key: string
  /** 0 standing … 1 seated. */
  sit: number
  /** Free-running animation phase (walk cycle, breathing, typing). */
  phase: number
  moving: boolean
}

export const WALK_SPEED = 2.0

export function goalFor(agent: Agent, slot: number, social?: SocialCue | null): MotionGoal {
  const pose = poseFor(agent)
  const base = pose.targetRoom ?? pose.homeRoom
  const staff = OPERATIONAL_ROLES.has(agent.role)
  // Simulation staff never take a colleague's chair: they stand at the station anchor.
  const stand = figureAt(base, slot)
  const seat = staff ? { ...stand, seated: false } : seatAt(base, slot)
  if (social) {
    const dx = social.faceTarget[0] - social.destination[0]
    const dz = social.faceTarget[1] - social.destination[1]
    const facing = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : seat.facing
    const [px, pz] = social.destination
    return {
      key: `social:${social.id}:${social.role}:${px.toFixed(2)},${pz.toFixed(2)}:${social.seated ? 1 : 0}`,
      room: roomById(social.roomId),
      point: [px, pz],
      facing,
      seated: social.seated,
      social: true,
      kind: pose.kind,
    }
  }
  return {
    key: `${base.id}:${stationInRoom(base, slot).join(',')}:${seat.seated ? 1 : 0}`,
    room: base,
    point: [seat.x, seat.z],
    facing: seat.facing,
    seated: seat.seated,
    social: false,
    kind: pose.kind,
  }
}

/** A person appears parked at its goal on first sight, exactly like the 3D scene. */
export function initialMotion(goal: MotionGoal, seed: number): MotionState {
  return {
    x: goal.point[0],
    z: goal.point[1],
    facing: goal.facing,
    route: [],
    key: goal.key,
    sit: goal.seated && goal.kind !== 'travel' ? 1 : 0,
    phase: seed * 1.7,
    moving: false,
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Shortest signed turn from `a` to `b`, so a figure never spins the long way round. */
function turn(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * k
}

/** Advance one frame. `dt` is in seconds and clamped so a background tab never teleports anyone. */
export function stepMotion(s: MotionState, goal: MotionGoal, dt: number): void {
  if (s.key !== goal.key) {
    const here = roomAt(s.x, s.z)
    s.route = goal.social
      ? socialRoute(here, goal.room, goal.point, [s.x, s.z])
      : routeTo(here, goal.room, goal.point, [s.x, s.z])
    s.key = goal.key
  }
  const step = Math.min(dt, 0.05)
  let moving = false
  if (s.route.length > 0) {
    const [wx, wz] = s.route[0]
    const dx = wx - s.x
    const dz = wz - s.z
    const dist = Math.hypot(dx, dz)
    moving = true
    if (dist < 0.07) s.route.shift()
    else {
      const travel = Math.min(WALK_SPEED * step, dist)
      s.x += (dx / dist) * travel
      s.z += (dz / dist) * travel
      s.facing = Math.atan2(dx, dz)
    }
  } else {
    const err = Math.hypot(goal.point[0] - s.x, goal.point[1] - s.z)
    s.x = lerp(s.x, goal.point[0], clamp01(step * 5))
    s.z = lerp(s.z, goal.point[1], clamp01(step * 5))
    moving = err > 0.04
  }
  s.moving = moving
  s.sit = lerp(s.sit, goal.seated && !moving ? 1 : 0, clamp01(step * 4))
  s.phase += (moving ? 8.5 : goal.social ? 1.6 : goal.kind === 'work' ? 4.6 : 1.1) * step
  if (!moving) s.facing = turn(s.facing, goal.facing, clamp01(step * 3))
}

/** Short tag under a name, like a ticket code: the open task id when the agent carries one,
 *  otherwise a role abbreviation. Never invented: both come from backend rows. */
export const ROLE_TAG: Record<string, string> = {
  'AI Coordinator': 'COORD',
  'Frontend Developer': 'FE',
  'Backend Developer': 'BE',
  Developer: 'DEV',
  'QA Engineer': 'QA',
  'Data Analyst': 'DATA',
  Researcher: 'RISET',
  'Product Analyst': 'PA',
  'UI/UX Designer': 'UX',
  'Content Creator': 'KONTEN',
  Administrator: 'ADMIN',
  Reviewer: 'QC',
  Housekeeping: 'OB',
  Security: 'SATPAM',
}

export function agentTag(agent: Agent, taskId?: number | null): string {
  if (taskId != null) return `T-${taskId}`
  return ROLE_TAG[agent.role] ?? agent.role.slice(0, 5).toUpperCase()
}

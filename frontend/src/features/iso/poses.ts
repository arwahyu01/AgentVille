/** Which gesture a figure makes, decided from real state. Pure, so it is tested without Pixi.
 *
 *  Every gesture has a cause the backend (or a Claude session hook) actually reported: the
 *  Coordinator presents while a plan waits in the meeting room, a finished worker sips coffee on
 *  break, a session waiting for permission raises a hand, a fresh read/search action reads. With
 *  none of those the figure keeps the plain pose its status gives it. */
import { ROOMS } from '../../lib/officeLayout'
import type { Agent } from '../../types'
import type { ActionKind } from './actions'
import type { MotionGoal } from './motion'

export type Gesture = 'none' | 'wave' | 'point' | 'sip' | 'read'

export interface PoseContext {
  moving: boolean
  /** Sitting at a desk right now. */
  seated: boolean
  presenting: boolean
  onBreak: boolean
  /** Asks to be noticed: a Claude session waiting on the user, or a fresh greeting. */
  attention: boolean
  /** Newest fresh per-tool action, if any. */
  action: ActionKind | null
  typing: boolean
}

export function gestureFor(c: PoseContext): Gesture {
  if (c.moving) return 'none'
  if (c.presenting) return 'point'
  if (c.attention) return 'wave'
  if (c.typing) return 'none'
  if (c.onBreak) return 'sip'
  if (c.seated && (c.action === 'read' || c.action === 'search' || c.action === 'think')) return 'read'
  return 'none'
}

/** Beside the meeting-room screen (west wall), clear of the table and every chair. */
export const PRESENTER_SPOT: [number, number] = [4.3, 4.45]

/** The Coordinator stands up and presents while it is called into the meeting room, which the
 *  backend does when a plan waits for approval. Everyone else stays in their seat. */
export function isPresenter(agent: Pick<Agent, 'role' | 'target_room'>, goal: MotionGoal): boolean {
  return agent.role === 'AI Coordinator' && agent.target_room === 'meeting'
    && goal.room.id === 'meeting' && !goal.social
}

export function presenterGoal(): MotionGoal {
  return {
    key: 'present:meeting',
    room: ROOMS.meeting,
    point: PRESENTER_SPOT,
    // Faces the audience (+x) with the screen behind: the pointing arm reaches back to it.
    facing: Math.PI / 2,
    seated: false,
    social: false,
    kind: 'meeting',
  }
}

/** Goals that mean "taking a break" (AgentVille agents and Claude sessions). */
export function isBreakGoal(goal: Pick<MotionGoal, 'key'>): boolean {
  return goal.key.startsWith('break:') || goal.key.startsWith('claude:break:')
}

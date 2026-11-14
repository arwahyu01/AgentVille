/** What a journal `action_*` frame looks like in the office. Pure, so it is tested without Pixi.
 *
 *  The backend emits one frame per observed tool call (`action_read`, `action_write`, `action_run`,
 *  `action_search`, `action_think`) with a short redacted line in `message`. Nothing here invents
 *  an action: with no fresh frame the function returns null and the figure just does what its
 *  status says. */
import { parseUtc } from '../../lib/activity'
import type { StreamEvent } from '../../types'

export type ActionKind = 'read' | 'write' | 'run' | 'search' | 'think'

export const ACTION_KINDS: readonly ActionKind[] = ['read', 'write', 'run', 'search', 'think']
/** A frame keeps its bubble and its screen colour this long after it arrived. */
export const ACTION_FRESH_S = 14

export interface ActionView {
  kind: ActionKind
  /** The redacted one-liner from the backend, e.g. "Edit App.tsx". */
  label: string
  /** Hands on the keyboard: writing and running type, reading/searching/thinking do not. */
  typing: boolean
  /** Desk-screen tint while this is the freshest thing the agent did. */
  screen: number
}

const SCREEN: Record<ActionKind, number> = {
  write: 0x86eadb,
  run: 0x8ef0a0,
  read: 0x9cc7ef,
  search: 0xf3d98a,
  think: 0xc9bcf2,
}

export function actionKindOf(type: string): ActionKind | null {
  if (!type.startsWith('action_')) return null
  const kind = type.slice('action_'.length)
  return (ACTION_KINDS as readonly string[]).includes(kind) ? (kind as ActionKind) : null
}

export function isActionEvent(event: Pick<StreamEvent, 'type'>): boolean {
  return actionKindOf(event.type) !== null
}

/** The view for a frame, or null when it is not an action frame or has gone stale. */
export function actionFor(event: StreamEvent | undefined, now: number = Date.now()): ActionView | null {
  if (!event) return null
  const kind = actionKindOf(event.type)
  if (!kind) return null
  const at = event.createdAt ? parseUtc(event.createdAt) : NaN
  if (!Number.isFinite(at) || (now - at) / 1000 > ACTION_FRESH_S) return null
  return {
    kind,
    label: event.message.trim(),
    typing: kind === 'write' || kind === 'run',
    screen: SCREEN[kind],
  }
}

/** Keep only the newest action frame per agent: the live list never grows with the run. */
export function latestActionByAgent(
  current: Record<number, StreamEvent>, event: StreamEvent,
): Record<number, StreamEvent> {
  if (event.agentId == null || !isActionEvent(event)) return current
  const known = current[event.agentId]
  if (known && known.id >= event.id) return current
  return { ...current, [event.agentId]: event }
}

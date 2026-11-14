import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '../../types'
import { ACTION_FRESH_S, actionFor, actionKindOf, isActionEvent, latestActionByAgent } from './actions'

const NOW = Date.parse('2026-11-14T10:00:00Z')

const frame = (over: Partial<StreamEvent> = {}): StreamEvent => ({
  kind: 'task', id: 10, taskId: 1, type: 'action_write', message: 'Edit App.tsx', conversationId: 1,
  agentId: 3, provider: 'claude', model: 'sonnet', stepIndex: 1,
  createdAt: new Date(NOW - 2_000).toISOString(), ...over,
})

describe('actionFor', () => {
  it('turns a fresh frame into a label, a typing flag and a screen colour', () => {
    const v = actionFor(frame(), NOW)
    expect(v).toMatchObject({ kind: 'write', label: 'Edit App.tsx', typing: true })
    expect(actionFor(frame({ type: 'action_run', message: 'Terminal: tests' }), NOW)?.typing).toBe(true)
    for (const type of ['action_read', 'action_search', 'action_think']) {
      expect(actionFor(frame({ type }), NOW)?.typing).toBe(false)
    }
  })

  it('gives every kind its own screen colour', () => {
    const colours = ['write', 'run', 'read', 'search', 'think'].map((k) => actionFor(frame({ type: `action_${k}` }), NOW)!.screen)
    expect(new Set(colours).size).toBe(5)
  })

  it('returns null for stale frames, other event types and unknown kinds', () => {
    expect(actionFor(frame({ createdAt: new Date(NOW - (ACTION_FRESH_S + 1) * 1000).toISOString() }), NOW)).toBeNull()
    expect(actionFor(frame({ type: 'step_started' }), NOW)).toBeNull()
    expect(actionFor(frame({ type: 'action_teleport' }), NOW)).toBeNull()
    expect(actionFor(frame({ createdAt: null }), NOW)).toBeNull()
    expect(actionFor(undefined, NOW)).toBeNull()
  })

  it('reads the backend timestamp as UTC even without a zone suffix', () => {
    const naive = new Date(NOW - 3_000).toISOString().replace('Z', '')
    expect(actionFor(frame({ createdAt: naive }), NOW)).not.toBeNull()
  })
})

describe('action frame bookkeeping', () => {
  it('recognises action types', () => {
    expect(actionKindOf('action_read')).toBe('read')
    expect(actionKindOf('step_started')).toBeNull()
    expect(isActionEvent({ type: 'action_run' })).toBe(true)
  })

  it('keeps one newest frame per agent and ignores everything else', () => {
    let map = latestActionByAgent({}, frame({ id: 5, agentId: 3 }))
    map = latestActionByAgent(map, frame({ id: 9, agentId: 3, message: 'Baca x.py', type: 'action_read' }))
    map = latestActionByAgent(map, frame({ id: 7, agentId: 3 })) // older, arrives late
    expect(Object.keys(map)).toEqual(['3'])
    expect(map[3].id).toBe(9)
    expect(latestActionByAgent(map, frame({ id: 99, type: 'step_started' }))).toBe(map)
    expect(latestActionByAgent(map, frame({ id: 99, agentId: null }))).toBe(map)
  })
})

import { describe, expect, it } from 'vitest'
import { ROOMS, roomAt } from '../../lib/officeLayout'
import type { MotionGoal } from './motion'
import { PRESENTER_SPOT, gestureFor, isBreakGoal, isPresenter, presenterGoal, type PoseContext } from './poses'

const ctx = (over: Partial<PoseContext> = {}): PoseContext => ({
  moving: false, seated: false, presenting: false, onBreak: false, attention: false, action: null, typing: false, ...over,
})

describe('gestureFor', () => {
  it('walking never gestures', () => {
    expect(gestureFor(ctx({ moving: true, presenting: true, attention: true, onBreak: true }))).toBe('none')
  })

  it('has one clear cause per gesture', () => {
    expect(gestureFor(ctx({ presenting: true }))).toBe('point')
    expect(gestureFor(ctx({ attention: true }))).toBe('wave')
    expect(gestureFor(ctx({ onBreak: true }))).toBe('sip')
    expect(gestureFor(ctx({ seated: true, action: 'read' }))).toBe('read')
    expect(gestureFor(ctx({ seated: true, action: 'search' }))).toBe('read')
    expect(gestureFor(ctx())).toBe('none')
  })

  it('keeps priorities: presenting > attention > typing > break > reading', () => {
    expect(gestureFor(ctx({ presenting: true, attention: true }))).toBe('point')
    expect(gestureFor(ctx({ attention: true, typing: true }))).toBe('wave')
    expect(gestureFor(ctx({ typing: true, onBreak: true }))).toBe('none')
    expect(gestureFor(ctx({ onBreak: true, seated: true, action: 'read' }))).toBe('sip')
  })

  it('does not read while standing, and writing or running is not reading', () => {
    expect(gestureFor(ctx({ seated: false, action: 'read' }))).toBe('none')
    expect(gestureFor(ctx({ seated: true, action: 'write' }))).toBe('none')
    expect(gestureFor(ctx({ seated: true, action: 'run' }))).toBe('none')
  })
})

describe('presenter', () => {
  const meeting = (over: Partial<MotionGoal> = {}): MotionGoal => ({
    key: 'k', room: ROOMS.meeting, point: [6, 5], facing: 0, seated: true, social: false, kind: 'meeting', ...over,
  })

  it('is the Coordinator called into the meeting room, and nobody else', () => {
    expect(isPresenter({ role: 'AI Coordinator', target_room: 'meeting' }, meeting())).toBe(true)
    expect(isPresenter({ role: 'Developer', target_room: 'meeting' }, meeting())).toBe(false)
    expect(isPresenter({ role: 'AI Coordinator', target_room: '' }, meeting())).toBe(false)
    expect(isPresenter({ role: 'AI Coordinator', target_room: 'meeting' }, meeting({ room: ROOMS.admin }))).toBe(false)
    expect(isPresenter({ role: 'AI Coordinator', target_room: 'meeting' }, meeting({ social: true }))).toBe(false)
  })

  it('stands inside the meeting room, clear of the table and every chair', () => {
    const [x, z] = PRESENTER_SPOT
    expect(roomAt(x, z).id).toBe('meeting')
    expect(presenterGoal().seated).toBe(false)
    expect(x).toBeLessThan(4.9) // left of the table (x 4.9–7.5)
    for (const [cx, cz] of ROOMS.meeting.stations) expect(Math.hypot(x - cx, z - cz)).toBeGreaterThan(0.9)
  })
})

describe('break goals', () => {
  it('recognises agent and Claude-session breaks', () => {
    expect(isBreakGoal({ key: 'break:3' })).toBe(true)
    expect(isBreakGoal({ key: 'claude:break:0' })).toBe(true)
    expect(isBreakGoal({ key: 'dev:1,2:1' })).toBe(false)
    expect(isBreakGoal({ key: 'claude:dev:1:1' })).toBe(false)
  })
})

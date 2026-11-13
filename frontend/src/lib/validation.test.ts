import { describe, expect, it } from 'vitest'
import { firstIssue, taskFormSchema } from './validation'

describe('taskFormSchema', () => {
  it('accepts a valid task form', () => {
    const result = taskFormSchema.safeParse({ title: 'Analyze sales', description: 'CSV report', priority: 'high' })
    expect(result.success).toBe(true)
  })

  it('trims title and description', () => {
    const result = taskFormSchema.parse({ title: '  Ship  ', description: '  details  ', priority: 'normal' })
    expect(result.title).toBe('Ship')
    expect(result.description).toBe('details')
  })

  it('rejects a blank title', () => {
    const result = taskFormSchema.safeParse({ title: '   ', description: '', priority: 'normal' })
    expect(result.success).toBe(false)
  })

  it('rejects titles longer than 160 characters', () => {
    const result = taskFormSchema.safeParse({ title: 'x'.repeat(161), description: '', priority: 'normal' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown priority values', () => {
    const result = taskFormSchema.safeParse({ title: 'ok', description: '', priority: 'urgent' })
    expect(result.success).toBe(false)
  })
})

describe('firstIssue', () => {
  it('returns the first validation message', () => {
    const result = taskFormSchema.safeParse({ title: '', description: '', priority: 'normal' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(firstIssue(result.error)).toBe('Title is required')
    }
  })
})

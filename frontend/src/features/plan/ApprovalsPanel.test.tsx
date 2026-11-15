import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ApprovalsPanel, { approvalItems } from './ApprovalsPanel'
import { api } from '../../lib/api'
import type { Conversation } from '../../types'

const conv = (status: Conversation['status']): Conversation =>
  ({ id: 7, title: 'Kampanye kopi', status, current_plan_version: 1 }) as Conversation

describe('final acceptance gate', () => {
  it('lists a conversation waiting for acceptance and a plan waiting for approval', () => {
    expect(approvalItems([], [conv('awaiting_acceptance')]).map((i) => i.kind)).toEqual(['accept'])
    expect(approvalItems([], [conv('awaiting_approval')]).map((i) => i.kind)).toEqual(['plan'])
    expect(approvalItems([], [conv('running')])).toEqual([])
  })

  it('accepts the result through the API', async () => {
    const accept = vi.spyOn(api, 'acceptResult').mockResolvedValue(conv('completed'))
    const onAction = vi.fn()
    render(<ApprovalsPanel tasks={[]} conversations={[conv('awaiting_acceptance')]} agents={[]}
                           onAction={onAction} onError={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Terima hasil/ }))
    await waitFor(() => expect(accept).toHaveBeenCalledWith(7))
    await waitFor(() => expect(onAction).toHaveBeenCalled())
  })
})

describe('resume a failed request', () => {
  it('offers Lanjutkan on a failed run and calls the resume endpoint', async () => {
    const resume = vi.spyOn(api, 'resumeTask').mockResolvedValue({} as never)
    const task = { id: 13, title: 'Riset', status: 'failed', parent_id: null, plan_step_index: null } as never
    render(<ApprovalsPanel tasks={[task]} conversations={[]} agents={[]} onAction={() => {}} onError={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Lanjutkan/ }))
    await waitFor(() => expect(resume).toHaveBeenCalledWith(13))
  })
})

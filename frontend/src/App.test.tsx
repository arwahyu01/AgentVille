import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import type { Agent, Conversation, Task, TaskEvent, TeamEvent } from './types'

vi.mock('./features/office/OfficeScene', () => ({
  default: () => <div data-testid="office-scene" />,
}))

const agents: Agent[] = [
  { id: 1, name: 'Atlas', role: 'AI Coordinator', status: 'idle', position_x: -4.2, position_z: -0.25 },
  { id: 2, name: 'Byte', role: 'Developer', status: 'working', position_x: -1.4, position_z: -0.25 },
]

const tasks: Task[] = [
  { id: 10, title: 'Prepare sprint report', description: 'Summarise progress', status: 'running', priority: 'high', agent_id: 2, parent_id: null, run_mode: 'manual', artifact_path: '', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T02:00:00Z' },
  { id: 11, title: 'Draft release notes', description: '', status: 'pending', priority: 'normal', agent_id: null, parent_id: null, run_mode: 'manual', artifact_path: '', created_at: '2026-10-24T01:30:00Z', updated_at: '2026-10-24T01:30:00Z' },
  { id: 12, title: 'AI finished job', description: '', status: 'completed', priority: 'normal', agent_id: 1, parent_id: null, run_mode: 'ai', artifact_path: 'data/artifacts/task-12.md', created_at: '2026-10-24T01:30:00Z', updated_at: '2026-10-24T02:30:00Z' },
]

const events: TaskEvent[] = [
  { id: 1, task_id: 10, event_type: 'created', message: 'Task created', created_at: '2026-10-24T01:00:00Z' },
  { id: 2, task_id: 10, event_type: 'status_changed', message: 'Status changed: queued -> running', created_at: '2026-10-24T02:00:00Z' },
]

const teamEvents: TeamEvent[] = [
  { id: 1, task_id: 10, task_title: 'Q4 numbers rundown', event_type: 'step_started', message: 'Byte started on step 1', created_at: '2026-10-24T02:00:00Z', agent_id: 2, agent_name: 'Byte', agent_role: 'Developer', step_index: 0, provider: null, model: null },
]

const conversations: Conversation[] = [
  { id: 7, channel: 'web', user_identity: 'local', title: 'Weekly numbers report', anchor_task_id: 20, current_plan_version: 1, status: 'awaiting_approval', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T02:00:00Z' },
  { id: 8, channel: 'web', user_identity: 'local', title: 'Need a plan', anchor_task_id: 21, current_plan_version: 0, status: 'clarifying', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T01:00:00Z' },
]

const planInfo = {
  current: {
    id: 3, conversation_id: 7, version: 1, status: 'proposed', summary: 'two steps', created_at: '2026-10-24T02:00:00Z',
    steps: [
      { title: 'Investigate', instruction: 'dig in', agent_role: 'Researcher', depends_on: [], required: true, acceptance_criteria: ['notes'], uses_tools: false },
      { title: 'Summarise', instruction: 'write it', agent_role: 'Administrator', depends_on: [0], required: true, acceptance_criteria: [], uses_tools: false },
    ],
  },
  history: [],
}

const aiConfig = {
  ai_enabled: false, ai_model: 'opencode/big-pickle', ai_timeout_s: 300,
  provider: 'opencode', ai_model_qoder: 'Efficient', fallback_enabled: false, retry_max: 1,
  providers: { opencode: { available: true, reason: null, coding: false }, qoder: { available: true, reason: null, coding: true } },
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners: Record<string, Array<(ev?: unknown) => void>> = {}
  url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (ev?: unknown) => void) {
    (this.listeners[type] ??= []).push(cb)
  }
  close() {}
  emit(type: string, data?: string) {
    for (const cb of this.listeners[type] ?? []) cb(data === undefined ? {} : { data })
  }
}

let aiEnabled = false

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  cleanup()
  aiEnabled = false
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'POST' && /\/api\/conversations\/\d+\/(approve|revise|cancel|messages)$/.test(url)) {
      return jsonResponse({ ok: true, url })
    }
    if (url.includes('/api/events/team')) return jsonResponse(teamEvents)
    if (url.includes('/events') && !url.includes('/stream')) return jsonResponse(events)
    if (url.endsWith('/api/agents')) return jsonResponse(agents)
    if (url.endsWith('/api/tasks')) return jsonResponse(tasks)
    if (url.endsWith('/api/conversations')) return jsonResponse(conversations)
    if (/\/api\/conversations\/\d+\/messages$/.test(url)) return jsonResponse([{ id: 1, conversation_id: 7, role: 'user', content: 'make the report', channel: 'web', created_at: '2026-10-24T01:00:00Z' }])
    if (/\/api\/conversations\/\d+\/plan$/.test(url)) return jsonResponse(url.includes('/7') ? planInfo : { current: null, history: [] })
    if (url.endsWith('/api/channels/status')) return jsonResponse({ telegram: { configured: false, reason: 'TELEGRAM_BOT_TOKEN is not set', running: false, allowed_chats: 0 } })
    if (url.endsWith('/api/ai/config')) return jsonResponse({ ...aiConfig, ai_enabled: aiEnabled })
    if (url.includes('/api/ai/models')) return jsonResponse({ models: ['opencode/big-pickle', 'opencode/glm-5.3-flash-free'] })
    if (url.endsWith('/result')) return jsonResponse({ ...tasks[2], result: 'THE FINAL ANSWER', children: [{ ...tasks[2], id: 13, title: 'sub step', parent_id: 12, provider_used: 'qoder', model_used: 'Efficient' }], plan_steps: [], qc_reviews: [], diff_path: '' })
    if (url.endsWith('/execute')) return jsonResponse({ ...tasks[1], status: 'queued', run_mode: 'ai' })
    return new Response('{"detail":"Not Found"}', { status: 404 })
  }))
})

describe('App', () => {
  it('renders office and live backend data', async () => {
    render(<App />)
    expect(screen.getByTestId('office-scene')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('API Connected')).toBeInTheDocument())
    expect(screen.getByText('Prepare sprint report')).toBeInTheDocument()
    expect(screen.getByText('Draft release notes')).toBeInTheDocument()
  })

  it('shows task detail with activity history when a task is clicked', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Prepare sprint report'))
    fireEvent.click(screen.getByText('Prepare sprint report'))
    expect(screen.getByText('Task details')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Status changed: queued -> running')).toBeInTheDocument())
    expect(screen.getByText('Activity history')).toBeInTheDocument()
  })

  it('validates the create form with zod before calling the API', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('API Connected'))
    fireEvent.click(screen.getByRole('button', { name: /new task/i }))
    fireEvent.click(await screen.findByRole('button', { name: /create task/i }))
    expect(await screen.findByText('Title is required')).toBeInTheDocument()
    const postCalls = vi.mocked(fetch).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
    expect(postCalls).toHaveLength(0)
  })

  it('filters tasks by status', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('Draft release notes'))
    fireEvent.change(screen.getByLabelText('Filter task status'), { target: { value: 'running' } })
    expect(screen.getByText('Prepare sprint report')).toBeInTheDocument()
    expect(screen.queryByText('Draft release notes')).not.toBeInTheDocument()
  })

  it('shows the Team Conversation panel with persisted journal messages', async () => {
    render(<App />)
    const panel = await screen.findByTestId('team-conversation')
    expect(screen.getByText('Team Conversation')).toBeInTheDocument()
    await within(panel).findByText('Byte started on step 1')
    expect(within(panel).getByText('Byte')).toBeInTheDocument()
    expect(within(panel).getByText('Developer')).toBeInTheDocument()
    expect(within(panel).getByText('Q4 numbers rundown')).toBeInTheDocument()
    expect(within(panel).getByText('step 0')).toBeInTheDocument()
  })

  it('appends live task events to the Team Conversation panel', async () => {
    render(<App />)
    const panel = await screen.findByTestId('team-conversation')
    // agents/tasks must be loaded before the frame arrives, or the name lookup misses
    await within(panel).findByText('Byte started on step 1')
    FakeEventSource.instances[0].emit('task_event', JSON.stringify({
      id: 55, taskId: 10, type: 'step_completed', message: 'Coordinator drafted the outline',
      conversationId: null, agentId: 1, provider: null, model: null, stepIndex: 2, createdAt: '2026-10-24T03:00:00Z',
    }))
    expect(await within(panel).findByText('Coordinator drafted the outline')).toBeInTheDocument()
    expect(within(panel).getByText('Atlas')).toBeInTheDocument()
    expect(within(panel).getByText('AI Coordinator')).toBeInTheDocument()
    expect(within(panel).getByText('step 2')).toBeInTheDocument()
  })

  it('renders the AI engine bar and patches config when toggled', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('AI Engine'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI enabled' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) =>
        String(c[0]).endsWith('/api/ai/config') && (c[1] as RequestInit | undefined)?.method === 'PATCH')
      expect(call).toBeDefined()
    })
  })

  it('shows AI run buttons when the engine is enabled and posts to /execute', async () => {
    aiEnabled = true
    render(<App />)
    await waitFor(() => screen.getByLabelText('AI model'))
    fireEvent.click(screen.getByText('Draft release notes'))
    fireEvent.click(await screen.findByRole('button', { name: /run with ai/i }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).endsWith('/api/tasks/11/execute'))
      expect(call).toBeDefined()
      expect((call![1] as RequestInit).method).toBe('POST')
      expect((call![1] as RequestInit).body).toContain('direct')
    })
  })

  it('hides AI run buttons while the engine is off', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('AI Engine'))
    fireEvent.click(screen.getByText('Draft release notes'))
    await waitFor(() => screen.getByText('Task details'))
    expect(screen.queryByRole('button', { name: /run with ai/i })).not.toBeInTheDocument()
  })

  it('opens the AI result modal with subtasks and output', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('AI finished job'))
    fireEvent.click(screen.getByText('AI finished job'))
    fireEvent.click(await screen.findByRole('button', { name: /open result/i }))
    expect(await screen.findByText('THE FINAL ANSWER')).toBeInTheDocument()
    expect(screen.getByText('sub step')).toBeInTheDocument()
    expect(screen.getByText(/data\/artifacts\/task-12\.md/)).toBeInTheDocument()
  })

  it('names the provider and model that actually ran each subtask', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('AI finished job'))
    fireEvent.click(screen.getByText('AI finished job'))
    fireEvent.click(await screen.findByRole('button', { name: /open result/i }))
    expect(await screen.findByText('sub step')).toBeInTheDocument()
    expect(screen.getByText('qoder')).toBeInTheDocument()
    expect(screen.getByText('Efficient')).toBeInTheDocument()
  })
})

describe('Requests view', () => {
  async function openRequests() {
    render(<App />)
    await waitFor(() => screen.getByText('API Connected'))
    fireEvent.click(screen.getByRole('button', { name: /requests/i }))
    await waitFor(() => expect(screen.getByTestId('chat-panel')).toBeInTheDocument())
  }

  it('lists conversations and shows the chat transcript', async () => {
    await openRequests()
    expect(screen.getByText('Weekly numbers report')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Weekly numbers report'))
    expect(await screen.findByText('make the report')).toBeInTheDocument()
    expect(screen.getByText(/two steps/)).toBeInTheDocument()
  })

  it('gates approval on the awaiting_approval state', async () => {
    await openRequests()
    fireEvent.click(screen.getByText('Weekly numbers report'))
    const approve = await screen.findByRole('button', { name: /approve v1/i })
    expect(approve).toBeEnabled()
    fireEvent.click(approve)
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).endsWith('/api/conversations/7/approve'))
      expect(call).toBeDefined()
      expect((call![1] as RequestInit).body).toContain('plan_version')
    })
    fireEvent.click(screen.getByText('Need a plan'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /approve v1/i })).not.toBeInTheDocument())
    expect(screen.getByText(/Coordinator is still clarifying/)).toBeInTheDocument()
  })

  it('sends chat messages only while clarifying', async () => {
    await openRequests()
    fireEvent.click(screen.getByText('Need a plan'))
    const input = await screen.findByLabelText('Message')
    expect(input).toBeEnabled()
    fireEvent.change(input, { target: { value: 'revenue figures please' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) =>
        String(c[0]).endsWith('/api/conversations/8/messages') && (c[1] as RequestInit | undefined)?.method === 'POST')
      expect(call).toBeDefined()
      expect((call![1] as RequestInit).body).toContain('revenue figures please')
    })
    fireEvent.click(screen.getByText('Weekly numbers report'))
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeDisabled())
  })

  it('surfaces the telegram configuration state', async () => {
    await openRequests()
    expect(await screen.findByText(/Telegram channel not active/)).toBeInTheDocument()
  })

  it('appends realtime journal frames from the event stream', async () => {
    await openRequests()
    const source = FakeEventSource.instances[0]
    expect(source.url).toContain('/api/events/stream')
    source.emit('open')
    expect(await screen.findByText(/journal streaming/)).toBeInTheDocument()
    source.emit('task_event', JSON.stringify({
      id: 99, taskId: 10, type: 'step_completed', message: 'Step 0 done in 1.2s',
      conversationId: null, agentId: 2, provider: 'qoder', model: 'Efficient', stepIndex: 0, createdAt: '2026-10-24T03:00:00Z',
    }))
    expect(await screen.findByText('Step 0 done in 1.2s')).toBeInTheDocument()
    expect(screen.getByText('qoder')).toBeInTheDocument()
    expect(screen.getByText('Efficient')).toBeInTheDocument()
    expect(screen.getByText('step 0')).toBeInTheDocument()
  })

  it('renders office simulation frames on the same stream', async () => {
    await openRequests()
    const source = FakeEventSource.instances[0]
    source.emit('office_event', JSON.stringify({
      id: 3, kind: undefined, type: 'patrol_checkpoint_reached', message: 'Sentra reached the lobby checkpoint',
      actorAgentId: 14, actorName: 'Sentra', fromRoom: null, toRoom: 'lobby', area: 'lobby',
      status: 'working', createdAt: '2026-10-24T03:05:00Z',
    }))
    expect(await screen.findByText('Sentra reached the lobby checkpoint')).toBeInTheDocument()
    expect(screen.getByText('patrol_checkpoint_reached')).toBeInTheDocument()
  })
})

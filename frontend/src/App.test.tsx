import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import type { Agent, Conversation, StreamEvent, Task, TaskEvent, TeamEvent } from './types'

vi.mock('./features/office/OfficeScene', () => ({
  default: ({ selectedId, onSelect }: { selectedId: number | null; onSelect: (id: number | null) => void }) => (
    <div data-testid="office-scene" data-selected={selectedId ?? ''}>
      <button onClick={() => onSelect(2)}>pilih agen</button>
      <button onClick={() => onSelect(null)}>tutup dialog</button>
    </div>
  ),
}))

const agents: Agent[] = [
  { id: 1, name: 'Atlas', role: 'AI Coordinator', status: 'idle', position_x: -4.2, position_z: -0.25 },
  { id: 2, name: 'Byte', role: 'Developer', status: 'working', position_x: -1.4, position_z: -0.25 },
]

const tasks: Task[] = [
  { id: 10, title: 'Prepare sprint report', description: 'Summarise progress', status: 'running', priority: 'high', agent_id: 2, parent_id: null, run_mode: 'manual', artifact_path: '', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T02:00:00Z' },
  { id: 11, title: 'Draft release notes', description: '', status: 'pending', priority: 'normal', agent_id: null, parent_id: null, run_mode: 'manual', artifact_path: '', created_at: '2026-10-24T01:30:00Z', updated_at: '2026-10-24T01:30:00Z' },
  { id: 12, title: 'AI finished job', description: '', status: 'completed', priority: 'normal', agent_id: 2, parent_id: null, run_mode: 'manual', artifact_path: 'data/artifacts/task-12.md', created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T03:00:00Z' },
  { id: 20, title: 'Weekly numbers report', description: '', status: 'running', priority: 'normal', agent_id: 2, parent_id: null, conversation_id: 7, run_mode: 'conversation', artifact_path: '', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T02:00:00Z', plan_step_index: null },
  { id: 21, title: 'Need a plan', description: '', status: 'clarifying', priority: 'normal', agent_id: 1, parent_id: null, conversation_id: 8, run_mode: 'conversation', artifact_path: '', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T01:00:00Z', plan_step_index: null },
  { id: 22, title: 'Investigate', description: '', status: 'completed', priority: 'normal', agent_id: 2, parent_id: 20, run_mode: 'conversation', artifact_path: '', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T02:00:00Z', plan_step_index: 0 },
  { id: 23, title: 'Summarise', description: '', status: 'running', priority: 'normal', agent_id: 2, parent_id: 20, run_mode: 'conversation', artifact_path: '', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T02:00:00Z', plan_step_index: 1 },
  { id: 30, title: 'Brand poster', description: '', status: 'completed', priority: 'normal', agent_id: 2, parent_id: null, run_mode: 'manual', artifact_path: '', created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-24T04:00:00Z' },
  { id: 31, title: 'Promo clip', description: '', status: 'completed', priority: 'normal', agent_id: 2, parent_id: null, run_mode: 'manual', artifact_path: '', created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-24T05:00:00Z' },
]

const events: TaskEvent[] = [
  { id: 1, task_id: 10, event_type: 'created', message: 'Task created', created_at: '2026-10-24T01:00:00Z' },
  { id: 2, task_id: 10, event_type: 'status_changed', message: 'Status changed: queued -> running', created_at: '2026-10-24T02:00:00Z' },
]

const teamEvents: TeamEvent[] = [
  { id: 1, task_id: 10, task_title: 'Q4 numbers rundown', event_type: 'step_started', message: 'Byte started on step 1', created_at: '2026-10-24T02:00:00Z', agent_id: 2, agent_name: 'Byte', agent_role: 'Developer', step_index: 0, provider: null, model: null },
]

const conversations: Conversation[] = [
  { id: 7, channel: 'web', user_identity: 'local', title: 'Weekly numbers report', anchor_task_id: 20, current_plan_version: 1, status: 'running', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T02:00:00Z' },
  { id: 8, channel: 'web', user_identity: 'local', title: 'Need a plan', anchor_task_id: 21, current_plan_version: 0, status: 'clarifying', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T01:00:00Z' },
]

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

function queueRow(title: string): HTMLElement {
  return within(screen.getByTestId('run-list')).getByText(title)
}

let aiEnabled = false
let approveRequests: string[] = []
let failedRun: Task | null = null

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const previews: Record<number, unknown> = {
  12: { kind: 'web', entry: 'landing/index.html', url: '/api/tasks/12/preview/landing/index.html', size: 1200, files: [] },
  30: { kind: 'image', entry: 'poster.png', url: '/api/tasks/30/preview/poster.png', size: 9000, files: [] },
  31: { kind: 'video', entry: 'promo.mp4', url: '/api/tasks/31/preview/promo.mp4', size: 900000, files: [] },
}

function taskById(id: number): Task {
  return tasks.find((task) => task.id === id) ?? tasks[0]
}

beforeEach(() => {
  cleanup()
  aiEnabled = false
  approveRequests = []
  failedRun = null
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/approve')) approveRequests.push(url)
    if (method === 'POST' && /\/api\/conversations\/\d+\/(approve|revise|cancel|messages)$/.test(url)) {
      return jsonResponse({ ok: true, url })
    }
    if (method === 'POST' && /\/api\/tasks\/(clear|\d+\/(stop|reassign|qc-rerun|execute))$/.test(url)) {
      return jsonResponse({ stopped: [20], count: 1 })
    }
    if (url.includes('/api/events/team')) return jsonResponse(teamEvents)
    if (url.includes('/events') && !url.includes('/stream')) return jsonResponse(events)
    if (url.endsWith('/api/agents')) return jsonResponse(agents)
    if (url.endsWith('/api/tasks')) return jsonResponse(failedRun ? [...tasks, failedRun] : tasks)
    if (url.endsWith('/api/conversations')) return jsonResponse(conversations)
    if (/\/api\/conversations\/\d+\/messages$/.test(url)) return jsonResponse([{ id: 1, conversation_id: 7, role: 'user', content: 'make the report', channel: 'web', created_at: '2026-10-24T01:00:00Z' }])
    if (/\/api\/conversations\/\d+\/plan$/.test(url)) return jsonResponse({ current: null, history: [] })
    if (url.endsWith('/api/channels/status')) return jsonResponse({ telegram: { configured: false, reason: 'TELEGRAM_BOT_TOKEN is not set', running: false, allowed_chats: 0 } })
    if (url.endsWith('/api/ai/config')) return jsonResponse({ ...aiConfig, ai_enabled: aiEnabled })
    if (url.includes('/api/ai/models')) return jsonResponse({ models: ['opencode/big-pickle', 'opencode/glm-5.3-flash-free'] })
    const result = /\/api\/tasks\/(\d+)\/result$/.exec(url)
    if (result) {
      const id = Number(result[1])
      const task = taskById(id)
      return jsonResponse({
        ...task,
        result: id === 12 ? 'THE FINAL ANSWER' : '',
        children: id === 12 ? [{ ...task, id: 13, title: 'sub step', parent_id: 12 }] : [],
        plan_steps: [], qc_reviews: [], diff_path: '',
        preview: previews[id] ?? { kind: 'none', entry: '', url: '', size: 0, files: [] },
      })
    }
    return new Response('{"detail":"Not Found"}', { status: 404 })
  }))
})

describe('one-page office', () => {
  it('renders the office, the queue and the API state on a single page', async () => {
    render(<App />)
    expect(screen.getByTestId('office-scene')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Terhubung/)).toBeInTheDocument())
    expect(screen.getByTestId('run-list')).toBeInTheDocument()
    expect(queueRow('Prepare sprint report')).toBeInTheDocument()
    expect(queueRow('Draft release notes')).toBeInTheDocument()
    // The floor is the page; results open over it only when there is something to show.
    expect(screen.getByRole('heading', { name: /^Kantor$/ })).toBeInTheDocument()
    expect(screen.queryByTestId('result-stage')).not.toBeInTheDocument()
    // The old sidebar navigation is gone — one page only.
    expect(screen.queryByRole('button', { name: /^tasks$/i })).not.toBeInTheDocument()
  })

  it('opens and closes an agent dialog from the office scene', async () => {
    render(<App />)
    const scene = await screen.findByTestId('office-scene')
    fireEvent.click(within(scene).getByText('pilih agen'))
    expect(scene).toHaveAttribute('data-selected', '2')
    fireEvent.click(within(scene).getByText('tutup dialog'))
    expect(scene).toHaveAttribute('data-selected', '')
  })

  it('shows delivery progress for a run that has delegated steps', async () => {
    render(<App />)
    await waitFor(() => queueRow('Weekly numbers report'))
    const row = queueRow('Weekly numbers report').closest('li')!
    expect(within(row).getByText(/1\/2 langkah/)).toBeInTheDocument()
    expect(within(row).getByText(/#20 · Byte/)).toBeInTheDocument()
  })

  it('puts the built website on screen when a finished job is selected', async () => {
    render(<App />)
    await waitFor(() => queueRow('AI finished job'))
    fireEvent.click(queueRow('AI finished job'))
    const stage = screen.getByTestId('result-stage')
    const frame = await within(stage).findByTitle('Hasil: AI finished job')
    expect(frame).toHaveAttribute('src', expect.stringContaining('/api/tasks/12/preview/landing/index.html'))
    expect(within(stage).getByText('WEB')).toBeInTheDocument()
    expect(within(stage).getByText(/landing\/index\.html/)).toBeInTheDocument()
  })

  it('closes the big result modal and leaves the office in place', async () => {
    render(<App />)
    await waitFor(() => queueRow('AI finished job'))
    fireEvent.click(queueRow('AI finished job'))
    const stage = await screen.findByTestId('result-stage')
    expect(screen.getByRole('dialog', { name: /Hasil: AI finished job/ })).toBeInTheDocument()
    fireEvent.click(within(stage.closest('.result-modal')! as HTMLElement).getByRole('button', { name: /Tutup hasil/i }))
    await waitFor(() => expect(screen.queryByTestId('result-stage')).not.toBeInTheDocument())
    expect(screen.getByTestId('office-scene')).toBeInTheDocument()
  })

  it('shows a produced image instead of a log', async () => {
    render(<App />)
    await waitFor(() => queueRow('Brand poster'))
    fireEvent.click(queueRow('Brand poster'))
    const stage = screen.getByTestId('result-stage')
    const image = await within(stage).findByAltText('Hasil: Brand poster')
    expect(image).toHaveAttribute('src', expect.stringContaining('/api/tasks/30/preview/poster.png'))
    expect(within(stage).getByText('GAMBAR')).toBeInTheDocument()
  })

  it('plays a produced video and links to it', async () => {
    render(<App />)
    await waitFor(() => queueRow('Promo clip'))
    fireEvent.click(queueRow('Promo clip'))
    const stage = screen.getByTestId('result-stage')
    const video = await within(stage).findByText(/Buka video/)
    expect(video).toHaveAttribute('href', expect.stringContaining('/api/tasks/31/preview/promo.mp4'))
    expect(stage.querySelector('video')).toHaveAttribute('src', expect.stringContaining('/api/tasks/31/preview/promo.mp4'))
  })

  it('keeps the office in view while the crew is still working', async () => {
    render(<App />)
    await waitFor(() => queueRow('Prepare sprint report'))
    fireEvent.click(queueRow('Prepare sprint report'))
    const row = queueRow('Prepare sprint report').closest('li')!
    expect(within(row).getByText('Dikerjakan')).toBeInTheDocument()
    expect(screen.queryByTestId('result-stage')).not.toBeInTheDocument()
  })

  it('clears active tasks without touching history', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /Bersihkan antrean/i }))
    fireEvent.click(screen.getByRole('button', { name: /Bersihkan antrean/i }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).endsWith('/api/tasks/clear'))
      expect(call).toBeDefined()
      expect((call![1] as RequestInit).method).toBe('POST')
    })
  })

  it('stops only what is running', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /^Stop$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Stop$/i }))
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter((c) => /\/api\/tasks\/\d+\/stop$/.test(String(c[0])))
      expect(calls.length).toBeGreaterThan(0)
    })
    // pending work is never addressed by stop
    expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).endsWith('/api/tasks/11/stop'))).toBe(false)
  })

  it('shows the Team Conversation panel with persisted journal messages', async () => {
    render(<App />)
    const panel = await screen.findByTestId('team-conversation')
    expect(screen.getByText('Percakapan Tim')).toBeInTheDocument()
    await within(panel).findByText('Byte started on step 1')
    expect(within(panel).getByText('Byte')).toBeInTheDocument()
    expect(within(panel).getByText('Developer')).toBeInTheDocument()
    expect(within(panel).getByText('Q4 numbers rundown')).toBeInTheDocument()
    expect(within(panel).getByText('langkah 0')).toBeInTheDocument()
  })

  it('appends live task events and links speakers to recipients', async () => {
    render(<App />)
    const panel = await screen.findByTestId('team-conversation')
    await within(panel).findByText('Byte started on step 1')
    FakeEventSource.instances[0].emit('task_event', JSON.stringify({
      id: 55, taskId: 10, type: 'agent_chat', message: 'Coordinator drafted the outline',
      conversationId: null, agentId: 1, provider: null, model: null, stepIndex: 2, createdAt: '2026-10-24T03:00:00Z',
      actorAgentId: 1, recipientAgentId: 2,
    }))
    expect(await within(panel).findByText('Coordinator drafted the outline')).toBeInTheDocument()
    expect(within(panel).getByText('Atlas')).toBeInTheDocument()
    expect(within(panel).getByText(/→ Byte/)).toBeInTheDocument()
  })

  it('flags escalations from specialists to the leader', async () => {
    render(<App />)
    const panel = await screen.findByTestId('team-conversation')
    await within(panel).findByText('Byte started on step 1')
    FakeEventSource.instances[0].emit('task_event', JSON.stringify({
      id: 56, taskId: 10, type: 'needs_help', message: 'Blocked: the data source is missing',
      conversationId: null, agentId: 2, provider: null, model: null, stepIndex: 1, createdAt: '2026-10-24T03:10:00Z',
    }))
    expect(await within(panel).findByText(/1 eskalasi/)).toBeInTheDocument()
  })

  it('hides the approval panel while everything runs automatically', async () => {
    render(<App />)
    await waitFor(() => screen.getByText(/Terhubung/))
    expect(screen.queryByTestId('approvals')).not.toBeInTheDocument()
  })

  it('lists a genuinely blocked run in the approvals panel', async () => {
    failedRun = { id: 40, title: 'Broken build', description: '', status: 'failed', priority: 'normal', agent_id: 2, parent_id: null, run_mode: 'conversation', artifact_path: '', created_at: '2026-10-24T01:00:00Z', updated_at: '2026-10-24T04:00:00Z' }
    render(<App />)
    const panel = await screen.findByTestId('approvals')
    expect(within(panel).getByText('Broken build')).toBeInTheDocument()
    expect(within(panel).getByText(/pimpinan minta arahan/)).toBeInTheDocument()
  })

  it('renders the AI engine bar in the collapsible settings and patches config', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('AI Engine'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI enabled' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) =>
        String(c[0]).endsWith('/api/ai/config') && (c[1] as RequestInit | undefined)?.method === 'PATCH')
      expect(call).toBeDefined()
    })
  })
})

describe('conversations on the same page', () => {
  it('shows the chat transcript under the result', async () => {
    render(<App />)
    await waitFor(() => screen.getByText(/Terhubung/))
    fireEvent.change(screen.getByLabelText('Pilih percakapan'), { target: { value: '7' } })
    expect(await screen.findByText('make the report')).toBeInTheDocument()
  })

  it('sends chat messages only while clarifying', async () => {
    render(<App />)
    await waitFor(() => screen.getByText(/Terhubung/))
    fireEvent.change(screen.getByLabelText('Pilih percakapan'), { target: { value: '8' } })
    const input = await screen.findByLabelText('Message')
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'revenue figures please' } })
    fireEvent.click(within(input.closest('form')! as HTMLElement).getByRole('button', { name: /kirim/i }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) =>
        String(c[0]).endsWith('/api/conversations/8/messages') && (c[1] as RequestInit | undefined)?.method === 'POST')
      expect(call).toBeDefined()
      expect((call![1] as RequestInit).body).toContain('revenue figures please')
    })
    fireEvent.change(screen.getByLabelText('Pilih percakapan'), { target: { value: '7' } })
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeDisabled())
  })

  it('gives the office an order from the command bar', async () => {
    render(<App />)
    const input = await screen.findByLabelText('Perintah untuk kantor')
    fireEvent.change(input, { target: { value: 'Build a landing page' } })
    fireEvent.click(within(input.closest('form')! as HTMLElement).getByRole('button', { name: /kerjakan/i }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) =>
        String(c[0]).endsWith('/api/conversations') && (c[1] as RequestInit | undefined)?.method === 'POST')
      expect(call).toBeDefined()
      expect((call![1] as RequestInit).body).toContain('Build a landing page')
    })
  })
})

describe('journal', () => {
  it('appends realtime journal frames from the event stream', async () => {
    render(<App />)
    const source = FakeEventSource.instances[0]
    expect(source.url).toContain('/api/events/stream')
    source.emit('open')
    expect(await screen.findByText(/Terhubung · live/)).toBeInTheDocument()
    source.emit('task_event', JSON.stringify({
      id: 99, taskId: 10, type: 'step_completed', message: 'Step 0 done in 1.2s',
      conversationId: null, agentId: 2, provider: 'qoder', model: 'Efficient', stepIndex: 0, createdAt: '2026-10-24T03:00:00Z',
    }))
    const panel = screen.getByTestId('team-conversation')
    expect(await within(panel).findByText('Step 0 done in 1.2s')).toBeInTheDocument()
    expect(within(panel).getByText('qoder')).toBeInTheDocument()
    expect(within(panel).getByText('Efficient')).toBeInTheDocument()
  })
})

// Keeps the unused-import shape honest: the stream payload type is what the app validates.
const _streamShape: StreamEvent = { id: 1, kind: 'task', taskId: 1, type: 'created', message: '', conversationId: null, agentId: null, provider: null, model: null, stepIndex: null, createdAt: null }
void _streamShape

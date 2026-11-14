import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Activity, Ban, Bot, CheckCircle2, ChevronDown, CircleAlert, Clock3, Eye, FileText, History, LayoutDashboard, MessagesSquare, PenLine, Plus, RefreshCw, Save, Search, Send, Sparkles, Workflow, X, Zap } from 'lucide-react'
import OfficeScene from './features/office/OfficeScene'
import ProviderBar from './features/provider/ProviderBar'
import ChatPanel from './features/chat/ChatPanel'
import PlanPanel from './features/plan/PlanPanel'
import EventLog, { pushEvent } from './features/events/EventLog'
import TeamConversation, { mergeTeam, pushTeam } from './features/events/TeamConversation'
import { latestByAgent } from './lib/activity'
import { isActionEvent, latestActionByAgent } from './features/iso/actions'
import { roomById } from './lib/officeLayout'
import { useEventStream } from './lib/sse'
import { api } from './lib/api'
import { firstIssue, taskFormSchema } from './lib/validation'
import type { Agent, AiConfig, ChannelStatus, Conversation, StreamEvent, Task, TaskEvent, TaskResult, TaskStatus, TeamEvent } from './types'

const statusLabel: Record<TaskStatus, string> = {
  pending: 'Pending', clarifying: 'Clarifying', awaiting_approval: 'Awaiting approval',
  approved: 'Approved', queued: 'Queued', running: 'Running', reviewing: 'Reviewing',
  completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
}

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [view, setView] = useState<'office' | 'requests'>('office')
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [selectedTask, setSelectedTask] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | TaskStatus>('all')
  const [search, setSearch] = useState('')
  const [apiOnline, setApiOnline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('normal')
  const [agentId, setAgentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPriority, setEditPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [formError, setFormError] = useState('')
  const [editError, setEditError] = useState('')
  const [ai, setAi] = useState<AiConfig | null>(null)
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null)
  const [newRequest, setNewRequest] = useState('')
  const [channels, setChannels] = useState<ChannelStatus | null>(null)
  const [journal, setJournal] = useState<StreamEvent[]>([])
  // Newest per-tool `action_*` frame per agent. Kept apart from the journal: those frames are
  // frequent and would push real milestones out of its short window.
  const [actions, setActions] = useState<Record<number, StreamEvent>>({})
  const [team, setTeam] = useState<TeamEvent[]>([])
  const [convKey, setConvKey] = useState(0)
  const lastStreamRefresh = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const [agentData, taskData, convData] = await Promise.all([api.agents(), api.tasks(), api.conversations()])
      setAgents(agentData)
      setTasks(taskData)
      setConversations(convData)
      setApiOnline(true)
      setError('')
    } catch (e) {
      setApiOnline(false)
      setAi(null)
      setError(e instanceof Error ? e.message : 'Backend is unavailable')
    } finally {
      setLoading(false)
    }
    void api.aiConfig().then(setAi).catch(() => setAi(null))
    void api.channelsStatus().then(setChannels).catch(() => setChannels(null))
    void api.teamEvents().then((data) => setTeam((current) => mergeTeam(data, current))).catch(() => {})
  }, [])

  // Realtime: the SSE journal triggers debounced reloads; a 15s poll is only a safety net.
  const connected = useEventStream(useCallback((event: StreamEvent) => {
    if (event.kind === 'task' && isActionEvent(event)) {
      setActions((current) => latestActionByAgent(current, event))
      return
    }
    setJournal((current) => pushEvent(current, event))
    if (event.kind === 'task') {
      const agent = agents.find((a) => a.id === event.agentId)
      const task = tasks.find((t) => t.id === event.taskId)
      setTeam((current) => pushTeam(current, {
        id: event.id,
        task_id: event.taskId,
        task_title: task?.title ?? '',
        event_type: event.type,
        message: event.message,
        created_at: event.createdAt,
        agent_id: event.agentId,
        agent_name: agent?.name ?? null,
        agent_role: agent?.role ?? null,
        step_index: event.stepIndex,
        provider: event.provider,
        model: event.model,
      }))
    }
    if (event.conversationId != null) setConvKey((k) => k + 1)
    const now = Date.now()
    if (now - lastStreamRefresh.current > 800) {
      lastStreamRefresh.current = now
      void refresh()
    }
  }, [refresh, agents, tasks]))

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 15000)
    return () => window.clearInterval(id)
  }, [refresh])

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    const matchesStatus = filter === 'all' || task.status === filter
    const matchesSearch = `${task.title} ${task.description}`.toLowerCase().includes(search.toLowerCase())
    return matchesStatus && matchesSearch
  }), [tasks, filter, search])

  const activeCount = tasks.filter((task) => ['running', 'queued', 'reviewing', 'approved'].includes(task.status)).length
  const completedCount = tasks.filter((task) => task.status === 'completed').length
  const agentActivity = useMemo(() => latestByAgent([...journal, ...Object.values(actions)]), [journal, actions])
  const meetingTopic = useMemo(() => {
    let topic: string | undefined
    let lastMeeting: StreamEvent | undefined
    for (const event of journal) {
      if (event.type === 'meeting_started' && (!lastMeeting || event.id > lastMeeting.id)) {
        lastMeeting = event
        topic = event.message.replace(/^QC meeting:\s*/i, '').slice(0, 40)
      }
    }
    return topic
  }, [journal])
  const selectedAgentData = agents.find((agent) => agent.id === selectedAgent)
  const selectedTaskData = tasks.find((task) => task.id === selectedTask)
  const conversationData = conversations.find((conv) => conv.id === selectedConversation) ?? null

  useEffect(() => {
    setEditing(false)
    setEditError('')
    if (selectedTask == null) {
      setEvents([])
      return
    }
    let cancelled = false
    void api.events(selectedTask)
      .then((data) => { if (!cancelled) setEvents(data) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [selectedTask, selectedTaskData?.updated_at, connected])

  function startEdit(task: Task) {
    setEditTitle(task.title)
    setEditDescription(task.description)
    setEditPriority(task.priority)
    setEditError('')
    setEditing(true)
  }

  async function saveEdit() {
    if (selectedTaskData == null) return
    const parsed = taskFormSchema.safeParse({ title: editTitle, description: editDescription, priority: editPriority })
    if (!parsed.success) {
      setEditError(firstIssue(parsed.error))
      return
    }
    setBusy(true)
    try {
      await api.updateTask(selectedTaskData.id, parsed.data)
      setEditing(false)
      await refresh()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Could not save task')
    } finally {
      setBusy(false)
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = taskFormSchema.safeParse({ title, description, priority })
    if (!parsed.success) {
      setFormError(firstIssue(parsed.error))
      return
    }
    setBusy(true)
    try {
      const task = await api.createTask({
        ...parsed.data,
        agent_id: agentId ? Number(agentId) : null,
      })
      setTitle('')
      setDescription('')
      setPriority('normal')
      setAgentId('')
      setFormError('')
      setShowCreate(false)
      setSelectedTask(task.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create task')
    } finally {
      setBusy(false)
    }
  }

  async function startRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newRequest.trim()) return
    setBusy(true)
    try {
      const conv = await api.createConversation(newRequest.trim())
      setNewRequest('')
      setSelectedConversation(conv.id)
      setConvKey((k) => k + 1)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the request')
    } finally {
      setBusy(false)
    }
  }

  async function updateTask(id: number, payload: Partial<Pick<Task, 'status' | 'agent_id'>>) {
    try {
      await api.updateTask(id, payload)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update task')
    }
  }

  async function cancelTask(id: number) {
    try {
      await api.cancelTask(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel task')
    }
  }

  async function runWithAi(id: number, mode: 'direct' | 'plan') {
    try {
      await api.executeTask(id, mode)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start AI run')
    }
  }

  async function openResult(id: number) {
    try {
      setTaskResult(await api.taskResult(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load result')
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={20} /></div>
          <div><strong>AgentVille</strong><span>VIRTUAL OFFICE</span></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <button className={`nav-item ${view === 'office' ? 'active' : ''}`} onClick={() => setView('office')}><LayoutDashboard size={17} /> Office Overview</button>
        <button className={`nav-item ${view === 'requests' ? 'active' : ''}`} onClick={() => setView('requests')}><MessagesSquare size={17} /> Requests <span className="nav-count">{conversations.length}</span></button>
        <button className="nav-item" onClick={() => { setView('office'); setFilter('all') }}><CheckCircle2 size={17} /> All Tasks <span className="nav-count">{tasks.length}</span></button>
        <button className="nav-item" onClick={() => { setView('office'); setFilter('running') }}><Activity size={17} /> Running</button>
        <button className="nav-item" onClick={() => { setView('office'); setFilter('completed') }}><CheckCircle2 size={17} /> Completed</button>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <div className="connection-top"><span className={`connection-dot ${apiOnline ? 'online' : ''}`} /> API {apiOnline ? 'Connected' : 'Offline'}</div>
            <p>{apiOnline ? (connected ? 'Backend live · journal streaming.' : 'Backend live · journal offline.') : 'Start the FastAPI backend to load live data.'}</p>
          </div>
          <div className="user-card"><div className="user-avatar">A</div><div><strong>Administrator</strong><span>Local workspace</span></div></div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div><div className="eyebrow">WORKSPACE / {view === 'office' ? 'OVERVIEW' : 'REQUESTS'}</div><h1>Virtual Office</h1></div>
          <div className="topbar-actions">
            <div className={`system-status ${apiOnline ? 'is-online' : ''}`}><span />{apiOnline ? 'All systems operational' : 'Waiting for backend'}</div>
            <button className="icon-button" title="Refresh" onClick={() => void refresh()}><RefreshCw size={17} /></button>
            <button className="primary-button" onClick={() => setShowCreate(true)}><Plus size={17} /> New task</button>
          </div>
        </header>

        {error && <div className="error-banner"><CircleAlert size={17}/><span>{error}. Pastikan backend AgentVille berjalan.</span><button onClick={() => setError('')}><X size={15}/></button></div>}

        <div className="metrics-grid">
          <Metric icon={<Bot size={18}/>} label="AI Agents" value={String(agents.length).padStart(2, '0')} hint="Registered workers" />
          <Metric icon={<Activity size={18}/>} label="Active Tasks" value={String(activeCount).padStart(2, '0')} hint="Queued, running or in QC" />
          <Metric icon={<CheckCircle2 size={18}/>} label="Completed" value={String(completedCount).padStart(2, '0')} hint="Tasks finished" />
          <Metric icon={<Clock3 size={18}/>} label="System" value={apiOnline ? 'Ready' : 'Offline'} hint={loading ? 'Connecting…' : 'Local environment'} />
        </div>

        <ProviderBar config={ai} onConfig={setAi} />

        {view === 'requests' && channels?.telegram && !channels.telegram.configured && (
          <div className="telegram-banner">Telegram channel not active: {channels.telegram.reason}. Configure it in backend/.env — the web flow works fully without it.</div>
        )}

        {view === 'office' ? (
        <div className="content-grid office-grid">
          <section className="panel office-panel">
            <div className="panel-heading">
              <div><h2>Office Floor</h2><p>2D / 3D workspace · Select an agent to inspect</p></div>
              <span className="panel-tag"><span className="live-dot"/> LIVE VIEW</span>
            </div>
            <OfficeScene agents={agents} tasks={tasks} selectedId={selectedAgent} onSelect={setSelectedAgent} activity={agentActivity} meetingTopic={meetingTopic} />
            <div className="office-footer">
              <div className="legend"><span className="legend-dot working"/> Working <span className="legend-dot waiting"/> Waiting <span className="legend-dot reviewing"/> Reviewing <span className="legend-dot idle"/> Idle <span className="legend-dot completed"/> Completed <span className="legend-dot failed"/> Failed</div>
              <span>{agents.length} workstations registered</span>
            </div>
            {selectedAgentData && <div className="selected-agent">
              <div className="agent-avatar"><Bot size={20}/></div>
              <div className="selected-agent-info"><strong>{selectedAgentData.name}</strong><span>{selectedAgentData.role}</span>
                <span>
                  {roomById(selectedAgentData.current_room).label}
                  {selectedAgentData.target_room && selectedAgentData.target_room !== selectedAgentData.current_room
                    ? <> → {roomById(selectedAgentData.target_room).label}</> : null}
                  {selectedAgentData.active_step_index != null ? <> · step #{selectedAgentData.active_step_index}</> : null}
                </span>
                {agentActivity[selectedAgentData.id] && <span title={agentActivity[selectedAgentData.id].message}>Last: {agentActivity[selectedAgentData.id].message.slice(0, 70)}</span>}
              </div>
              <span className={`status-pill ${selectedAgentData.status}`}>{selectedAgentData.status}</span>
              <button className="icon-button small" onClick={() => setSelectedAgent(null)}><X size={15}/></button>
            </div>}
          </section>

          <div className="office-side">
          <section className="panel task-panel">
            <div className="panel-heading">
              <div><h2>Task Board</h2><p>Manage your team's workload</p></div>
              <button className="icon-button" onClick={() => void refresh()}><RefreshCw size={16}/></button>
            </div>
            <div className="task-toolbar">
              <div className="search-field"><Search size={15}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" /></div>
              <select aria-label="Filter task status" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="clarifying">Clarifying</option>
                <option value="awaiting_approval">Awaiting approval</option>
                <option value="approved">Approved</option>
                <option value="queued">Queued</option>
                <option value="running">Running</option>
                <option value="reviewing">Reviewing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="task-list">
              {loading && <div className="empty-state">Loading tasks…</div>}
              {!loading && filteredTasks.length === 0 && <div className="empty-state"><FileText size={25}/><strong>No tasks yet</strong><span>Create a task to populate your office.</span><button className="text-button" onClick={() => setShowCreate(true)}>Create first task</button></div>}
              {filteredTasks.map((task) => <button key={task.id} className={`task-row ${selectedTask === task.id ? 'selected' : ''}`} onClick={() => setSelectedTask(task.id)}>
                <div className={`task-icon ${task.status}`}><FileText size={17}/></div>
                <div className="task-row-main"><strong>{task.title}</strong><span>{task.description || 'No description'}</span><div className="task-meta"><span>{timeAgo(task.updated_at)}</span><span className={`priority ${task.priority}`}>{task.priority}</span></div></div>
                <span className={`status-pill ${task.status}`}>{statusLabel[task.status]}</span>
              </button>)}
            </div>
            {selectedTaskData && <div className="task-detail">
              <div className="detail-head"><strong>Task details</strong><div className="detail-head-actions">
                {!editing && <button className="icon-button small" title="Edit task" onClick={() => startEdit(selectedTaskData)}><PenLine size={14}/></button>}
                <button className="icon-button small" title="Close details" onClick={() => setSelectedTask(null)}><X size={15}/></button>
              </div></div>
              {editing ? <form className="edit-form" onSubmit={(e) => { e.preventDefault(); void saveEdit() }}>
                <label>Title <input autoFocus maxLength={160} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></label>
                <label>Description <textarea maxLength={4000} rows={3} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></label>
                <label>Priority <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as typeof editPriority)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
                {editError && <div className="field-error">{editError}</div>}
                <div className="detail-actions">
                  <button className="primary-button compact" type="submit" disabled={busy}><Save size={14}/> {busy ? 'Saving…' : 'Save'}</button>
                  <button className="secondary-button compact" type="button" disabled={busy} onClick={() => { setEditing(false); setEditError('') }}>Cancel</button>
                </div>
              </form> : <>
                <h3>{selectedTaskData.title}</h3><p>{selectedTaskData.description || 'No description provided.'}</p>
              </>}
              {!editing && <>
              <label>Assigned agent</label>
              <div className="select-wrap"><select value={selectedTaskData.agent_id ?? ''} onChange={(e) => void updateTask(selectedTaskData.id, { agent_id: e.target.value ? Number(e.target.value) : null })}><option value="">Unassigned</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><ChevronDown size={14}/></div>
              {selectedTaskData.run_mode === 'conversation'
                ? <div className="detail-actions"><button className="secondary-button compact" onClick={() => { setSelectedConversation(selectedTaskData.conversation_id ?? null); setView('requests') }}><MessagesSquare size={14}/> Open in Requests</button></div>
                : <div className="detail-actions">
                {selectedTaskData.status === 'pending' && <button className="primary-button compact" onClick={() => void updateTask(selectedTaskData.id, { status: 'queued' })}><Send size={14}/> Queue task</button>}
                {selectedTaskData.status === 'queued' && <button className="primary-button compact" onClick={() => void updateTask(selectedTaskData.id, { status: 'running' })}><Activity size={14}/> Start task</button>}
                {selectedTaskData.status === 'running' && <><button className="primary-button compact" onClick={() => void updateTask(selectedTaskData.id, { status: 'completed' })}><CheckCircle2 size={14}/> Complete</button><button className="danger-button compact" onClick={() => void updateTask(selectedTaskData.id, { status: 'failed' })}>Mark failed</button></>}
                {(selectedTaskData.status === 'pending' || selectedTaskData.status === 'queued' || selectedTaskData.status === 'running') && <button className="secondary-button compact" onClick={() => void cancelTask(selectedTaskData.id)}>Cancel</button>}
                {ai?.ai_enabled && (selectedTaskData.status === 'pending' || selectedTaskData.status === 'failed') && selectedTaskData.parent_id == null && <>
                  <button className="ai-button compact" onClick={() => void runWithAi(selectedTaskData.id, 'direct')}><Zap size={14}/> Run with AI</button>
                  <button className="ai-button compact" onClick={() => void runWithAi(selectedTaskData.id, 'plan')}><Workflow size={14}/> Plan &amp; Run</button>
                </>}
                {(selectedTaskData.run_mode.startsWith('ai') || selectedTaskData.run_mode === 'conversation') && (selectedTaskData.status === 'completed' || selectedTaskData.status === 'failed') && selectedTaskData.parent_id == null &&
                  <button className="secondary-button compact" onClick={() => void openResult(selectedTaskData.id)}><Eye size={14}/> Open result</button>}
              </div>}
              <div className="event-history">
                <div className="event-history-head"><History size={13}/> <span>Activity history</span></div>
                {events.length === 0 && <p className="event-empty">No activity recorded yet.</p>}
                <ul>{events.map((event) => <li key={event.id}><span className={`event-type ${event.event_type}`}>{event.event_type}</span><span className="event-message">{event.message}</span>{event.step_index != null && <span className="event-step">step {event.step_index}</span>}{event.provider && <span className="event-provider">{event.provider}</span>}{event.model && <span className="event-model">{event.model}</span>}<time>{timeAgo(event.created_at)}</time></li>)}</ul>
              </div>
              </>}
            </div>}
          </section>
          <TeamConversation events={team} connected={connected} />
          </div>
        </div>
        ) : (
        <div className="content-grid requests-grid">
          <section className="panel requests-panel">
            <div className="panel-heading">
              <div><h2>Requests</h2><p>Talk to the Coordinator · nothing executes before you approve</p></div>
            </div>
            <form className="new-request" onSubmit={startRequest}>
              <input aria-label="New request" value={newRequest} onChange={(e) => setNewRequest(e.target.value)}
                     placeholder="Describe the work you want the office to do…" maxLength={4000} />
              <button className="primary-button compact" type="submit" disabled={busy || !newRequest.trim()}><Sparkles size={14}/> Start</button>
            </form>
            <div className="conversation-list">
              {conversations.length === 0 && <div className="empty-state"><MessagesSquare size={25}/><strong>No requests yet</strong><span>Start one above — the Coordinator will ask questions before proposing a plan.</span></div>}
              {conversations.map((conv) => <button key={conv.id} className={`task-row ${selectedConversation === conv.id ? 'selected' : ''}`} onClick={() => setSelectedConversation(conv.id)}>
                <div className="task-icon clarifying"><MessagesSquare size={17}/></div>
                <div className="task-row-main"><strong>{conv.title}</strong><span>{conv.channel} · v{conv.current_plan_version}</span></div>
                <span className={`status-pill ${conv.status}`}>{conv.status.replaceAll('_', ' ')}</span>
              </button>)}
            </div>
            <EventLog events={journal} connected={connected} />
          </section>
          <section className="panel conversation-panel">
            <div className="conversation-split">
              <ChatPanel conversation={conversationData} refreshKey={convKey}
                         onSent={() => setConvKey((k) => k + 1)} onError={setError} />
              <PlanPanel conversation={conversationData} refreshKey={convKey}
                         onAction={() => { setConvKey((k) => k + 1); void refresh() }} onError={setError} />
              {conversationData && !['completed', 'failed', 'cancelled'].includes(conversationData.status) && (
                <button className="secondary-button compact" onClick={() => void api.cancelConversation(conversationData.id).then(() => refresh())}>
                  <Ban size={14}/> Cancel this request
                </button>
              )}
            </div>
          </section>
        </div>
        )}
        <footer className="app-footer"><span>AGENTVILLE MVP 0.2.0</span><span>Local-first · providers: opencode + qoder + claude CLI</span><span>Designed for controlled autonomy</span></footer>
      </section>

      {taskResult && <div className="modal-backdrop" onClick={() => setTaskResult(null)}>
        <div className="modal result-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-heading"><div><span className="eyebrow">AI OUTPUT</span><h2>{taskResult.title}</h2></div><button type="button" className="icon-button" onClick={() => setTaskResult(null)}><X size={17}/></button></div>
          <div className="result-meta"><span className={`status-pill ${taskResult.status}`}>{statusLabel[taskResult.status] ?? taskResult.status}</span><span className={`priority ${taskResult.run_mode === 'ai_plan' ? 'high' : 'normal'}`}>{taskResult.run_mode === 'ai_plan' ? 'planned run' : taskResult.run_mode === 'conversation' ? 'conversation run' : 'direct run'}</span></div>
          {taskResult.children.length > 0 && <div className="result-children">
            <div className="event-history-head"><Workflow size={13}/><span>Subtasks</span></div>
            <ul>{taskResult.children.map((child) => <li key={child.id}><span className="event-message">{child.title}</span>{child.provider_used && <span className="event-provider">{child.provider_used}</span>}{child.model_used && <span className="event-model">{child.model_used}</span>}<span className={`status-pill ${child.status}`}>{statusLabel[child.status] ?? child.status}</span></li>)}</ul>
          </div>}
          {(taskResult.qc_reviews?.length ?? 0) > 0 && <div className="result-children">
            <div className="event-history-head"><CheckCircle2 size={13}/><span>QC reviews</span></div>
            <ul>{taskResult.qc_reviews?.map((review) => <li key={review.id}><span className="event-message">Round {review.iteration}: {review.verdict}{review.findings ? ` — ${review.findings}` : ''}</span></li>)}</ul>
          </div>}
          {taskResult.diff_path && <small className="ai-bar-note">Workspace diff: {taskResult.diff_path}</small>}
          <pre className="result-body">{taskResult.result || 'No result stored yet.'}</pre>
          {taskResult.artifact_path && <small className="ai-bar-note">Artifact: {taskResult.artifact_path}</small>}
        </div>
      </div>}

      {showCreate && <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
        <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={createTask}>
          <div className="modal-heading"><div><span className="eyebrow">TASK MANAGEMENT</span><h2>Create a task</h2></div><button type="button" className="icon-button" onClick={() => setShowCreate(false)}><X size={17}/></button></div>
          <label>Task title <input autoFocus maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Analyze monthly sales" /></label>
          <label>Description <textarea maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the desired outcome…" rows={4}/></label>
          <div className="form-row">
            <label>Priority <select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
            <label>Assign agent <select value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">Unassigned</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          </div>
          <div className="modal-note"><Sparkles size={15}/> Or talk to the Coordinator under Requests — it plans, waits for your approval, then executes.</div>
          {formError && <div className="field-error">{formError}</div>}
          <button className="primary-button modal-submit" disabled={busy}>{busy ? 'Creating…' : 'Create task'} <Plus size={16}/></button>
        </form>
      </div>}
    </main>
  )
}

function Metric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong>{value}</strong><small>{hint}</small></div>
}

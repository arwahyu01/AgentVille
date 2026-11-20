import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity, Ban, CircleAlert, FileText, Link2, MessagesSquare, RefreshCw, Send, Settings2, ShieldCheck, Sparkles, Square, UploadCloud, Users, X,
} from 'lucide-react'
import OfficeScene from './features/office/OfficeScene'
import ProviderBar from './features/provider/ProviderBar'
import ChatPanel from './features/chat/ChatPanel'
import ApprovalsPanel, { approvalItems } from './features/plan/ApprovalsPanel'
import IntegrationsPanel from './features/integrations/IntegrationsPanel'
import PublishPanel from './features/publish/PublishPanel'
import TeamConversation, { mergeTeam, pushTeam } from './features/events/TeamConversation'
import ResultStage from './features/result/ResultStage'
import { latestByAgent } from './lib/activity'
import { isActionEvent, latestActionByAgent } from './features/iso/actions'
import { latestErrandByAgent } from './features/iso/errands'
import { useEventStream } from './lib/sse'
import { api, clientId } from './lib/api'
import { isActive, statusLabel } from './lib/status'
import type { Agent, AiConfig, Conversation, StreamEvent, Task, TaskResult, TeamEvent } from './types'

/** Sort so work in flight sits on top, then newest finished work — the queue reads like an inbox. */
function orderedRuns(tasks: Task[]): Task[] {
  const rank = (task: Task) => (isActive(task.status) ? 0 : task.status === 'completed' ? 2 : 1)
  return tasks
    .filter((task) => task.parent_id == null)
    .sort((a, b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at))
}

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedTask, setSelectedTask] = useState<number | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null)
  const [result, setResult] = useState<TaskResult | null>(null)
  const [resultLoading, setResultLoading] = useState(false)
  const [resultOpen, setResultOpen] = useState(false)
  const [newRequest, setNewRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [apiOnline, setApiOnline] = useState(false)
  const [error, setError] = useState('')
  const [ai, setAi] = useState<AiConfig | null>(null)
  const [team, setTeam] = useState<TeamEvent[]>([])
  const [journal, setJournal] = useState<StreamEvent[]>([])
  const [actions, setActions] = useState<Record<number, StreamEvent>>({})
  const [errands, setErrands] = useState<Record<number, StreamEvent>>({})
  const [convKey, setConvKey] = useState(0)
  const [railView, setRailView] = useState<'chat' | 'actions' | 'team' | 'settings' | 'integrations' | 'publish'>('chat')
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
      setError(e instanceof Error ? e.message : 'Backend tidak tersedia')
    }
    void api.aiConfig().then(setAi).catch(() => setAi(null))
    void api.teamEvents().then((data) => setTeam((current) => mergeTeam(data, current))).catch(() => {})
  }, [])

  // Realtime: SSE frames drive the refresh; the 15 s poll is only a safety net.
  const connected = useEventStream(useCallback((event: StreamEvent) => {
    if (event.kind === 'task' && isActionEvent(event)) {
      setActions((current) => latestActionByAgent(current, event))
      return
    }
    setJournal((current) => [...current.slice(-19), event])
    if (event.kind === 'task') {
      setErrands((current) => latestErrandByAgent(current, event))
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
        recipient_agent_id: event.recipientAgentId ?? null,
        recipient_name: agents.find((a) => a.id === event.recipientAgentId)?.name ?? null,
      }))
    }
    if (event.conversationId != null) setConvKey((k) => k + 1)
    const now = Date.now()
    if (now - lastStreamRefresh.current > 700) {
      lastStreamRefresh.current = now
      void refresh()
    }
  }, [refresh, agents, tasks]))

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 15000)
    return () => window.clearInterval(id)
  }, [refresh])

  const runs = useMemo(() => orderedRuns(tasks), [tasks])
  const selectedTaskData = tasks.find((task) => task.id === selectedTask) ?? null
  const activeCount = runs.filter((task) => isActive(task.status)).length
  const completedCount = runs.filter((task) => task.status === 'completed').length
  const approvals = useMemo(() => approvalItems(tasks, conversations), [tasks, conversations])
  const conversationData = conversations.find((conv) => conv.id === selectedConversation) ?? null
  const waitingConversation = conversations.find((conv) => conv.status === 'clarifying') ?? null
  const opening = conversationData ?? waitingConversation
  const agentActivity = useMemo(() => latestByAgent([...journal, ...Object.values(actions)]), [journal, actions])
  const meetingTopic = useMemo(() => {
    let last: { id: number; type: string; message: string } | undefined
    const consider = (id: number, type: string, message: string) => {
      if ((type === 'meeting_started' || type === 'meeting_ended') && (!last || id > last.id)) last = { id, type, message }
    }
    for (const event of journal) consider(event.id, event.type, event.message)
    for (const event of team) consider(event.id, event.event_type, event.message)
    if (!last || last.type === 'meeting_ended') return undefined
    return (last as { message: string }).message.replace(/^QC meeting:\s*/i, '').slice(0, 40)
  }, [journal, team])

  // Keep a job on screen: the newest in-flight run, otherwise the newest finished one.
  useEffect(() => {
    if (selectedTask != null && tasks.some((task) => task.id === selectedTask)) return
    const next = orderedRuns(tasks)[0] ?? null
    setSelectedTask(next?.id ?? null)
  }, [tasks, selectedTask])

  // Open a clarification that needs an answer; otherwise show the newest conversation.
  // Once the user picks a conversation, automatic task selection never steals that choice.
  useEffect(() => {
    if (selectedConversation != null && conversations.some((conv) => conv.id === selectedConversation)) return
    const next = waitingConversation ?? conversations[0] ?? null
    setSelectedConversation(next?.id ?? null)
  }, [conversations, selectedConversation, waitingConversation])

  useEffect(() => {
    if (selectedTask == null) {
      setResult(null)
      return
    }
    let cancelled = false
    setResultLoading(true)
    void api.taskResult(selectedTask)
      .then((data) => { if (!cancelled) setResult(data) })
      .catch(() => { if (!cancelled) setResult(null) })
      .finally(() => { if (!cancelled) setResultLoading(false) })
    return () => { cancelled = true }
  }, [selectedTask, selectedTaskData?.updated_at, connected])

  function closeResult() {
    setResultOpen(false)
  }

  useEffect(() => {
    if (!resultOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeResult() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function startRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newRequest.trim()) return
    setBusy(true)
    try {
      const conv = await api.createConversation(newRequest.trim(), clientId())
      setNewRequest('')
      setSelectedConversation(conv.id)
      setConvKey((k) => k + 1)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Perintah gagal dikirim')
    } finally {
      setBusy(false)
    }
  }

  async function stopRunning() {
    setBusy(true)
    try {
      await Promise.all(runs.filter((task) => task.status === 'running' || task.status === 'reviewing')
        .map((task) => api.stopTask(task.id).catch(() => null)))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function clearAll() {
    setBusy(true)
    try {
      await api.clearTasks()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tidak bisa menghentikan pekerjaan')
    } finally {
      setBusy(false)
    }
  }

  function selectRun(task: Task) {
    if (task.id !== selectedTask) setResult(null)
    setSelectedTask(task.id)
    if (task.conversation_id != null) setSelectedConversation(task.conversation_id)
    if (task.status === 'completed') {
      setResultOpen(true)
    }
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div><strong>AgentVille</strong><span>KANTOR MANDIRI</span></div>
        </div>
        <form className="request-bar" onSubmit={startRequest}>
          <input aria-label="Perintah untuk kantor" value={newRequest} onChange={(e) => setNewRequest(e.target.value)}
                 placeholder="Suruh kantor: buatkan website / gambar / video / dokumen…" maxLength={4000} />
          <button className="primary-button" type="submit" disabled={busy || !newRequest.trim()}>
            <Send size={15} /> Kerjakan
          </button>
        </form>
        <div className="top-actions">
          <div className={`system-status ${apiOnline ? 'is-online' : ''}`}><span />{apiOnline ? `Terhubung${connected ? ' · live' : ' · API'}` : 'Backend mati'}</div>
          <button className="icon-button" title="Muat ulang" onClick={() => void refresh()}><RefreshCw size={16} /></button>
          <button className="secondary-button compact" disabled={busy || activeCount === 0} onClick={() => void stopRunning()}>
            <Square size={13} /> Stop
          </button>
          <button className="danger-button compact" disabled={busy || activeCount === 0} onClick={() => void clearAll()}>
            <Ban size={13} /> Bersihkan antrean
          </button>
        </div>
      </header>

      {error && <div className="error-banner"><CircleAlert size={17}/><span>{error}. Pastikan backend AgentVille berjalan.</span><button onClick={() => setError('')}><X size={15}/></button></div>}
      {selectedTaskData && result?.result && ['completed', 'failed'].includes(selectedTaskData.status) && (
        <div className={`result-available-banner ${selectedTaskData.status}`} role="status">
          <span><FileText size={15} />
            {selectedTaskData.status === 'failed'
              ? 'Hasil sementara tersedia; belum lolos verifikasi.'
              : 'Hasil pekerjaan siap dilihat.'}
          </span>
          <button className="secondary-button compact" onClick={() => setResultOpen(true)}>Buka hasil</button>
        </div>
      )}

      <div className="page-grid">
        <aside className="panel queue-panel">
          <div className="panel-heading">
            <div>
              <h2><Activity size={15} /> Pekerjaan</h2>
              <p>{activeCount} berjalan · {completedCount} selesai</p>
            </div>
          </div>
          <ul className="queue-list" data-testid="run-list">
            {runs.length === 0 && (
              <li className="queue-empty"><FileText size={20} /><span>Belum ada pekerjaan. Tulis perintah di atas.</span></li>
            )}
            {runs.map((task) => {
              const steps = tasks.filter((child) => child.parent_id === task.id)
              const done = steps.filter((child) => child.status === 'completed').length
              const owner = agents.find((agent) => agent.id === task.agent_id)
              return (
                <li key={task.id}>
                  <button className={`queue-row ${selectedTask === task.id ? 'selected' : ''}`} onClick={() => selectRun(task)}>
                    <span className={`queue-dot ${task.status}`} />
                    <span className="queue-main">
                      <strong>{task.title}</strong>
                      <span>
                        #{task.id} · {owner?.name ?? 'pimpinan'}
                        {steps.length > 0 ? ` · ${done}/${steps.length} langkah` : ''}
                      </span>
                    </span>
                    <span className={`status-pill ${task.status}`}>{statusLabel[task.status]}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <div className="col-office">
          <section className="panel office-stage">
            <div className="office-stage-head">
              <div>
                <h2><Activity size={15} /> Kantor</h2>
                <p>{agents.length} staf · {activeCount} bekerja · {completedCount} selesai</p>
              </div>
              <button className="secondary-button compact" disabled={result == null}
                      onClick={() => setResultOpen(true)}>
                <FileText size={13} /> Lihat hasil
              </button>
            </div>
            <OfficeScene agents={agents} tasks={tasks} selectedId={selectedAgent} onSelect={setSelectedAgent}
                        activity={agentActivity} errands={errands} meetingTopic={meetingTopic} />
          </section>
        </div>

        <aside className="col-rail">
          <nav className="rail-tabs" aria-label="Panel AgentVille">
            <button className={railView === 'chat' ? 'active' : ''} aria-pressed={railView === 'chat'}
                    onClick={() => setRailView('chat')}><MessagesSquare size={15} /> Chat
              {waitingConversation && <span className="rail-tab-dot" title="Menunggu jawaban" />}
            </button>
            <button className={railView === 'actions' ? 'active' : ''} aria-pressed={railView === 'actions'}
                    onClick={() => setRailView('actions')}><ShieldCheck size={15} /> Perlu aksi
              {approvals.length > 0 && <span className="rail-tab-count">{approvals.length}</span>}
            </button>
            <button className={railView === 'team' ? 'active' : ''} aria-pressed={railView === 'team'}
                    onClick={() => setRailView('team')}><Users size={15} /> Tim</button>
            <button className={railView === 'settings' ? 'active' : ''} aria-pressed={railView === 'settings'}
                    onClick={() => setRailView('settings')}><Settings2 size={15} /> AI</button>
            <button className={railView === 'integrations' ? 'active' : ''} aria-pressed={railView === 'integrations'}
                    onClick={() => setRailView('integrations')}><Link2 size={15} /> Integrasi</button>
            <button className={railView === 'publish' ? 'active' : ''} aria-pressed={railView === 'publish'}
                    onClick={() => setRailView('publish')}><UploadCloud size={15} /> Publikasi</button>
          </nav>

          {railView === 'chat' && (
            <section className="panel chat-card">
              <div className="panel-heading">
                <div><h2><MessagesSquare size={15}/> {waitingConversation?.id === opening?.id ? 'Kantor butuh jawabanmu' : 'Percakapan'}</h2><p>Riwayat dan klarifikasi permintaan.</p></div>
                <select aria-label="Pilih percakapan" value={opening?.id ?? ''}
                        onChange={(e) => setSelectedConversation(e.target.value ? Number(e.target.value) : null)}>
                  {conversations.length === 0 && <option value="">Belum ada percakapan</option>}
                  {conversations.map((conv) => <option key={conv.id} value={conv.id}>#{conv.id} {conv.title.slice(0, 30)}</option>)}
                </select>
              </div>
              <div className="chat-card-body">
                <ChatPanel conversation={opening} refreshKey={convKey}
                           onSent={() => setConvKey((k) => k + 1)} onError={setError} />
              </div>
            </section>
          )}

          {railView === 'actions' && (
            <ApprovalsPanel tasks={tasks} conversations={conversations} agents={agents}
                            onAction={() => { void refresh(); setConvKey((k) => k + 1) }} onError={setError} />
          )}
          {railView === 'team' && <TeamConversation events={team} connected={connected} />}
          {railView === 'integrations' && <IntegrationsPanel onError={setError} />}
          {railView === 'publish' && <PublishPanel onError={setError} />}
          {railView === 'settings' && (
            <section className="panel rail-ai-settings" aria-labelledby="ai-settings-title">
              <div className="panel-heading">
                <div><h2 id="ai-settings-title"><Settings2 size={15} /> Pengaturan AI</h2><p>Provider, model, dan perilaku agen.</p></div>
              </div>
              {ai
                ? <ProviderBar config={ai} onConfig={setAi} />
                : <p className="rail-ai-unavailable">Konfigurasi AI belum tersedia. Periksa koneksi backend, lalu muat ulang.</p>}
            </section>
          )}
        </aside>
      </div>

      {resultOpen && selectedTaskData && (
        <div className="result-modal-backdrop"
             onClick={(e) => { if (e.target === e.currentTarget) closeResult() }}>
          <div className="result-modal" role="dialog" aria-modal="true" aria-label={`Hasil: ${selectedTaskData.title}`}>
            <div className="result-modal-bar">
              <span><Sparkles size={14} /> Hasil pekerjaan</span>
              <button className="icon-button small" aria-label="Tutup hasil" onClick={closeResult}>
                <X size={15} />
              </button>
            </div>
            <div className="result-modal-body">
              <ResultStage task={selectedTaskData} result={result} agents={agents} loading={resultLoading && result == null} />
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer"><span>AGENTVILLE</span><span>Kantor bekerja sendiri · hasil tampil otomatis</span><span>{connected ? 'live' : 'offline'}</span></footer>
    </main>
  )
}

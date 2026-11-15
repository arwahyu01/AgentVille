import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, UserRoundCog, X } from 'lucide-react'
import { api } from '../../lib/api'
import type { Agent, Conversation, Task } from '../../types'

/**
 * The only place a human decision is needed. Everything else in the office runs on its own,
 * so this panel stays empty unless a plan is genuinely blocked:
 *  - a proposal that predates automatic approval (legacy `awaiting_approval`),
 *  - a run the leader could not finish (merge conflict, exhausted retries),
 *  - a step whose owner failed and needs another pair of hands.
 */
type Item =
  | { key: string; kind: 'plan'; conversation: Conversation }
  | { key: string; kind: 'accept'; conversation: Conversation }
  | { key: string; kind: 'failed-run'; task: Task }
  | { key: string; kind: 'stuck-step'; task: Task }

export function approvalItems(tasks: Task[], conversations: Conversation[]): Item[] {
  const items: Item[] = []
  for (const conv of conversations) {
    if (conv.status === 'awaiting_approval') items.push({ key: `plan-${conv.id}`, kind: 'plan', conversation: conv })
    if (conv.status === 'awaiting_acceptance') items.push({ key: `accept-${conv.id}`, kind: 'accept', conversation: conv })
  }
  for (const task of tasks) {
    if (task.status !== 'failed') continue
    if (task.parent_id == null) items.push({ key: `run-${task.id}`, kind: 'failed-run', task })
    else items.push({ key: `step-${task.id}`, kind: 'stuck-step', task })
  }
  return items
}

export default function ApprovalsPanel({ tasks, conversations, agents, onAction, onError }: {
  tasks: Task[]
  conversations: Conversation[]
  agents: Agent[]
  onAction: () => void
  onError: (message: string) => void
}) {
  const items = useMemo(() => approvalItems(tasks, conversations), [tasks, conversations])
  const [busy, setBusy] = useState('')
  const [notes, setNotes] = useState('')
  const [reassign, setReassign] = useState<Record<number, string>>({})

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    try {
      await fn()
      setNotes('')
      onAction()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Aksi persetujuan gagal')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="panel approvals-panel" data-testid="approvals">
      <div className="panel-heading">
        <div>
          <h2><ShieldCheck size={15} /> Butuh Persetujuan</h2>
          <p>Hanya item yang benar-benar butuh keputusanmu muncul di sini.</p>
        </div>
        <span className={`approvals-count ${items.length ? 'has-items' : ''}`}>{items.length}</span>
      </div>
      {items.length === 0 && (
        <p className="approvals-empty">
          <CheckCircle2 size={14} /> Tidak ada yang menunggu. Semua pekerjaan berjalan otomatis.
        </p>
      )}
      <ul className="approvals-list">
        {items.map((item) => {
          const task = 'task' in item ? item.task : null
          const title = item.kind === 'plan' || item.kind === 'accept' ? item.conversation.title : task?.title ?? ''
          return (
            <li key={item.key} className={`approval-row ${item.kind}`}>
              <div className="approval-head">
                <AlertTriangle size={14} />
                <div>
                  <strong>{title}</strong>
                  <span>
                    {item.kind === 'plan' && `Rencana v${item.conversation.current_plan_version} menunggu keputusan`}
                    {item.kind === 'accept' && 'QC lulus — hasil menunggu persetujuan akhirmu'}
                    {item.kind === 'failed-run' && 'Pekerjaan berhenti — pimpinan minta arahan'}
                    {item.kind === 'stuck-step' && `Langkah ${task?.plan_step_index ?? '?'} macet, perlu pengganti`}
                  </span>
                </div>
              </div>
              {item.kind === 'plan' && (
                <div className="approval-actions">
                  <button className="primary-button compact" disabled={busy === item.key}
                          onClick={() => void run(item.key, () => api.approvePlan(item.conversation.id, item.conversation.current_plan_version))}>
                    <CheckCircle2 size={14} /> Setujui
                  </button>
                  <button className="secondary-button compact" disabled={busy === item.key}
                          onClick={() => void run(item.key, () => api.cancelConversation(item.conversation.id))}>
                    <X size={14} /> Batalkan
                  </button>
                </div>
              )}
              {item.kind === 'accept' && (
                <div className="approval-actions">
                  <button className="primary-button compact" disabled={busy === item.key}
                          onClick={() => void run(item.key, () => api.acceptResult(item.conversation.id))}>
                    <CheckCircle2 size={14} /> Terima hasil
                  </button>
                  <button className="secondary-button compact" disabled={busy === item.key}
                          onClick={() => void run(item.key, () => api.revisePlan(item.conversation.id, 'Perlu perbaikan sebelum diterima'))}>
                    <RefreshCw size={13} /> Minta revisi
                  </button>
                </div>
              )}
              {item.kind === 'failed-run' && task && (
                <>
                  <form className="approval-notes" onSubmit={(e) => {
                    e.preventDefault()
                    if (!notes.trim()) return
                    void run(item.key, () => api.revisePlan(task.conversation_id ?? 0, notes.trim()))
                  }}>
                    <input aria-label={`Catatan revisi ${task.id}`} value={notes} onChange={(e) => setNotes(e.target.value)}
                           placeholder="Arahan perbaikan untuk pimpinan…" />
                    <button className="secondary-button compact" type="submit" disabled={busy === item.key}>
                      <RefreshCw size={13} /> Revisi
                    </button>
                  </form>
                  <div className="approval-actions">
                    <button className="primary-button compact" disabled={busy === item.key}
                            title="Lanjutkan dari yang sudah selesai: langkah gagal diulang, hasil lain dipertahankan"
                            onClick={() => void run(item.key, () => api.resumeTask(task.id))}>
                      <RefreshCw size={13} /> Lanjutkan
                    </button>
                    <button className="secondary-button compact" disabled={busy === item.key}
                            onClick={() => void run(item.key, () => api.qcRerun(task.id))}>
                      <ShieldCheck size={13} /> QC ulang
                    </button>
                    <button className="secondary-button compact" disabled={busy === item.key}
                            onClick={() => void run(item.key, () => api.stopTask(task.id))}>
                      <X size={13} /> Tutup
                    </button>
                  </div>
                </>
              )}
              {item.kind === 'stuck-step' && task && (
                <div className="approval-actions">
                  <select aria-label={`Pengganti langkah ${task.id}`} value={reassign[task.id] ?? ''}
                          onChange={(e) => setReassign((cur) => ({ ...cur, [task.id]: e.target.value }))}>
                    <option value="">Pilih pengganti…</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}
                  </select>
                  <button className="primary-button compact" disabled={busy === item.key || !reassign[task.id]}
                          onClick={() => void run(item.key, () => api.reassignTask(task.id, Number(reassign[task.id]), notes.trim()))}>
                    <UserRoundCog size={13} /> Alihkan
                  </button>
                  {task.parent_id != null && (
                    <button className="secondary-button compact" disabled={busy === item.key}
                            title="Ulangi langkah ini dengan pemilik yang sama; langkah selesai dipertahankan"
                            onClick={() => void run(item.key, () => api.resumeTask(task.parent_id as number))}>
                      <RefreshCw size={13} /> Lanjutkan
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {items.some((item) => item.kind === 'failed-run') && (
        <p className="approvals-hint">Catatan yang kamu tulis dipakai saat menekan Revisi.</p>
      )}
    </section>
  )
}

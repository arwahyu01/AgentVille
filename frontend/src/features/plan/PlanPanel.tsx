import { useEffect, useState } from 'react'
import { PencilLine, Workflow, X } from 'lucide-react'
import { api } from '../../lib/api'
import type { Conversation, PlanInfo } from '../../types'

const REVISABLE = ['clarifying', 'awaiting_approval', 'approved', 'queued', 'running', 'awaiting_acceptance']

/** Read-only view of the plan the leader is executing. Approval is automatic, so this panel
 * explains the delegation instead of gating it; the only action is a revision request. */
export default function PlanPanel({ conversation, refreshKey, onAction, onError }: {
  conversation: Conversation | null
  refreshKey: number
  onAction: () => void
  onError: (message: string) => void
}) {
  const [plan, setPlan] = useState<PlanInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [reviseNotes, setReviseNotes] = useState('')
  const [showRevise, setShowRevise] = useState(false)

  const conversationId = conversation?.id ?? null
  const conversationStatus = conversation?.status ?? null

  useEffect(() => {
    if (conversationId == null) {
      setPlan(null)
      return
    }
    let cancelled = false
    void api.conversationPlan(conversationId)
      .then((info) => { if (!cancelled) setPlan(info) })
      .catch(() => { if (!cancelled) setPlan(null) })
    return () => { cancelled = true }
  }, [conversationId, refreshKey, conversationStatus])

  if (conversation == null) return null
  const current = plan?.current ?? null
  const canRevise = REVISABLE.includes(conversation.status)

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onAction()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Aksi rencana gagal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="plan-panel" data-testid="plan-panel">
      <div className="panel-heading small">
        <div><h3><Workflow size={14} /> Rencana kerja</h3><p>{plan?.current?.workflow ? 'Alur baku · Anda menyetujui rencana dan hasil akhir.' : 'Disetujui otomatis oleh pimpinan · langkah dibagi per tupoksi.'}</p></div>
      </div>
      {current == null && <p className="plan-empty">Belum ada rencana — pimpinan masih mengklarifikasi permintaan.</p>}
      {current && (
        <div className="plan-body">
          <div className="plan-meta">
            <strong>v{current.version}</strong>
            <span className={`status-pill ${current.status === 'proposed' ? 'queued' : current.status}`}>{current.status}</span>
            {current.summary && <span className="plan-summary">{current.summary}</span>}
          </div>
          <ol className="plan-steps">
            {current.steps.map((step, index) => (
              <li key={index}>
                <strong>{index}. {step.title}</strong>
                <span>{step.instruction}</span>
                <em>{step.agent_role}{step.reviewer_role ? ` → diperiksa ${step.reviewer_role}` : ''}{step.deliverable ? ` · hasil: ${step.deliverable}` : ''}{step.uses_tools ? ' · menulis file' : ''}{step.depends_on.length ? ` · setelah ${step.depends_on.join(', ')}` : ''}</em>
                {step.acceptance_criteria && step.acceptance_criteria.length > 0 && (
                  <ul className="plan-criteria">{step.acceptance_criteria.map((c) => <li key={c}>{c}</li>)}</ul>
                )}
              </li>
            ))}
          </ol>
          {plan && plan.history.length > 1 && (
            <small className="plan-history">Versi lama: {plan.history.filter((h) => h.version !== current.version).map((h) => `v${h.version} (${h.status})`).join(', ')}</small>
          )}
          {canRevise && !showRevise && (
            <div className="plan-actions">
              <button className="secondary-button compact" disabled={busy} onClick={() => setShowRevise(true)}>
                <PencilLine size={14} /> Minta revisi
              </button>
            </div>
          )}
          {canRevise && showRevise && (
            <form className="plan-revise" onSubmit={(e) => {
              e.preventDefault()
              if (!reviseNotes.trim()) return
              void act(async () => { await api.revisePlan(conversation.id, reviseNotes.trim()); setShowRevise(false); setReviseNotes('') })
            }}>
              <input aria-label="Catatan revisi" autoFocus value={reviseNotes} onChange={(e) => setReviseNotes(e.target.value)}
                     placeholder="Apa yang harus diubah?" />
              <button className="primary-button compact" type="submit" disabled={busy || !reviseNotes.trim()}>Kirim</button>
              <button className="icon-button small" type="button" onClick={() => setShowRevise(false)}><X size={14} /></button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

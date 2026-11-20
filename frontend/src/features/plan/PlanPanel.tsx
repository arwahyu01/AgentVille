import { useEffect, useState } from 'react'
import { PencilLine, Workflow, X } from 'lucide-react'
import { api } from '../../lib/api'
import type { Conversation, PlanInfo } from '../../types'

const REVISABLE = ['clarifying', 'awaiting_approval', 'approved', 'queued', 'running']

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
        <div><h3><Workflow size={14} /> Rencana kerja</h3><p>Disetujui otomatis oleh pimpinan · tindakan eksternal menunggu keputusanmu.</p></div>
      </div>
      {current == null && <p className="plan-empty">Belum ada rencana — pimpinan masih mengklarifikasi permintaan.</p>}
      {current && (
        <div className="plan-body">
          <div className="plan-meta">
            <strong>v{current.version}</strong>
            <span className={`status-pill ${current.status === 'proposed' ? 'queued' : current.status}`}>{current.status}</span>
            {current.summary && <span className="plan-summary">{current.summary}</span>}
          </div>
          {current.requires_approval && conversation.status === 'awaiting_approval' && (
            <div className="plan-gate">
              <strong>Butuh persetujuanmu sebelum jalan</strong>
              <ul>{(current.approval_reasons ?? []).map((reason) => <li key={reason}>{reason}</li>)}</ul>
              <button className="primary-button compact" disabled={busy}
                      onClick={() => void act(() => api.approvePlan(conversation.id, current.version))}>
                Setujui rencana v{current.version}
              </button>
            </div>
          )}
          {current.goal && <p className="plan-goal"><strong>Tujuan:</strong> {current.goal}</p>}
          {current.scope && <p className="plan-scope"><strong>Batas kerja:</strong> {current.scope}</p>}
          {current.assumptions && current.assumptions.length > 0 && (
            <p className="plan-note"><strong>Asumsi:</strong> {current.assumptions.join('; ')}</p>
          )}
          {current.risks && current.risks.length > 0 && (
            <p className="plan-note"><strong>Risiko:</strong> {current.risks.join('; ')}</p>
          )}
          {current.external_actions && current.external_actions.length > 0 && (
            <p className="plan-note"><strong>Tindakan eksternal:</strong> {current.external_actions.join('; ')}</p>
          )}
          <ol className="plan-steps">
            {current.steps.map((step, index) => (
              <li key={index}>
                <strong>{index}. {step.title}</strong>
                <span>{step.instruction}</span>
                <em>
                  {step.agent_role}
                  {step.risk && step.risk !== 'low' ? ` · risiko ${step.risk}` : ''}
                  {step.uses_tools ? ' · menulis file' : ''}
                  {step.tools && step.tools.length > 0 ? ` · tools: ${step.tools.join(', ')}` : ''}
                  {step.depends_on.length ? ` · setelah ${step.depends_on.join(', ')}` : ''}
                </em>
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

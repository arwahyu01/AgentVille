import { useEffect, useState } from 'react'
import { CheckCircle2, PencilLine, Workflow, X } from 'lucide-react'
import { api } from '../../lib/api'
import type { Conversation, PlanInfo } from '../../types'

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

  useEffect(() => {
    if (conversation == null) {
      setPlan(null)
      return
    }
    let cancelled = false
    void api.conversationPlan(conversation.id)
      .then((info) => { if (!cancelled) setPlan(info) })
      .catch(() => { if (!cancelled) setPlan(null) })
    return () => { cancelled = true }
  }, [conversation?.id, refreshKey, conversation?.status])

  if (conversation == null) return null
  const current = plan?.current ?? null
  const awaiting = conversation.status === 'awaiting_approval'

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onAction()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Plan action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="plan-panel" data-testid="plan-panel">
      <div className="panel-heading small">
        <div><h3><Workflow size={14} /> Plan</h3><p>Nothing executes until you approve the current version.</p></div>
      </div>
      {current == null && <p className="plan-empty">No proposal yet — the Coordinator is still clarifying the request.</p>}
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
                <em>{step.agent_role}{step.uses_tools ? ' · writes files' : ''}{step.depends_on.length ? ` · needs ${step.depends_on.join(', ')}` : ''}</em>
                {step.acceptance_criteria && step.acceptance_criteria.length > 0 && (
                  <ul className="plan-criteria">{step.acceptance_criteria.map((c) => <li key={c}>{c}</li>)}</ul>
                )}
              </li>
            ))}
          </ol>
          {plan && plan.history.length > 1 && (
            <small className="plan-history">Superseded versions: {plan.history.filter((h) => h.version !== current.version).map((h) => `v${h.version} (${h.status})`).join(', ')}</small>
          )}
          {awaiting && !showRevise && (
            <div className="plan-actions">
              <button className="primary-button compact" disabled={busy}
                      onClick={() => void act(() => api.approvePlan(conversation.id, current.version))}>
                <CheckCircle2 size={14} /> Approve v{current.version}
              </button>
              <button className="secondary-button compact" disabled={busy} onClick={() => setShowRevise(true)}>
                <PencilLine size={14} /> Request revision
              </button>
            </div>
          )}
          {awaiting && showRevise && (
            <form className="plan-revise" onSubmit={(e) => {
              e.preventDefault()
              if (!reviseNotes.trim()) return
              void act(async () => { await api.revisePlan(conversation.id, reviseNotes.trim()); setShowRevise(false); setReviseNotes('') })
            }}>
              <input aria-label="Revision notes" autoFocus value={reviseNotes} onChange={(e) => setReviseNotes(e.target.value)}
                     placeholder="What should the Coordinator change?" />
              <button className="primary-button compact" type="submit" disabled={busy || !reviseNotes.trim()}>Send</button>
              <button className="icon-button small" type="button" onClick={() => setShowRevise(false)}><X size={14} /></button>
            </form>
          )}
          {!awaiting && conversation.status === 'clarifying' &&
            <button className="secondary-button compact" disabled={busy}
                    onClick={() => void act(() => api.cancelConversation(conversation.id))}>Cancel request</button>}
        </div>
      )}
    </div>
  )
}

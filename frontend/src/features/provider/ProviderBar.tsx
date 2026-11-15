import { useEffect, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { api } from '../../lib/api'
import type { AiConfig, ProviderName } from '../../types'

function Availability({ info, name }: { info?: { available: boolean; reason: string | null }; name: string }) {
  if (!info) return null
  return (
    <span className={`provider-badge ${info.available ? 'ok' : 'down'}`} title={info.reason ?? undefined}>
      {name} {info.available ? 'ready' : 'missing'}
    </span>
  )
}

export default function ProviderBar({ config, onConfig }: { config: AiConfig | null; onConfig: (next: AiConfig) => void }) {
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const provider: ProviderName = config?.provider ?? 'opencode'
  const model = provider === 'qoder' ? config?.ai_model_qoder ?? ''
    : provider === 'claude' ? config?.ai_model_claude ?? '' : config?.ai_model ?? ''

  useEffect(() => {
    if (!config?.ai_enabled) return
    let cancelled = false
    void api.aiModels(provider)
      .then((d) => { if (!cancelled) setModels(d.models) })
      .catch(() => { if (!cancelled) setModels([]) })
    return () => { cancelled = true }
  }, [config?.ai_enabled, provider])

  async function patch(payload: Partial<AiConfig>) {
    setBusy(true)
    try {
      onConfig(await api.patchAiConfig(payload))
    } catch {
      // backend surfaces via the connection indicator
    } finally {
      setBusy(false)
    }
  }

  if (config == null) return null
  const selected = models.includes(model) ? model : ''
  return (
    <section className="panel ai-bar provider-bar">
      <div className="ai-bar-inner">
        <BrainCircuit size={17} className="ai-bar-icon" />
        <strong>AI Engine</strong>
        <label className="ai-toggle">
          <input type="checkbox" aria-label="AI enabled" checked={config.ai_enabled} disabled={busy}
                 onChange={(e) => void patch({ ai_enabled: e.target.checked })} />
          {config.ai_enabled ? 'Running' : 'Off'}
        </label>
        <div className="ai-model-field">
          <span>Provider</span>
          <select aria-label="AI provider" disabled={busy} value={provider}
                  onChange={(e) => void patch({ provider: e.target.value as ProviderName })}>
            <option value="opencode">opencode (text)</option>
            <option value="qoder">qoder (text + coding)</option>
            <option value="claude">claude code (text + coding)</option>
          </select>
          <Availability info={config.providers?.[provider]} name={provider} />
        </div>
        <div className="ai-model-field">
          <span>Model</span>
          {models.length > 0 ? (
            <select aria-label="AI model" disabled={busy || !config.ai_enabled} value={selected}
                    onChange={(e) => void patch(provider === 'qoder' ? { ai_model_qoder: e.target.value }
                      : provider === 'claude' ? { ai_model_claude: e.target.value } : { ai_model: e.target.value })}>
              {selected === '' && <option value="" disabled>{model} (from settings)</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <code>{model}</code>
          )}
        </div>
        <div className="ai-model-field">
          <span>QC retries</span>
          <input aria-label="QC retries" type="number" min={0} max={3} disabled={busy} value={config.retry_max}
                 onChange={(e) => void patch({ retry_max: Number(e.target.value) })} />
        </div>
        <label className="ai-toggle">
          <input type="checkbox" aria-label="Provider fallback" checked={config.fallback_enabled} disabled={busy}
                 onChange={(e) => void patch({ fallback_enabled: e.target.checked })} />
          Fallback
        </label>
        <div className="ai-model-field">
          <span>Percakapan agen</span>
          <select aria-label="Agent chat mode" disabled={busy} value={config.agent_chat_mode ?? 'static'}
                  title="Statis = gratis. Milestone = AI hanya saat handoff/eskalasi/QC. Semua = setiap pesan."
                  onChange={(e) => void patch({ agent_chat_mode: e.target.value as AiConfig['agent_chat_mode'] })}>
            <option value="static">Statis · 0 token</option>
            <option value="milestone">Real saat momen penting</option>
            <option value="full">Real untuk semua pesan</option>
          </select>
        </div>
        <div className="ai-model-field">
          <span>Timeout s</span>
          <input aria-label="AI timeout" type="number" min={10} max={1800} disabled={busy} value={config.ai_timeout_s}
                 onChange={(e) => void patch({ ai_timeout_s: Number(e.target.value) })} />
        </div>
        <small className="ai-bar-note">
          {provider === 'qoder'
            ? 'qodercli runs coding steps inside the confined workspace'
            : provider === 'claude'
              ? 'claude -p runs steps with your Claude Code login; coding steps use acceptEdits inside the workspace'
              : 'opencode CLI is text-only here; coding steps route to qodercli'}
        </small>
      </div>
    </section>
  )
}

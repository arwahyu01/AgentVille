import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, Loader2, Maximize2, PlaySquare, RefreshCw } from 'lucide-react'
import { API_BASE } from '../../lib/api'
import { statusLabel } from '../../lib/status'
import type { Agent, Task, TaskResult } from '../../types'

/**
 * The deliverable, front and centre. If the crew built a site, it runs here; if it made
 * an image, it is on screen; a video plays inline. Process chatter lives elsewhere —
 * this panel answers the only question that matters: what did I get?
 */
export default function ResultStage({ task, result, agents, loading }: {
  task: Task | null
  result: TaskResult | null
  agents: Agent[]
  loading: boolean
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const [doc, setDoc] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)

  const preview = result?.preview ?? null
  const kind = preview?.kind ?? 'none'
  const url = preview?.url ? `${API_BASE}${preview.url}` : ''
  const owner = task ? agents.find((agent) => agent.id === task.agent_id) : undefined
  const steps = result?.children ?? []
  const done = steps.filter((step) => step.status === 'completed').length

  const docKind = preview?.kind

  useEffect(() => {
    setDoc('')
    if ((docKind !== 'markdown' && docKind !== 'text') || !url) return
    let cancelled = false
    void fetch(url)
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => { if (!cancelled) setDoc(text) })
      .catch(() => { if (!cancelled) setDoc('') })
    return () => { cancelled = true }
  }, [docKind, url])

  if (task == null) {
    return (
      <section className="panel stage-panel empty" data-testid="result-stage">
        <div className="stage-empty">
          <FileText size={30} />
          <strong>Belum ada pekerjaan</strong>
          <p>Tulis perintah di atas — misalnya “buatkan landing page kopi” — dan hasilnya akan tampil di sini.</p>
        </div>
      </section>
    )
  }

  const active = ['approved', 'queued', 'running', 'reviewing'].includes(task.status)
  const opens = kind === 'web' || kind === 'image' || kind === 'video'

  return (
    <section className="panel stage-panel" data-testid="result-stage">
      <div className="stage-head">
        <div className="stage-title">
          <span className={`stage-kind ${kind}`}>{kindLabel(kind)}</span>
          <div>
            <h2>{task.title}</h2>
            <p>
              #{task.id}
              {owner ? ` · ${owner.name} (${owner.role})` : ' · pimpinan kantor'}
              {steps.length > 0 ? ` · ${done}/${steps.length} langkah` : ''}
              {preview?.entry ? ` · ${preview.entry}` : ''}
            </p>
          </div>
        </div>
        <div className="stage-actions">
          <span className={`status-pill ${task.status}`}>{statusLabel[task.status]}</span>
          {kind === 'web' && (
            <>
              <button className="icon-button small" title="Muat ulang hasil" onClick={() => setReloadKey((k) => k + 1)}>
                <RefreshCw size={14} />
              </button>
              <button className="icon-button small" title="Layar penuh"
                      onClick={() => void frame.current?.requestFullscreen?.()}>
                <Maximize2 size={14} />
              </button>
            </>
          )}
          {opens && (
            <a className="icon-button small" title="Buka di tab baru" href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>

      <div className={`stage-body ${kind}`}>
        {loading && <div className="stage-loading"><Loader2 size={18} className="spin" /> Memuat hasil…</div>}

        {!loading && kind === 'web' && (
          <iframe
            key={reloadKey}
            ref={frame}
            className="stage-frame"
            title={`Hasil: ${task.title}`}
            src={`${url}${url.includes('?') ? '&' : '?'}v=${reloadKey}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        )}

        {!loading && kind === 'image' && <img className="stage-image" src={`${url}?v=${reloadKey}`} alt={`Hasil: ${task.title}`} />}

        {!loading && kind === 'video' && (
          <div className="stage-video">
            <video controls preload="metadata" src={url} />
            <a href={url} target="_blank" rel="noreferrer"><PlaySquare size={13} /> Buka video</a>
          </div>
        )}

        {!loading && (kind === 'markdown' || kind === 'text') && (
          <pre className="stage-doc">{doc || result?.result || 'Dokumen kosong.'}</pre>
        )}

        {!loading && kind === 'none' && <IdleStage result={result} active={active} done={done} steps={steps.length} />}
      </div>

      {result && result.qc_reviews && result.qc_reviews.length > 0 && (
        <div className="stage-foot">
          <span>QC: {result.qc_reviews.at(-1)?.verdict ?? '—'}</span>
          {result.diff_path && <span className="stage-diff">diff: {result.diff_path}</span>}
        </div>
      )}
    </section>
  )
}

function IdleStage({ result, active, done, steps }: {
  result: TaskResult | null
  active: boolean
  done: number
  steps: number
}) {
  if (active) {
    const pct = steps > 0 ? Math.round((done / steps) * 100) : 8
    return (
      <div className="stage-progress">
        <div className="stage-pulse" />
        <strong>Kru sedang mengerjakan…</strong>
        <p>
          {steps > 0
            ? `${done} dari ${steps} langkah selesai. Hasil akan muncul otomatis begitu siap.`
            : 'Rencana sedang disusun dan diutus ke spesialis.'}
        </p>
        <div className="progress-track"><span style={{ width: `${pct}%` }} /></div>
        {result?.result && <pre className="stage-doc partial">{result.result}</pre>}
      </div>
    )
  }
  return (
    <pre className="stage-doc">{result?.result || 'Tidak ada hasil tersimpan untuk pekerjaan ini.'}</pre>
  )
}

function kindLabel(kind: string): string {
  if (kind === 'web') return 'WEB'
  if (kind === 'image') return 'GAMBAR'
  if (kind === 'video') return 'VIDEO'
  if (kind === 'markdown') return 'DOKUMEN'
  if (kind === 'text') return 'FILE'
  return 'PROSES'
}

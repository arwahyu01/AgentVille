import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, Eye, Send, Server, Trash2, UploadCloud } from 'lucide-react'
import { api } from '../../lib/api'
import type { PublishStatus, ScheduleStatus } from '../../types'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function PublishPanel({ onError }: { onError: (message: string) => void }) {
  const [status, setStatus] = useState<PublishStatus | null>(null)
  const [schedule, setSchedule] = useState<ScheduleStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [dryPrompt, setDryPrompt] = useState('')

  const [cred, setCred] = useState({ credential_id: 0, name: 'dry24',
    cli_project: '', cli_php: 'php', field_map: '' })
  const [provider, setProvider] = useState<'dry24' | 'instagram'>('dry24')
  const [credentialId, setCredentialId] = useState<number | ''>('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [article, setArticle] = useState({ title: '', content: '', excerpt: '', slug: '',
    status: 'draft', tanggal: '', media_url: '', caption: '' })

  const load = useCallback(async () => {
    try {
      const [publishData, scheduleData] = await Promise.all([api.publishStatus(), api.publishSchedule()])
      setStatus(publishData)
      setSchedule(scheduleData)
      if (!credentialId && publishData.credentials.length) setCredentialId(publishData.credentials[0].id)
      if (!accountId && publishData.instagram_accounts.length) setAccountId(publishData.instagram_accounts[0].id)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Gagal memuat status publikasi')
    }
  }, [credentialId, accountId, onError])

  useEffect(() => { void load() }, [load])

  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    try {
      await task()
      onError('')
      await load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Operasi gagal')
    } finally {
      setBusy(false)
    }
  }

  function parseJson(text: string, label: string): Record<string, string> {
    if (!text.trim()) return {}
    try {
      const value = JSON.parse(text)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bukan objek')
      return value
    } catch {
      throw new Error(`${label} harus JSON objek, mis. {"judul":"title"}`)
    }
  }

  function buildArticle(): Record<string, string> {
    const base: Record<string, string> = {
      title: article.title, content: article.content, excerpt: article.excerpt,
      slug: article.slug, status: article.status,
    }
    if (provider === 'dry24') {
      base.tanggal = article.tanggal
      base.media_url = article.media_url
    } else {
      base.caption = article.caption || article.title
      base.media_url = article.media_url
    }
    return Object.fromEntries(Object.entries(base).filter(([, v]) => v.trim() !== ''))
  }

  return (
    <section className="panel rail-publish" aria-labelledby="publish-title">
      <div className="panel-heading">
        <div><h2 id="publish-title"><UploadCloud size={15} /> Publikasi & Berita</h2>
          <p>Draf berita harian + publish dengan persetujuan.</p></div>
        <button className="icon-button small" aria-label="Muat ulang publikasi" disabled={busy}
                onClick={() => void load()}><CalendarClock size={14} /></button>
      </div>

      <div className="publish-body">
        <div className="publish-notice"><CheckCircle2 size={14} />
          <span>Tidak ada auto-post. Setiap kirim butuh <strong>Setujui</strong> lalu <strong>Kirim sekarang</strong>. dry24 memakai CLI lokal — tanpa token, port, atau HTTP.</span>
        </div>

        <details className="publish-section" open>
          <summary><CalendarClock size={13} /> Jadwal berita harian</summary>
          {schedule && (
            <div className="publish-fields">
              <label className="publish-toggle">
                <input type="checkbox" checked={schedule.enabled} disabled={busy}
                       onChange={(e) => void run(async () => {
                         await api.publishPatchSchedule({ ...schedule, enabled: e.target.checked })
                       })} />
                Aktif
              </label>
              <label>Jam (waktu lokal)
                <select value={schedule.hour} disabled={busy}
                        onChange={(e) => void run(async () => {
                          await api.publishPatchSchedule({ ...schedule, hour: Number(e.target.value) })
                        })}>
                  {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </label>
              <label>Maksimal item
                <input type="number" min={1} max={10} value={schedule.max_items} disabled={busy}
                       onChange={(e) => setSchedule({ ...schedule, max_items: Number(e.target.value) })} />
              </label>
              <label>Topik (dipisah koma)
                <textarea rows={2} maxLength={500} value={schedule.topics} disabled={busy}
                          onChange={(e) => setSchedule({ ...schedule, topics: e.target.value })} />
              </label>
              <button disabled={busy} onClick={() => void run(async () => {
                await api.publishPatchSchedule(schedule)
              })}>Simpan jadwal</button>
              <button disabled={busy} onClick={() => void run(async () => {
                const result = await api.publishScheduleDryRun()
                setDryPrompt(result.prompt ?? result.reason)
              })}>Lihat prompt (dry-run)</button>
              {dryPrompt && <pre className="publish-prompt">{dryPrompt}</pre>}
              {schedule.runs.length > 0 && (
                <div className="publish-runs">
                  <strong>Riwayat jadwal</strong>
                  {schedule.runs.slice(0, 8).map((r) => (
                    <div key={r.id} className="publish-run">
                      <span>{r.run_date}</span><span className={`publish-tag ${r.status}`}>{r.status}</span>
                      {r.conversation_id && <span>#conv {r.conversation_id}</span>}
                      {r.error && <span className="publish-error">{r.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </details>

        <details className="publish-section">
          <summary><Server size={13} /> Jembatan CLI dry24</summary>
          <div className="publish-fields">
            <p className="publish-hint">AgentVille dan dry24 ada di server yang sama. AgentVille menjalankan <code>{status?.preset.command ?? 'php artisan berita:publish --payload=-'}</code> di folder project dry24 — <strong>tanpa API, token, atau port tambahan</strong>. Kredensial DB tetap di <code>.env</code> dry24 dan tidak pernah dibaca AgentVille.</p>
            <button disabled={busy} onClick={() => void run(async () => {
              const saved = await api.publishInstallPreset()
              setCredentialId(saved.id)
              setCred({ credential_id: saved.id, name: saved.name,
                cli_project: saved.cli_project, cli_php: saved.cli_php,
                field_map: JSON.stringify(saved.field_map, null, 2) })
            })}>Pasang preset dry24.id</button>
            <label>Nama
              <input value={cred.name} maxLength={80} onChange={(e) => setCred({ ...cred, name: e.target.value })} />
            </label>
            <label>Lokasi project dry24 (folder yang berisi `artisan`)
              <input value={cred.cli_project} maxLength={500} placeholder="D:\\Aplikasi\\Project\\Web\\dry24-develop"
                     onChange={(e) => setCred({ ...cred, cli_project: e.target.value })} />
            </label>
            <label>Binary PHP
              <input value={cred.cli_php} maxLength={300} placeholder="php atau path ke php.exe"
                     onChange={(e) => setCred({ ...cred, cli_php: e.target.value })} />
            </label>
            <label>Field map (JSON, opsional)
              <textarea rows={2} value={cred.field_map} placeholder='{"title":"judul","content":"isi"}'
                        onChange={(e) => setCred({ ...cred, field_map: e.target.value })} />
            </label>
            <button disabled={busy || !cred.cli_project.trim()} onClick={() => void run(async () => {
              const saved = await api.publishSaveCredential({ ...cred,
                credential_id: cred.credential_id || undefined,
                field_map: parseJson(cred.field_map, 'Field map') })
              setCredentialId(saved.id)
              setCred({ ...cred, credential_id: saved.id })
            })}>Simpan jembatan</button>
            {status?.credentials.map((c) => (
              <div className="publish-credential" key={c.id}>
                <div><strong>{c.name}</strong><small>{c.cli_project || 'lokasi belum diisi'}</small>
                  <small>PHP: {c.cli_php}</small></div>
                <div className="publish-credential-actions">
                  <button aria-label={`Edit ${c.name}`} disabled={busy} onClick={() => {
                    setCredentialId(c.id)
                    setCred({ credential_id: c.id, name: c.name,
                      cli_project: c.cli_project, cli_php: c.cli_php,
                      field_map: JSON.stringify(c.field_map, null, 2) })
                  }}>Edit</button>
                  <button aria-label={`Hapus ${c.name}`} disabled={busy}
                          onClick={() => void run(() => api.publishDeleteCredential(c.id))}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>

        <details className="publish-section" open>
          <summary><Eye size={13} /> Buat preview publish</summary>
          <div className="publish-fields">
            <label>Target
              <select value={provider} onChange={(e) => setProvider(e.target.value as 'dry24' | 'instagram')}>
                <option value="dry24">dry24 (CLI lokal)</option>
                <option value="instagram">Instagram</option>
              </select>
            </label>
            {provider === 'dry24' ? (
              <label>Kredensial
                <select value={credentialId} onChange={(e) => setCredentialId(Number(e.target.value))}>
                  <option value="">Pilih…</option>
                  {status?.credentials.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            ) : (
              <label>Akun Instagram
                <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                  <option value="">Pilih…</option>
                  {status?.instagram_accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </label>
            )}
            <label>Judul
              <input value={article.title} maxLength={200} onChange={(e) => setArticle({ ...article, title: e.target.value })} />
            </label>
            <label>Isi artikel
              <textarea rows={4} value={article.content} onChange={(e) => setArticle({ ...article, content: e.target.value })} />
            </label>
            {provider === 'instagram' ? (
              <>
                <label>Caption
                  <textarea rows={2} maxLength={2200} value={article.caption}
                            onChange={(e) => setArticle({ ...article, caption: e.target.value })} />
                </label>
                <label>URL gambar publik (media_url)
                  <input value={article.media_url} placeholder="https://…/gambar.jpg"
                         onChange={(e) => setArticle({ ...article, media_url: e.target.value })} />
                </label>
              </>
            ) : (
              <>
                <label>Tanggal terbit (kosongkan = sekarang)
                  <input value={article.tanggal} placeholder="2026-11-20 07:30:00"
                         onChange={(e) => setArticle({ ...article, tanggal: e.target.value })} />
                </label>
                <label>URL gambar sampul (opsional → gambar_url)
                  <input value={article.media_url} placeholder="https://…/gambar.jpg"
                         onChange={(e) => setArticle({ ...article, media_url: e.target.value })} />
                </label>
                <p className="publish-hint">dry24 tidak punya field draft/status/slug/ringkasan: slug dibuat otomatis dari judul dan berita langsung tayang setelah dikirim.</p>
              </>
            )}
            <button disabled={busy} onClick={() => void run(async () => {
              await api.publishPreview({ provider, article: buildArticle(),
                credential_id: provider === 'dry24' && credentialId ? Number(credentialId) : null,
                account_id: provider === 'instagram' && accountId ? Number(accountId) : null,
                title: article.title })
            })}>Buat preview</button>
          </div>
        </details>

        <div className="publish-section">
          <strong className="publish-subtitle">Antrean publish</strong>
          {status?.jobs.length === 0 && <p className="publish-empty">Belum ada job. Buat preview dulu.</p>}
          {status?.jobs.map((job) => (
            <div className="publish-job" key={job.id}>
              <div className="publish-job-head">
                <strong>{job.title || `Job #${job.id}`}</strong>
                <span className={`publish-tag ${job.status}`}>{job.status}</span>
              </div>
              <small>{job.provider} · dibuat {job.created_at ? new Date(job.created_at).toLocaleString('id-ID') : '—'}</small>
              {job.preview && <pre className="publish-preview">{JSON.stringify(job.preview, null, 2)}</pre>}
              {job.error && <small className="publish-error">{job.error}</small>}
              {job.response && <small>Balasan: {JSON.stringify(job.response).slice(0, 300)}</small>}
              <div className="publish-job-actions">
                {job.status === 'preview' && (
                  <button disabled={busy} onClick={() => void run(() => api.publishApprove(job.id))}>
                    <CheckCircle2 size={13} /> Setujui
                  </button>
                )}
                {job.status === 'approved' && (
                  <button className="publish-send" disabled={busy}
                          onClick={() => void run(() => api.publishExecute(job.id))}>
                    <Send size={13} /> Kirim sekarang
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

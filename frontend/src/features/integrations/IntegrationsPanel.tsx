import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Link2, RefreshCw, ShieldCheck, Trash2, Unplug } from 'lucide-react'
import { api } from '../../lib/api'
import type { IntegrationAccount, IntegrationProvider, IntegrationStatus } from '../../types'

const PLATFORMS: { id: IntegrationProvider; name: string; hint: string }[] = [
  { id: 'instagram', name: 'Instagram', hint: 'Akun bisnis Instagram (Butuh Facebook Page)' },
  { id: 'youtube', name: 'YouTube', hint: 'Channel YouTube lewat akun Google' },
  { id: 'meta_ads', name: 'Meta Ads', hint: 'Akun iklan Meta (Facebook/Instagram ads)' },
]

type Flow = { provider: IntegrationProvider; state: string; auth_url: string }

export default function IntegrationsPanel({ onError }: { onError: (message: string) => void }) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [flow, setFlow] = useState<Flow | null>(null)
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [tokenProvider, setTokenProvider] = useState<IntegrationProvider>('instagram')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setStatus(await api.integrationStatus())
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Gagal memuat integrasi')
    }
  }, [onError])

  useEffect(() => { void load() }, [load])

  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    try {
      await task()
      await load()
      onError('')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Operasi integrasi gagal')
    } finally {
      setBusy(false)
    }
  }

  async function startOAuth(provider: IntegrationProvider) {
    setFlow(null)
    setCode('')
    await run(async () => {
      const next = await api.integrationStart(provider)
      setFlow({ provider, state: next.state, auth_url: next.auth_url })
      window.open(next.auth_url, '_blank', 'noopener,noreferrer')
    })
  }

  function accountList(provider: IntegrationProvider): IntegrationAccount[] {
    return status?.accounts.filter((a) => a.provider === provider) ?? []
  }

  return (
    <section className="panel rail-integrations" aria-labelledby="integrations-title">
      <div className="panel-heading">
        <div><h2 id="integrations-title"><Link2 size={15} /> Integrasi Akun</h2>
          <p>Hubungkan Instagram, YouTube, dan Meta Ads.</p></div>
        <button className="icon-button small" aria-label="Muat ulang integrasi" disabled={busy}
                onClick={() => void load()}><RefreshCw size={14} /></button>
      </div>

      <div className="integration-body">
        <p className="integration-notice"><ShieldCheck size={14} />
          <span>Menyambung akun <strong>hanya menyimpan akses</strong>. Tidak ada posting, upload, atau iklan yang dijalankan otomatis — setiap aksi eksternal tetap butuh persetujuanmu.</span>
        </p>

        {status && status.storage !== 'dpapi' && (
          <p className="integration-warning">Penyimpanan token terenkripsi tidak tersedia di sistem ini (DPAPI hanya di Windows). Koneksi tidak bisa disimpan.</p>
        )}

        {PLATFORMS.map((platform) => {
          const configured = status?.configured[platform.id]
          const accounts = accountList(platform.id)
          return (
            <div className="integration-platform" key={platform.id}>
              <div className="integration-platform-head">
                <div>
                  <strong>{platform.name}</strong>
                  <small>{platform.hint}</small>
                </div>
                <span className={`provider-badge ${configured ? 'ok' : 'down'}`}>
                  {configured ? 'OAuth siap' : 'Perlu client ID'}
                </span>
              </div>

              {configured && (
                <button className="integration-connect" disabled={busy || status?.storage !== 'dpapi'}
                        onClick={() => void startOAuth(platform.id)}>
                  <ExternalLink size={13} /> Hubungkan lewat OAuth
                </button>
              )}

              {accounts.map((account) => (
                <div className="integration-account" key={account.id}>
                  <div className="integration-account-main">
                    <span className={`integration-dot ${account.status === 'connected' ? 'ok' : 'warn'}`} />
                    <div>
                      <strong>{account.label || `#${account.external_id}`}</strong>
                      <small>{account.status === 'connected' ? 'Terhubung' : account.status}
                        {account.verified_at ? ` · diverifikasi ${new Date(account.verified_at).toLocaleString('id-ID')}` : ''}</small>
                      {account.last_error && <small className="integration-error">{account.last_error}</small>}
                    </div>
                  </div>
                  <div className="integration-account-actions">
                    <button title="Periksa ulang koneksi" aria-label={`Verifikasi ${account.label}`}
                            disabled={busy} onClick={() => void run(() => api.integrationVerify(account.id))}>
                      <CheckCircle2 size={14} />
                    </button>
                    <button title="Putuskan koneksi" aria-label={`Putuskan ${account.label}`}
                            disabled={busy} onClick={() => void run(() => api.integrationDisconnect(account.id))}>
                      <Unplug size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        })}

        {flow && (
          <div className="integration-flow">
            <p>OAuth dibuka di tab baru. Salin kode dari halaman tersebut, lalu tempel di sini:</p>
            <div className="integration-field-row">
              <input aria-label="Kode OAuth" value={code} maxLength={512}
                     placeholder="Kode dari penyedia" onChange={(e) => setCode(e.target.value)} />
              <button disabled={busy || !code.trim()}
                      onClick={() => void run(async () => {
                        await api.integrationComplete(flow.provider, code.trim(), flow.state)
                        setFlow(null)
                        setCode('')
                      })}>Selesaikan</button>
            </div>
            <small>State sekali pakai · {flow.provider}</small>
          </div>
        )}

        <details className="integration-manual">
          <summary><Trash2 size={13} /> Simpan token manual (alternatif)</summary>
          <p>Token disimpan terenkripsi (DPAPI). Koneksi tetap diverifikasi lewat API baca-saja penyedia.</p>
          <div className="integration-field-row">
            <select aria-label="Platform token" value={tokenProvider}
                    onChange={(e) => setTokenProvider(e.target.value as IntegrationProvider)}>
              {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="password" aria-label="Access token" value={token} maxLength={8192}
                   placeholder="Access token" onChange={(e) => setToken(e.target.value)} />
            <button disabled={busy || !token.trim()} onClick={() => void run(async () => {
              await api.integrationSave({ provider: tokenProvider, access_token: token.trim() })
              setToken('')
            })}>Simpan</button>
          </div>
        </details>

        {!status && <p className="integration-warning">Belum bisa menghubungi backend integrasi.</p>}
      </div>
    </section>
  )
}

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { LockKeyhole, LogOut } from 'lucide-react'
import App from '../../App'
import { api } from '../../lib/api'
import type { AuthUser } from '../../types'

/** Gates the whole console behind one operator session. Tests render App directly. */
export default function AuthGate() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api.me().then((current) => { if (alive) setUser(current) }).catch(() => { if (alive) setUser(null) })
    const expired = () => setUser(null)
    window.addEventListener('agentville:unauthorized', expired)
    return () => { alive = false; window.removeEventListener('agentville:unauthorized', expired) }
  }, [])

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const current = await api.login(username.trim(), password)
      setPassword('')
      setUser(current)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal masuk')
    } finally {
      setBusy(false)
    }
  }, [username, password])

  const logout = useCallback(async () => {
    try { await api.logout() } catch { /* local logout still clears the view */ }
    setUser(null)
  }, [])

  if (user === undefined) {
    return <div className="auth-screen"><div className="auth-card"><p>Memeriksa sesi…</p></div></div>
  }

  if (user === null) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={(event) => void submit(event)}>
          <div className="auth-mark"><LockKeyhole size={22} /></div>
          <h1>AgentVille</h1>
          <p className="auth-sub">Kantor AI Anda. Masuk untuk mengakses konsol.</p>
          <label htmlFor="auth-username">Username</label>
          <input id="auth-username" name="username" autoComplete="username"
                 value={username} onChange={(e) => setUsername(e.target.value)}
                 placeholder="nama@domain" required autoFocus />
          <label htmlFor="auth-password">Kata sandi</label>
          <input id="auth-password" name="password" type="password" autoComplete="current-password"
                 value={password} onChange={(e) => setPassword(e.target.value)}
                 placeholder="••••••••" required />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={busy}>
            {busy ? 'Memeriksa…' : 'Masuk'}
          </button>
          <p className="auth-note">Sesi tersimpan dalam cookie HttpOnly. Semua permintaan API dilindungi.</p>
        </form>
      </div>
    )
  }

  return (
    <>
      <App />
      <button className="auth-logout" type="button" onClick={() => void logout()}
              title={`Masuk sebagai ${user.username}`}>
        <LogOut size={14} /> Keluar
      </button>
    </>
  )
}

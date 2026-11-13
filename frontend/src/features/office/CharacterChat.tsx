import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { CharacterChatTurn } from '../../types'

export interface CharacterAiMeta {
  mode: 'ai' | 'local'
  provider?: string
  model?: string
}

interface Line {
  from: 'character' | 'visitor' | 'system'
  text: string
}

interface Props {
  /** Whitelisted backend key, e.g. `agent:3` or `staff:greeter`. */
  character: string
  intro: string
  suggestions: string[]
  placeholder: string
  /** Honest answer built from local state when AI is off or unreachable. */
  offlineReply: (question: string) => string
  onMeta?: (meta: CharacterAiMeta) => void
}

const HISTORY_TURNS = 8
const CLIENT_TIMEOUT_MS = 100_000

/** Shared Q&A box for the people in the scene. The backend owns the persona and the live
 *  office context; this component only carries the transcript, a thinking state and a local
 *  fallback so a character still answers sensibly when AI is disabled. */
export function CharacterChat({ character, intro, suggestions, placeholder, offlineReply, onMeta }: Props) {
  const [lines, setLines] = useState<Line[]>([{ from: 'character', text: intro }])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [meta, setMeta] = useState<CharacterAiMeta | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const pendingRef = useRef(false)
  const mounted = useRef(true)
  const abort = useRef<AbortController | null>(null)
  const notified = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abort.current?.abort()
    }
  }, [])

  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, pending])

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || pendingRef.current) return
    const history: CharacterChatTurn[] = lines
      .filter((line) => line.from !== 'system')
      .slice(-HISTORY_TURNS)
      .map((line) => ({ role: line.from === 'visitor' ? 'visitor' : 'character', text: line.text }))
    const alreadyLocal = meta?.mode === 'local'
    setLines((prev) => [...prev, { from: 'visitor', text: question }])
    setDraft('')
    pendingRef.current = true
    setPending(true)

    const controller = new AbortController()
    abort.current = controller
    const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)
    try {
      const result = await api.characterChat(character, question, history, controller.signal)
      if (!mounted.current) return
      setLines((prev) => [...prev, { from: 'character', text: result.reply }])
      const next: CharacterAiMeta = { mode: 'ai', provider: result.provider, model: result.model }
      setMeta(next)
      onMeta?.(next)
    } catch (error) {
      if (!mounted.current) return
      console.warn('Character chat fell back to a local answer', error)
      const showNotice = !alreadyLocal && !notified.current
      if (showNotice) notified.current = true
      setLines((prev) => {
        const reply: Line = { from: 'character', text: offlineReply(question) }
        if (!showNotice) return [...prev, reply]
        return [...prev, reply, {
          from: 'system',
          text: 'AI belum aktif atau tidak bisa dihubungi. Jawaban ini dari data lokal — aktifkan AI di panel AI Engine untuk percakapan penuh.',
        }]
      })
      const next: CharacterAiMeta = { mode: 'local' }
      setMeta(next)
      onMeta?.(next)
    } finally {
      window.clearTimeout(timer)
      abort.current = null
      if (mounted.current) {
        pendingRef.current = false
        setPending(false)
      }
    }
  }

  return (
    <>
      <div className="dialog-chat" role="log" aria-live="polite" ref={log}>
        {lines.map((line, index) => (
          <p key={index} className={`dialog-msg ${line.from}`}>{line.text}</p>
        ))}
        {pending && (
          <p className="dialog-msg character pending" aria-label="Karakter sedang mengetik">
            <span /><span /><span />
          </p>
        )}
      </div>
      <div className="dialog-suggestions">
        {suggestions.map((suggestion) => (
          <button key={suggestion} type="button" disabled={pending} onClick={() => void send(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
      <form className="dialog-compose" onSubmit={(e) => { e.preventDefault(); void send(draft) }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus
          disabled={pending}
        />
        <button type="submit" disabled={!draft.trim() || pending}>{pending ? '…' : 'Kirim'}</button>
      </form>
    </>
  )
}

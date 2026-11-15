import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { api } from '../../lib/api'
import type { ChatMessage, Conversation } from '../../types'

const STATUS_HINTS: Record<string, string> = {
  clarifying: 'Pimpinan akan membalas sebentar lagi…',
  awaiting_approval: 'Rencana lama menunggu keputusanmu — setujui di panel Butuh Persetujuan.',
  approved: 'Rencana disetujui — pekerjaan masuk antrean.',
  queued: 'Menunggu giliran dieksekusi.',
  running: 'Para spesialis sedang bekerja.',
  reviewing: 'QC sedang memeriksa hasil.',
  completed: 'Selesai. Kirim permintaan baru untuk pekerjaan lain.',
  failed: 'Pekerjaan berhenti — lihat panel Butuh Persetujuan.',
  cancelled: 'Dibatalkan.',
}

export default function ChatPanel({ conversation, refreshKey, onSent, onError }: {
  conversation: Conversation | null
  refreshKey: number
  onSent: () => void
  onError: (message: string) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (conversation == null) {
      setMessages([])
      return
    }
    let cancelled = false
    void api.conversationMessages(conversation.id)
      .then((rows) => { if (!cancelled) setMessages(rows) })
      .catch(() => { if (!cancelled) setMessages([]) })
    return () => { cancelled = true }
  }, [conversation?.id, refreshKey, conversation?.status])

  const canSend = conversation?.status === 'clarifying'

  async function send(event: FormEvent) {
    event.preventDefault()
    if (conversation == null || !draft.trim()) return
    setBusy(true)
    try {
      await api.postConversationMessage(conversation.id, draft.trim())
      setDraft('')
      onSent()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not send message')
    } finally {
      setBusy(false)
    }
  }

  if (conversation == null) {
    return (
      <div className="chat-panel empty" data-testid="chat-panel">
        <MessageSquare size={22} />
        <p>No request selected. Start one to talk with the Coordinator.</p>
      </div>
    )
  }

  return (
    <div className="chat-panel" data-testid="chat-panel">
      <div className="chat-head">
        <strong>{conversation.title}</strong>
        <span className={`status-pill ${conversation.status}`}>{conversation.status.replaceAll('_', ' ')}</span>
      </div>
      <div className="chat-log">
        {messages.map((message) => (
          <div key={message.id} className={`chat-bubble ${message.role}`}>
            <span className="chat-who">{message.role === 'user' ? 'Kamu' : message.role === 'assistant' ? 'Atlas' : 'Sistem'}</span>
            <p>{message.content}</p>
          </div>
        ))}
      </div>
      <p className="chat-hint">{STATUS_HINTS[conversation.status] ?? ''}</p>
      <form className="chat-input" onSubmit={send}>
        <input aria-label="Message" value={draft} disabled={!canSend || busy}
               onChange={(e) => setDraft(e.target.value)}
               placeholder={canSend ? 'Jawab pertanyaan pimpinan…' : 'Chat hanya aktif saat klarifikasi'} />
        <button className="primary-button compact" type="submit" disabled={!canSend || busy || !draft.trim()}>
          <Send size={14} /> Kirim
        </button>
      </form>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { Users } from 'lucide-react'
import { parseUtc } from '../../lib/activity'
import type { TeamEvent } from '../../types'

const MAX_ROWS = 60

/** Journal frames arrive oldest-first from the stream; the feed keeps reading order and
 * drops from the top, so the newest exchange is always on screen. */
export function pushTeam(current: TeamEvent[], event: TeamEvent): TeamEvent[] {
  if (current.some((row) => row.id === event.id)) return current
  return [...current.slice(-(MAX_ROWS - 1)), event]
}

/** Server rows are authoritative; live rows the journal has not echoed back yet stay pinned. */
export function mergeTeam(server: TeamEvent[], live: TeamEvent[]): TeamEvent[] {
  if (live.length === 0) return server.slice(-MAX_ROWS)
  const byId = new Map(server.map((row) => [row.id, row]))
  for (const row of live) if (!byId.has(row.id)) byId.set(row.id, row)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_ROWS)
}

function clockTime(stamp: string | null): string {
  if (!stamp) return ''
  const ms = parseUtc(stamp)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function TeamConversation({ events, connected }: { events: TeamEvent[]; connected: boolean }) {
  const ordered = [...events].sort((a, b) => a.id - b.id).slice(-MAX_ROWS)
  const listRef = useRef<HTMLUListElement>(null)
  const newest = ordered.at(-1)?.id
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [newest])
  const escalation = ordered.filter((row) => row.event_type === 'needs_help').length
  return (
    <div className="panel team-panel" data-testid="team-conversation">
      <div className="panel-heading">
        <div>
          <h2>Percakapan Tim</h2>
          <p>Pimpinan memberi instruksi · spesialis melapor · eskalasi kesulitan · {connected ? 'live' : 'dari jurnal'}</p>
        </div>
        <span className="team-badges">
          {escalation > 0 && <span className="team-alert" title="Laporan kesulitan ke pimpinan">{escalation} eskalasi</span>}
          <Users size={17} className={connected ? 'live' : undefined} />
        </span>
      </div>
      {ordered.length === 0 && (
        <p className="team-empty">Belum ada percakapan — kirim permintaan dan instruksi pimpinan akan muncul di sini.</p>
      )}
      <ul className="team-feed" ref={listRef}>
        {ordered.map((event) => (
          <li key={event.id} className={event.event_type === 'needs_help' ? 'needs-help' : undefined}>
            <time>{clockTime(event.created_at)}</time>
            <div className="team-body">
              <div className="team-who">
                <strong>{event.agent_name ?? 'System'}</strong>
                {event.agent_role && <span className="team-role">{event.agent_role}</span>}
                {event.recipient_name && <span className="team-arrow">→ {event.recipient_name}</span>}
                <span className="team-task">{event.task_title || `task #${event.task_id}`}</span>
                {event.step_index != null && <span className="event-step">langkah {event.step_index}</span>}
                {event.provider && <span className="event-provider">{event.provider}</span>}
                {event.model && <span className="event-model">{event.model}</span>}
              </div>
              <p className="team-message">{event.message}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

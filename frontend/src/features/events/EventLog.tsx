import { Radio } from 'lucide-react'
import type { StreamEvent } from '../../types'

const MAX_ROWS = 14

export default function EventLog({ events, connected }: { events: StreamEvent[]; connected: boolean }) {
  return (
    <div className="event-log" data-testid="event-log">
      <div className="event-log-head">
        <Radio size={13} className={connected ? 'live' : undefined} />
        <span>{connected ? 'Live journal' : 'Journal offline'}</span>
      </div>
      {events.length === 0 && <p className="event-empty">No events yet — the stream fills up as the office works.</p>}
      <ul>
        {events.map((event) => (
          <li key={`${event.kind}:${event.id}`}>
            <span className={`event-type ${event.type}`}>{event.type}</span>
            <span className="event-message">{event.message}</span>
            {event.stepIndex != null && <span className="event-step">step {event.stepIndex}</span>}
            {event.provider && <span className="event-provider">{event.provider}</span>}
            {event.model && <span className="event-model">{event.model}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function pushEvent(current: StreamEvent[], event: StreamEvent): StreamEvent[] {
  if (current.some((e) => e.id === event.id && e.kind === event.kind)) return current
  return [...current.slice(-(MAX_ROWS - 1)), event]
}

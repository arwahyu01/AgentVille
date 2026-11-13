import { useEffect, useRef, useState } from 'react'
import { API_BASE } from './api'
import type { StreamEvent } from '../types'

/**
 * Subscribes to the backend journal stream. EventSource reconnects on its own and
 * sends Last-Event-ID, and the server replays from that cursor — so no frames are lost.
 */
export function useEventStream(onEvent: (event: StreamEvent) => void): boolean {
  const [connected, setConnected] = useState(false)
  const handler = useRef(onEvent)
  useEffect(() => { handler.current = onEvent }, [onEvent])

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(`${API_BASE}/api/events/stream`)
    source.addEventListener('open', () => setConnected(true))
    source.addEventListener('error', () => setConnected(false))
    source.addEventListener('task_event', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as StreamEvent
        handler.current({ ...data, kind: 'task' })
      } catch {
        // ignore malformed frames
      }
    })
    source.addEventListener('office_event', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as Omit<StreamEvent, 'kind' | 'taskId' | 'agentId'> & { actorAgentId: number | null }
        handler.current({
          ...data,
          kind: 'office',
          taskId: 0,
          agentId: data.actorAgentId ?? null,
          conversationId: null,
          provider: null,
          model: null,
          stepIndex: null,
        } as unknown as StreamEvent)
      } catch {
        // ignore malformed frames
      }
    })
    return () => {
      source.close()
      setConnected(false)
    }
  }, [])

  return connected
}

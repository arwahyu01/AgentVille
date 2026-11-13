/** Thin React bridge between the scene roster and the pure social director.
 *
 *  One timer at 1 Hz (plus a catch-up tick when the tab becomes visible) is enough: cues carry
 *  absolute timestamps, and the state only changes when the director's revision changes. */
import { useEffect, useRef, useState } from 'react'
import type { Agent, Task } from '../../types'
import { SocialDirector } from './socialDirector'
import { prefersReducedMotion, type CueMap } from './socialScript'

export function useSocialLife(agents: Agent[], tasks: Task[], fast = false): CueMap {
  const director = useRef<SocialDirector | null>(null)
  if (!director.current) {
    director.current = new SocialDirector({ fast, reducedMotion: prefersReducedMotion() })
  }
  // Kept in a ref so the 1 Hz timer always reads the freshest roster, even when a refresh
  // replaces every agent object between ticks.
  const latest = useRef({ agents, tasks })
  latest.current = { agents, tasks }

  const [cues, setCues] = useState<CueMap>({})
  const revision = useRef(-1)

  useEffect(() => {
    let alive = true
    const run = () => {
      if (!alive) return
      const view = director.current!.tick(latest.current.agents, latest.current.tasks, Date.now())
      if (view.revision !== revision.current) {
        revision.current = view.revision
        setCues(view.cues)
      }
    }
    run()
    const timer = window.setInterval(run, 1000)
    const onVisible = () => { if (!document.hidden) run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return cues
}

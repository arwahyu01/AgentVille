/** Full-screen view of the office panel.
 *
 *  Prefers the browser's Fullscreen API on the panel element, so the canvas, the controls and
 *  the agent dialogs (all children of that element) go full screen together. Where the API is
 *  missing or refuses (iPhone Safari, a sandboxed frame) it falls back to an in-page overlay that
 *  fills the viewport and locks page scrolling. Esc leaves either mode. */
import { useCallback, useEffect, useState, type RefObject } from 'react'

export interface FullscreenState {
  /** Either mode is on. */
  active: boolean
  /** The in-page fallback is on (the panel gets the `expanded` class). */
  overlay: boolean
  toggle: () => void
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): FullscreenState {
  const [native, setNative] = useState(false)
  const [overlay, setOverlay] = useState(false)

  useEffect(() => {
    const sync = () => setNative(ref.current != null && document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [ref])

  useEffect(() => {
    if (!overlay) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverlay(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [overlay])

  const toggle = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    if (overlay) { setOverlay(false); return }
    if (typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => setOverlay(true))
    } else {
      setOverlay(true)
    }
  }, [ref, overlay])

  return { active: native || overlay, overlay, toggle }
}

/** True when a key press should not be taken as a shortcut because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

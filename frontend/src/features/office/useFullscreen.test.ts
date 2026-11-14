import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { isTypingTarget, useFullscreen } from './useFullscreen'

function panel(requestFullscreen?: () => Promise<void>) {
  const el = document.createElement('div')
  if (requestFullscreen) (el as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = requestFullscreen
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
})

describe('useFullscreen', () => {
  it('uses the browser Fullscreen API when it is available', async () => {
    const request = vi.fn(() => Promise.resolve())
    const el = panel(request)
    const { result } = renderHook(() => useFullscreen({ current: el }))
    await act(async () => { result.current.toggle() })
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.current.overlay).toBe(false)
    // The browser reports the change; the hook follows it.
    Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true })
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(result.current.active).toBe(true)
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(result.current.active).toBe(false)
  })

  it('falls back to the in-page overlay when the API is missing', () => {
    const el = panel()
    const { result } = renderHook(() => useFullscreen({ current: el }))
    act(() => result.current.toggle())
    expect(result.current.overlay).toBe(true)
    expect(result.current.active).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    act(() => result.current.toggle())
    expect(result.current.active).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('falls back to the overlay when the browser refuses', async () => {
    const el = panel(() => Promise.reject(new Error('denied')))
    const { result } = renderHook(() => useFullscreen({ current: el }))
    await act(async () => { result.current.toggle() })
    expect(result.current.overlay).toBe(true)
  })

  it('leaves the overlay with Escape and restores page scrolling', () => {
    document.body.style.overflow = 'auto'
    const el = panel()
    const { result } = renderHook(() => useFullscreen({ current: el }))
    act(() => result.current.toggle())
    expect(document.body.style.overflow).toBe('hidden')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(result.current.active).toBe(false)
    expect(document.body.style.overflow).toBe('auto')
  })

  it('does nothing without a panel element', () => {
    const { result } = renderHook(() => useFullscreen({ current: null }))
    act(() => result.current.toggle())
    expect(result.current.active).toBe(false)
  })
})

describe('isTypingTarget', () => {
  it('treats form fields and editable content as typing', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const div = document.createElement('div')
    expect(isTypingTarget(input)).toBe(true)
    expect(isTypingTarget(area)).toBe(true)
    expect(isTypingTarget(div)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

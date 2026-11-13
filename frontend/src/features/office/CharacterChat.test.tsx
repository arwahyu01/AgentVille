import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CharacterChat } from './CharacterChat'
import { api } from '../../lib/api'

vi.mock('../../lib/api', () => ({ api: { characterChat: vi.fn() } }))

const characterChat = vi.mocked(api.characterChat)

function renderChat(overrides: Partial<Parameters<typeof CharacterChat>[0]> = {}) {
  const onMeta = vi.fn()
  render(
    <StrictMode>
      <CharacterChat
        character="staff:greeter"
        intro="Halo, saya resepsionis."
        suggestions={[]}
        placeholder="Tanya resepsionis…"
        offlineReply={() => 'Jawaban lokal.'}
        onMeta={onMeta}
        {...overrides}
      />
    </StrictMode>,
  )
  return onMeta
}

function ask(question: string) {
  fireEvent.change(screen.getByLabelText('Tanya resepsionis…'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
}

describe('CharacterChat', () => {
  beforeEach(() => {
    cleanup()
    characterChat.mockReset()
  })

  it('sends the transcript and renders the AI answer', async () => {
    characterChat.mockResolvedValue({
      reply: 'Bisa, saya arahkan Anda ke tim yang tepat.',
      ai: true, provider: 'qoder', model: 'Efficient', latency_s: 0.5,
    })
    const onMeta = renderChat()

    ask('Bisa konsultasi di sini?')

    expect(await screen.findByText('Bisa, saya arahkan Anda ke tim yang tepat.')).toBeInTheDocument()
    const [character, message, history, signal] = characterChat.mock.calls[0]
    expect(character).toBe('staff:greeter')
    expect(message).toBe('Bisa konsultasi di sini?')
    expect(history).toEqual([{ role: 'character', text: 'Halo, saya resepsionis.' }])
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(onMeta).toHaveBeenCalledWith({ mode: 'ai', provider: 'qoder', model: 'Efficient' })
  })

  it('falls back to a local answer and explains why when AI is unavailable', async () => {
    characterChat.mockRejectedValue(new Error('AI sedang nonaktif'))
    const onMeta = renderChat()

    ask('Bisa konsultasi di sini?')

    expect(await screen.findByText('Jawaban lokal.')).toBeInTheDocument()
    expect(screen.getByText(/AI belum aktif atau tidak bisa dihubungi/)).toBeInTheDocument()
    expect(onMeta).toHaveBeenCalledWith({ mode: 'local' })
  })

  it('shows a thinking state while the request is in flight', async () => {
    let resolve: ((value: Awaited<ReturnType<typeof api.characterChat>>) => void) | undefined
    characterChat.mockReturnValue(new Promise((done) => { resolve = done }))
    renderChat()

    ask('Halo')

    expect(screen.getByLabelText('Karakter sedang mengetik')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '…' })).toBeDisabled()
    resolve?.({ reply: 'Halo juga.', ai: true, provider: 'qoder', model: 'Efficient', latency_s: 0.2 })
    expect(await screen.findByText('Halo juga.')).toBeInTheDocument()
  })
})

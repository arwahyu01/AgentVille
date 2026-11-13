import { describe, expect, it } from 'vitest'
import { answerStaff, STAFF_INTRO, STAFF_SUGGESTIONS } from './staffScript'

const agents = [
  { name: 'Atlas', role: 'AI Coordinator' },
  { name: 'Nova', role: 'Data Analyst' },
  { name: 'Byte', role: 'Developer' },
]

describe('answerStaff', () => {
  it('startsWith a welcome for both variants', () => {
    expect(STAFF_INTRO.greeter).toMatch(/selamat datang/i)
    expect(STAFF_INTRO.teller).toMatch(/selamat datang/i)
  })

  it('answers every suggested question instead of falling back', () => {
    for (const variant of ['greeter', 'teller'] as const) {
      for (const question of STAFF_SUGGESTIONS[variant]) {
        const reply = answerStaff(variant, question, { agents })
        expect(reply).not.toMatch(/belum punya jawaban/i)
      }
    }
  })

  it('gives accurate zone directions', () => {
    expect(answerStaff('greeter', 'Di mana Customer Service?')).toMatch(/utara/i)
    expect(answerStaff('greeter', 'Di mana ruang meeting?')).toMatch(/tenggara/i)
    expect(answerStaff('greeter', 'Di mana tim developer?')).toMatch(/barat laut/i)
    expect(answerStaff('greeter', 'Di mana pantry?')).toMatch(/tenggara/i)
  })

  it('knows it is already at Customer Service when asked from the teller', () => {
    expect(answerStaff('teller', 'Ini customer service?')).toMatch(/sudah di Customer Service/i)
  })

  it('reads a queue number back to the teller', () => {
    expect(answerStaff('teller', 'Nomor antrean saya 12')).toContain('12')
    expect(answerStaff('greeter', 'Nomor antrean saya 12')).toMatch(/loket/i)
  })

  it('explains documents without promising a backend action', () => {
    expect(answerStaff('teller', 'Dokumen apa yang perlu?')).toMatch(/identitas/i)
    expect(answerStaff('greeter', 'Dokumen apa yang perlu?')).toMatch(/loket/i)
  })

  it('uses the live roster for names and team size', () => {
    expect(answerStaff('greeter', 'Siapa Nova?', { agents })).toContain('Data Analyst')
    expect(answerStaff('greeter', 'Siapa saja timnya?', { agents })).toContain('3 agen')
    expect(answerStaff('greeter', 'Siapa saja timnya?', { agents })).toContain('Atlas')
  })

  it('stays out of task and approval workflows', () => {
    expect(answerStaff('greeter', 'Tolong setujui rencana saya')).toMatch(/panel Requests/i)
    expect(answerStaff('teller', 'Buatkan task baru')).toMatch(/tidak bisa mengubah tugas/i)
  })

  it('explains that the virtual office has no closing time', () => {
    expect(answerStaff('greeter', 'Jam operasional?')).toMatch(/tidak ada jam tutup/i)
  })

  it('falls back politely on an unknown topic', () => {
    expect(answerStaff('greeter', 'Xylophone')).toMatch(/belum punya jawaban/i)
    expect(answerStaff('teller', 'Xylophone')).toMatch(/belum punya jawaban/i)
  })
})

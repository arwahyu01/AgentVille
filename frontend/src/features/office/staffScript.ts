/** Front-of-house staff and the answers they give visitors. Kept out of the component module so
 *  Vite fast refresh can treat StaffNpc as a pure component.
 *
 *  These two are scene extras, not backend agents: the Q&A below is a small local knowledge base
 *  about the office layout and roster. It never mutates tasks, plans or agent data. */

export type StaffVariant = 'greeter' | 'teller'

export interface StaffAgent {
  name: string
  role: string
}

export interface StaffContext {
  agents?: StaffAgent[]
}

export const STAFF_INTRO: Record<StaffVariant, string> = {
  greeter: 'Selamat datang di AgentVille. Saya resepsionis di lobby — tanyakan lokasi ruangan, tim, atau janji temu.',
  teller: 'Selamat datang di Customer Service. Tanyakan soal antrean, dokumen, atau lokasi tim.',
}

export const STAFF_SUGGESTIONS: Record<StaffVariant, string[]> = {
  greeter: ['Bisa konsultasi di sini?', 'Di mana Customer Service?', 'Siapa saja timnya?', 'Saya ada janji temu'],
  teller: ['Bisa konsultasi di sini?', 'Nomor antrean saya 12', 'Dokumen apa yang perlu?', 'Di mana ruang meeting?'],
}

/** Short front-of-house lines for the idle figure. Local flavour only: they never claim an agent
 *  status, a task or a backend action. */
export const STAFF_AMBIENT_LINES: Record<StaffVariant, string[]> = {
  greeter: [
    'Selamat datang di AgentVille.',
    'Ada yang bisa saya arahkan?',
    'Lobby cukup tenang hari ini.',
    'Silakan, resepsionis siap membantu.',
    'Butuh info ruangan atau tim?',
  ],
  teller: [
    'Loket Customer Service siap melayani.',
    'Silakan ambil nomor antrean.',
    'Dokumen bisa diperiksa di loket.',
    'Ada yang bisa saya bantu?',
    'Antrean loket sedang lengang.',
  ],
}

const FALLBACK = 'Maaf, saya belum punya jawaban untuk itu. Saya bisa bantu soal lokasi ruangan, tim, jam operasional, antrean/dokumen, atau janji temu.'

interface Rule {
  match: RegExp
  answer: (variant: StaffVariant, question: string, ctx: StaffContext) => string
}

function queueAnswer(variant: StaffVariant, question: string): string {
  if (variant !== 'teller') {
    return 'Antrean dan loket ada di Customer Service, sisi utara seberang koridor. Papan antrean ada di dekat loket.'
  }
  const number = question.match(/\d{1,3}/)?.[0]
  return number
    ? `Baik, nomor ${number}. Silakan tunggu di area tunggu; saya panggil ke loket berikutnya.`
    : 'Sebutkan nomor antrean Anda, atau tunjukkan tiketnya — saya arahkan ke loket yang kosong.'
}

function documentAnswer(variant: StaffVariant): string {
  return variant === 'teller'
    ? 'Bawa identitas dan dokumen pendukung yang relevan. Saya periksa kelengkapannya di loket; kalau ada yang kurang, saya beri daftar singkat.'
    : 'Pemeriksaan dokumen dilakukan di loket Customer Service. Petugas di sana akan menjelaskan persyaratan yang berlaku.'
}

function teamAnswer(question: string, ctx: StaffContext): string {
  const agents = ctx.agents ?? []
  const named = agents.find((a) => question.toLowerCase().includes(a.name.toLowerCase()))
  if (named) return `${named.name} adalah ${named.role} di AgentVille.`
  if (agents.length === 0) {
    return 'Ada 14 agen terdaftar, dipimpin Atlas (AI Coordinator). Daftar lengkapnya ada di panel Task Board.'
  }
  const lead = agents.find((a) => /coordinator/i.test(a.role))
  const leadText = lead ? `, dipimpin ${lead.name} (${lead.role})` : ''
  return `Ada ${agents.length} agen terdaftar${leadText}. Spesialisnya tersebar di Development, Customer Service, Analyst / Research, Design Studio, Server / Database, dan Security Control. Daftar lengkap ada di panel Task Board.`
}

const RULES: Rule[] = [
  {
    match: /(kamu siapa|anda siapa|siapa kamu|siapa anda|nama kamu|nama anda)/i,
    answer: (variant) => variant === 'teller'
      ? 'Saya teller Customer Service di simulasi AgentVille — bukan agen backend. Saya membantu tamu soal antrean, dokumen, dan arah ruangan.'
      : 'Saya resepsionis front-of-house di simulasi AgentVille — bukan agen backend. Saya membantu tamu bernavigasi dan menjawab info kantor.',
  },
  {
    match: /(approve|setujui|persetujuan|ubah tugas|mengubah tugas|\btask\b|\brencana\b)/i,
    answer: () => 'Saya tidak bisa mengubah tugas atau menyetujui rencana. Itu dilakukan lewat panel Requests; saya hanya membantu navigasi dan informasi kantor.',
  },
  {
    match: /(nomor|antre|antrian)/i,
    answer: (variant, question) => queueAnswer(variant, question),
  },
  {
    match: /(dokumen|formulir|berkas|syarat|persyaratan)/i,
    answer: (variant) => documentAnswer(variant),
  },
  {
    match: /(konsultasi|konsul|saran|pendapat|diskusi|curhat|tanya langsung)/i,
    answer: (variant) => variant === 'teller'
      ? 'Bisa. Konsultasi dengan tim Customer Service ada di meja-meja depan loket. Sebutkan topiknya, saya arahkan ke tim yang tepat; untuk pekerjaan proyek, ajukan lewat panel Requests.'
      : 'Bisa. Saya arahkan Anda ke tim yang sesuai — Customer Service untuk layanan, Development untuk teknis, Analyst / Research untuk data, atau Design Studio untuk UI/UX. Untuk pekerjaan proyek, ajukan lewat panel Requests.',
  },
  {
    match: /(customer service|\bcs\b|loket|teller)/i,
    answer: (variant) => variant === 'teller'
      ? 'Anda sudah di Customer Service. Loket teller ada di dinding utara; konsultasi dengan tim CS ada di meja-meja depan loket.'
      : 'Customer Service ada di sisi utara, seberang koridor. Dari lobby, lurus ke koridor lalu belok kanan; masuk lewat pintu kaca, loketnya di dinding utara.',
  },
  {
    match: /(meeting|rapat|janji|appointment|pertemuan)/i,
    answer: () => 'Ruang meeting ada di sisi tenggara, ujung koridor ke arah timur. Kalau sudah punya janji, sebutkan nama Anda di resepsionis saat tiba.',
  },
  {
    match: /(developer|development|frontend|backend|programmer|engineering)/i,
    answer: () => 'Tim Development ada di sisi barat laut, seberang koridor dari lobby. Lewat pintu kaca di koridor, lalu cari zona bertanda Development.',
  },
  {
    match: /(server|database|\bdb\b|infrastruktur|jaringan|wifi|internet|password|kredensial)/i,
    answer: () => 'Server / Database ada di sudut barat laut dan berpintu solid — area terbatas. Untuk jaringan atau kredensial, hubungi tim di sana; saya tidak membagikannya dari front desk.',
  },
  {
    match: /(analis|analyst|research|riset)/i,
    answer: () => 'Analyst / Research ada di sisi selatan, tepat di sebelah timur lobby. Cari zona bertanda Analyst / Research.',
  },
  {
    match: /(desain|design|\bui\b|\bux\b|kreatif|konten|content)/i,
    answer: () => 'Design Studio ada di sisi selatan, di antara Analyst / Research dan ruang meeting.',
  },
  {
    match: /(pantry|kopi|makan|minum|istirahat|kantin)/i,
    answer: () => 'Pantry ada di sudut tenggara, di sebelah timur ruang meeting. Silakan ambil kopi atau air di sana.',
  },
  {
    match: /(security|keamanan|satpam)/i,
    answer: () => 'Security Control ada di sudut timur laut, dekat Customer Service. Untuk keperluan keamanan, petugas di sana yang menangani.',
  },
  {
    match: /(tim|team|agen|agent|karyawan|staf|staff|siapa)/i,
    answer: (_variant, question, ctx) => teamAnswer(question, ctx),
  },
  {
    match: /(jam|buka|tutup|operasional|kapan)/i,
    answer: () => 'Kantor virtual ini aktif selama aplikasi AgentVille berjalan, jadi tidak ada jam tutup. Simulasi kantor berjalan terus; pekerjaan tim mengikuti task di panel Requests.',
  },
  {
    match: /(terima kasih|makasih|thanks|thank you)/i,
    answer: () => 'Sama-sama. Kalau perlu arah lain, tanya saja ya.',
  },
  {
    match: /(sampai jumpa|selamat tinggal|bye|dadah)/i,
    answer: () => 'Sampai jumpa! Semoga harinya lancar.',
  },
  {
    match: /(bisa apa|bantu apa|help|tolong|informasi|\binfo\b)/i,
    answer: () => 'Saya bisa menunjukkan lokasi Customer Service, ruang meeting, Development, Server / Database, Analyst / Research, Design Studio, Pantry, dan Security; juga info tim, jam operasional, antrean, dan dokumen.',
  },
  {
    match: /(^|\b)(halo|hai|hello|hi|selamat pagi|selamat siang|selamat sore|selamat malam|pagi|siang|sore|malam)\b/i,
    answer: (variant) => variant === 'teller'
      ? 'Halo! Saya di loket Customer Service. Ada yang bisa saya bantu soal antrean atau dokumen?'
      : 'Halo! Selamat datang di AgentVille. Mau saya arahkan ke ruangan atau tim tertentu?',
  },
]

export function answerStaff(variant: StaffVariant, question: string, ctx: StaffContext = {}): string {
  const q = question.trim()
  if (!q) return 'Silakan tulis pertanyaan Anda.'
  for (const rule of RULES) {
    if (rule.match.test(q)) return rule.answer(variant, q, ctx)
  }
  return FALLBACK
}

/** Local social choreography for the office.
 *
 *  Everything here is presentation only: no task, plan, agent row or backend value is written.
 *  Agents are allowed to greet, chat, joke and wander because the roster says they have no open
 *  work. The director (`socialDirector.ts`) decides when; this module holds the rules, the safe
 *  anchors and the deterministic Indonesian script. */
import { poseFor, routeTo } from '../../lib/activity'
import {
  OPERATIONAL_ROLES, ROOMS, pathBetween, seatAt, type Room,
} from '../../lib/officeLayout'
import type { Agent, Task, TaskStatus } from '../../types'

export type SocialKind = 'greet' | 'chat' | 'joke' | 'wander'
export type SocialTone = 'greet' | 'work' | 'joke' | 'reply'

export interface SocialLine {
  speakerId: number
  text: string
  tone: SocialTone
  /** Absolute epoch milliseconds, so a bubble never depends on a render tick. */
  at: number
  until: number
}

export interface SocialCue {
  /** Shared by both halves of a pair; unique per social encounter. */
  id: string
  kind: SocialKind
  role: 'host' | 'guest' | 'solo'
  agentId: number
  partnerId: number | null
  roomId: string
  /** Standing / seated point this participant walks to. */
  destination: [number, number]
  /** Point this participant turns toward once parked. */
  faceTarget: [number, number]
  seated: boolean
  talkStart: number
  talkEnd: number
  /** When the cue is removed and the normal desk route resumes. */
  endsAt: number
  lines: SocialLine[]
  /** Snapshot of the backend facts this cue was built on; any change cancels it. */
  basis: string
}

export type CueMap = Record<number, SocialCue>

/** Task states that still own the agent's attention. A completed/failed/cancelled task is done. */
export const OPEN_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'pending', 'clarifying', 'awaiting_approval', 'approved', 'queued', 'running', 'reviewing', 'awaiting_acceptance',
])

export const WALK_SPEED = 2
const TITLE_LIMIT = 48

/** Rooms where a conversation may happen. Meeting, server and security stay work-only. */
export const SOCIAL_ROOM_IDS = ['lobby', 'pantry', 'analyst', 'design', 'dev', 'cs', 'admin'] as const
export type SocialRoomId = (typeof SOCIAL_ROOM_IDS)[number]
const SOCIAL_ROOM_SET: ReadonlySet<string> = new Set(SOCIAL_ROOM_IDS)

/** Validated against `blockedAt(..., 0.32)` in the unit tests: open floor, away from desks,
 *  the lobby sofa/reception desk, the pantry wet run and the CS queue. */
export const SOCIAL_ANCHOR: Record<SocialRoomId, [number, number]> = {
  lobby: [-9.85, 3.35],
  pantry: [9.9, 5.6],
  analyst: [-4.7, 3.2],
  design: [1.4, 3.2],
  dev: [-3.9, -3.2],
  cs: [2.9, -2.4],
  admin: [11.8, -2.6],
}

const PAIR_SPREAD = 0.32
// 0.45 keeps the westmost pantry mark clear of the meeting-room partition.
const WANDER_SPREAD = 0.45

export function isSocialRoom(id: string | null | undefined): id is SocialRoomId {
  return !!id && SOCIAL_ROOM_SET.has(id)
}

/** Two standing marks either side of the anchor, facing each other. */
export function pairPoints(roomId: string): [[number, number], [number, number]] {
  const anchor = SOCIAL_ANCHOR[roomId as SocialRoomId] ?? SOCIAL_ANCHOR.lobby
  return [
    [anchor[0] - PAIR_SPREAD, anchor[1]],
    [anchor[0] + PAIR_SPREAD, anchor[1]],
  ]
}

/** Solo visitor marks, two per pantry/lobby and one per department. */
export function wanderPoint(roomId: string, slot: number): [number, number] {
  const anchor = SOCIAL_ANCHOR[roomId as SocialRoomId] ?? SOCIAL_ANCHOR.lobby
  return [anchor[0] + (slot === 0 ? -WANDER_SPREAD : WANDER_SPREAD), anchor[1]]
}

export function hasOpenTask(agentId: number, tasks: Task[]): boolean {
  return tasks.some((t) => t.agent_id === agentId && OPEN_TASK_STATUSES.has(t.status))
}

/** Eligibility is deliberately conservative: open work, travel, meetings and the two
 *  simulation-only roles never leave their post for a chat. */
export function isEligibleAgent(agent: Agent, tasks: Task[]): boolean {
  if (OPERATIONAL_ROLES.has(agent.role)) return false
  if (agent.target_room && agent.target_room !== agent.current_room) return false
  if (agent.status === 'working' || agent.status === 'waiting' || agent.status === 'reviewing') return false
  if (agent.current_room === 'meeting') return false
  return !hasOpenTask(agent.id, tasks)
}

/** Stable string of the backend facts a cue depends on. Refresh replaces the objects every
 *  15 s, so cancellation compares this string rather than object identity. */
export function basisFor(agent: Agent, tasks: Task[]): string {
  const open = tasks
    .filter((t) => t.agent_id === agent.id && OPEN_TASK_STATUSES.has(t.status))
    .map((t) => `${t.id}:${t.status}`)
    .sort()
    .join('|')
  return `${agent.status}|${agent.current_room ?? ''}|${agent.target_room ?? ''}|${open}`
}

export interface RestingPose {
  room: Room
  x: number
  z: number
  facing: number
  seated: boolean
}

/** Where the agent rests right now: the chair when the room has one, otherwise the station mark.
 *  Operational staff never count as seated, matching the figure's own handling. */
export function restingPose(agent: Agent, slot: number): RestingPose {
  const pose = poseFor(agent)
  const room = pose.targetRoom ?? pose.homeRoom
  const seat = seatAt(room, slot)
  const staff = OPERATIONAL_ROLES.has(agent.role)
  return { room, x: seat.x, z: seat.z, facing: seat.facing, seated: staff ? false : seat.seated }
}

export function latestCompletedTask(agentId: number, tasks: Task[]): Task | undefined {
  let best: Task | undefined
  for (const task of tasks) {
    if (task.agent_id !== agentId || task.status !== 'completed') continue
    if (!best || task.id > best.id) best = task
  }
  return best
}

export function clipTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim() || 'pekerjaan'
  return clean.length > TITLE_LIMIT ? `${clean.slice(0, TITLE_LIMIT - 1)}…` : clean
}

/** ETA at walking speed through the real doors (and the corridor spine). Same-room moves are a
 *  straight walk; the caller adds a buffer for the aisle detour. */
export function travelSeconds(from: { x: number; z: number; room: Room }, to: Room, dest: [number, number]): number {
  if (from.room.id === to.id) return Math.hypot(dest[0] - from.x, dest[1] - from.z) / WALK_SPEED
  const path: [number, number][] = [[from.x, from.z], ...pathBetween(from.room, to), dest]
  let distance = 0
  for (let i = 1; i < path.length; i += 1) {
    distance += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  }
  return distance / WALK_SPEED
}

function onSeat(room: Room, point: [number, number]): boolean {
  if (!room.seatOffset) return false
  return room.stations.some(([x, z]) =>
    Math.hypot(point[0] - (x + room.seatOffset![0]), point[1] - (z + room.seatOffset![1])) < 0.5)
}

/** Step into the aisle before crossing a desk row. Keeps a social walk from cutting over a desk
 *  while leaving the existing backend route (`routeTo`) untouched. */
function aisle(room: Room, start: [number, number], goal: [number, number]): [number, number][] {
  const inRoom = (x: number) => x > room.box[0] + 0.35 && x < room.box[2] - 0.35
  const lanes = [start[0] - 1.0, start[0] + 1.0].filter(inRoom)
  if (!lanes.length) return []
  const laneX = lanes.sort((a, b) => Math.abs(a - goal[0]) - Math.abs(b - goal[0]))[0]
  return [[laneX, start[1]], [laneX, goal[1]]]
}

/** Route for a social cue. Same-room movements need the aisle; a north-band desk also needs it
 *  before the corridor door, because its existing route would otherwise cross the front row. */
export function socialRoute(
  from: Room, to: Room, destination: [number, number], start: [number, number],
): [number, number][] {
  if (from.id !== to.id) {
    const base = routeTo(from, to, destination, start)
    if (from.kind === 'dept' && from.band === 'north' && onSeat(from, start)) {
      return [...aisle(from, start, [from.door[0], from.box[3] - 0.55]), ...base]
    }
    return base
  }
  return [...(onSeat(from, start) ? aisle(from, start, destination) : []), destination]
}

export function activeSocialLine(cue: SocialCue | undefined, agentId: number, now: number): SocialLine | null {
  if (!cue) return null
  for (const line of cue.lines) {
    if (line.speakerId === agentId && now >= line.at && now < line.until) return line
  }
  return null
}

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** Deterministic PRNG (mulberry32): every script pick is repeatable for a given seed. */
export function seeded(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(list: readonly T[], rand: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))]
}

type RoleGroup = 'dev' | 'design' | 'analyst' | 'admin' | 'other'

function roleGroup(role: string): RoleGroup {
  if (/developer|qa engineer/i.test(role)) return 'dev'
  if (/designer|content/i.test(role)) return 'design'
  if (/analyst|researcher/i.test(role)) return 'analyst'
  if (/administrator|reviewer|coordinator/i.test(role)) return 'admin'
  return 'other'
}

const GREET_LINES = [
  'Hai, {name}.',
  'Halo, {name}.',
  'Eh, {name}.',
  'Halo, {name}. Santai, ya?',
  'Hai, {name}. Nggak sibuk?',
]

const GREET_REPLIES = [
  'Hai juga.',
  'Halo. Santai, ya?',
  'Eh, iya. Kamu juga?',
  'Halo. Sehat?',
  'Hai. Mampir sebentar, ya?',
]

const ROLE_CHATTER: Record<RoleGroup, string[]> = {
  dev: [
    'Ada ide buat rapikan kode minggu ini?',
    'Kopi dulu sebelum ngoding?',
    'Editor-nya tadi sempat rewel, tapi sudah baikan.',
  ],
  design: [
    'Palet warna ruangan ini enak dilihat, ya.',
    'Ada referensi desain baru?',
    'Font yang kemarin dipakai masih cocok.',
  ],
  analyst: [
    'Angka minggu ini menarik buat dibahas.',
    'Dashboard-nya makin enak dibaca.',
    'Ada data baru yang masuk?',
  ],
  admin: [
    'Jadwal minggu depan masih longgar.',
    'Ada dokumen yang perlu dirapikan?',
    'Rapat berikutnya kapan, ya?',
  ],
  other: [
    'Gimana kabar hari ini?',
    'Lagi santai, ya?',
    'Ruangan ini adem, cocok buat ngobrol sebentar.',
  ],
}

const ROOM_CHATTER: Record<string, string[]> = {
  pantry: [
    'Kopinya masih hangat?',
    'Pantry lumayan ramai hari ini.',
    'Mau ambil minum dulu?',
  ],
  lobby: [
    'Lobby hari ini sepi, ya.',
    'Ada tamu datang?',
    'Sofa lobby enak buat istirahat sebentar.',
  ],
}

const CHAT_REPLIES = [
  'Lumayan. Santai dulu sebentar.',
  'Aman. Kamu gimana?',
  'Boleh juga tuh.',
  'Iya, nanti kita bahas lagi.',
  'Setuju. Kopi dulu, ya.',
  'Haha, iya juga.',
]

const WORK_REPLIES = [
  'Iya, lega. Tinggal rapikan catatan.',
  'Sudah. Nanti kita review bareng kalau sempat.',
  'Beres. Makasih sudah nanya.',
  'Iya. Sekarang waktunya istirahat sebentar.',
]

const JOKES: Record<RoleGroup, string[]> = {
  dev: [
    'Kenapa developer suka kopi? Karena butuh Java.',
    'Build paling tenang itu yang nggak diubah apa-apa.',
  ],
  design: [
    'Desainer bilang "cuma ganti font" — tiga jam kemudian semuanya berubah.',
    'Komentar paling cepat di design review: "bisa lebih pop?"',
  ],
  analyst: [
    'Data itu jujur. Yang suka bercanda kadang dashboard-nya.',
    'Kalau grafiknya naik, semua orang jadi analis.',
  ],
  admin: [
    'Rapat paling cepat itu yang nggak jadi.',
    'Dokumen "final_v2_revisi_fix" itu seni.',
  ],
  other: [
    'Kopi kantor itu ajaib: rasanya beda kalau dicampur tenggat.',
    'Istirahat lima menit kadang jadi setengah jam.',
  ],
}

const JOKE_REACTIONS = [
  'Haha, itu pengalaman pribadi.',
  'Nah, itu baru jujur.',
  'Aduh, kena banget.',
  'Boleh juga, tapi jangan sampai ketagihan.',
]

const WANDER_LINES: Record<string, string[]> = {
  pantry: ['Kopi dulu.', 'Mampir pantry sebentar.', 'Cek kopi, ya.'],
  lobby: ['Ke lobby sebentar.', 'Lihat lobby dulu.'],
}

function greetText(to: Agent, rand: () => number): string {
  return pick(GREET_LINES, rand).replace('{name}', to.name)
}

function workOpener(task: Task, rand: () => number): string {
  const title = clipTitle(task.title)
  return pick([
    `Barusan "${title}" kelar, ya?`,
    `"${title}" sudah selesai, kan?`,
    `Tadi "${title}" beres, ya?`,
  ], rand)
}

function schedule(turns: { speaker: Agent; text: string; tone: SocialTone }[], talkStart: number, lineMs: number): {
  lines: SocialLine[]; talkEnd: number
} {
  const lines = turns.map((turn, index) => ({
    speakerId: turn.speaker.id,
    text: turn.text,
    tone: turn.tone,
    at: talkStart + index * lineMs,
    until: talkStart + (index + 1) * lineMs,
  }))
  return { lines, talkEnd: talkStart + turns.length * lineMs }
}

export function buildPairLines(
  kind: Exclude<SocialKind, 'wander'>,
  host: Agent,
  guest: Agent,
  roomId: string,
  tasks: Task[],
  talkStart: number,
  seed: number,
): { lines: SocialLine[]; talkEnd: number } {
  const rand = seeded(seed)
  const hostTask = latestCompletedTask(host.id, tasks)
  const guestTask = latestCompletedTask(guest.id, tasks)
  const turns: { speaker: Agent; text: string; tone: SocialTone }[] = []

  if (kind === 'greet') {
    turns.push({ speaker: host, text: greetText(guest, rand), tone: 'greet' })
    turns.push({ speaker: guest, text: pick(GREET_REPLIES, rand), tone: 'greet' })
    return schedule(turns, talkStart, 3500)
  }

  if (kind === 'joke') {
    const group = roleGroup(host.role)
    turns.push({ speaker: host, text: pick(JOKES[group], rand), tone: 'joke' })
    turns.push({ speaker: guest, text: pick(JOKE_REACTIONS, rand), tone: 'joke' })
    return schedule(turns, talkStart, 4000)
  }

  const finished = hostTask ?? guestTask
  if (finished) {
    // Completed work only: never a claim about what is running right now.
    turns.push({ speaker: host, text: workOpener(finished, rand), tone: 'work' })
    turns.push({ speaker: guest, text: pick(WORK_REPLIES, rand), tone: 'work' })
  } else {
    const roomLines = ROOM_CHATTER[roomId]
    const hostLines = roomLines ?? ROLE_CHATTER[roleGroup(host.role)]
    turns.push({ speaker: host, text: pick(hostLines, rand), tone: 'greet' })
    turns.push({ speaker: guest, text: pick(CHAT_REPLIES, rand), tone: 'reply' })
  }
  if (rand() < 0.55) {
    turns.push({ speaker: guest, text: pick(CHAT_REPLIES, rand), tone: 'reply' })
  }
  return schedule(turns, talkStart, turns.length >= 3 ? 2900 : 4000)
}

export function buildWanderLines(
  agent: Agent,
  destRoomId: string,
  talkStart: number,
  seed: number,
): { lines: SocialLine[]; talkEnd: number } {
  const rand = seeded(seed)
  if (rand() >= 0.65) return { lines: [], talkEnd: talkStart }
  const lines = WANDER_LINES[destRoomId]
  const label = ROOMS[destRoomId]?.label ?? 'ruangan sebelah'
  const text = lines
    ? pick(lines, rand)
    : pick([`Mampir ke ${label} sebentar.`, 'Jalan-jalan dulu, ya.', 'Keliling sebentar.'], rand)
  const lineMs = 3500
  return {
    lines: [{ speakerId: agent.id, text, tone: 'greet', at: talkStart, until: talkStart + lineMs }],
    talkEnd: talkStart + lineMs,
  }
}

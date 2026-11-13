/** Pure state machine that decides when idle colleagues socialise.
 *
 *  It has no React and no Three imports: given the current roster, tasks and clock it returns a
 *  cue map plus a revision counter. `useSocialLife` only pushes a React update when the revision
 *  changes, so a 1 Hz tick does not re-render the scene for nothing. */
import { stationSlots } from '../../lib/activity'
import { ROOMS } from '../../lib/officeLayout'
import type { Agent, Task } from '../../types'
import {
  SOCIAL_ROOM_IDS, basisFor, buildPairLines, buildWanderLines,
  isEligibleAgent, isSocialRoom, pairPoints, restingPose, seeded, travelSeconds,
  wanderPoint, type CueMap, type RestingPose, type SocialCue, type SocialKind,
} from './socialScript'

export const PAIR_CAP = 3
export const SOLO_CAP = 2
export const AGENT_COOLDOWN_MIN = 45_000
export const AGENT_COOLDOWN_MAX = 75_000
export const PAIR_COOLDOWN = 180_000

export interface SocialTick {
  cues: CueMap
  revision: number
}

export interface SocialDirectorOptions {
  /** Quick decisions for the `?qa` probe, without changing the choreography. */
  fast?: boolean
  /** Respect prefers-reduced-motion: keep conversation, skip roaming. */
  reducedMotion?: boolean
  seed?: number
}

type PairKind = Exclude<SocialKind, 'wander'>

const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`

export class SocialDirector {
  private cues = new Map<number, SocialCue>()
  private agentCooldown = new Map<number, number>()
  private pairCooldown = new Map<string, number>()
  private nextDecision = 0
  private started = false
  private revision = 0
  private rng: () => number
  private fast: boolean
  private reduced: boolean

  constructor(opts: SocialDirectorOptions = {}) {
    this.rng = seeded(opts.seed ?? 0x51c1a1)
    this.fast = !!opts.fast
    this.reduced = !!opts.reducedMotion
  }

  tick(agents: Agent[], tasks: Task[], now: number): SocialTick {
    const byId = new Map(agents.map((a) => [a.id, a]))

    for (const group of this.groups()) {
      const head = group[0]
      const expired = now >= head.endsAt
      const broken = group.some((cue) => {
        const agent = byId.get(cue.agentId)
        return !agent || basisFor(agent, tasks) !== cue.basis
      })
      if (expired || broken) this.removeGroup(head.id, now)
    }

    if (!this.started) {
      this.started = true
      this.nextDecision = now + (this.fast ? 600 : 1800 + this.rng() * 1500)
    } else if (now >= this.nextDecision) {
      this.nextDecision = now + (this.fast ? 1500 + this.rng() * 1500 : 6000 + this.rng() * 6000)
      this.create(agents, tasks, now)
    }

    return { cues: this.snapshot(), revision: this.revision }
  }

  private snapshot(): CueMap {
    const out: CueMap = {}
    for (const cue of this.cues.values()) out[cue.agentId] = cue
    return out
  }

  private groups(): SocialCue[][] {
    const map = new Map<string, SocialCue[]>()
    for (const cue of this.cues.values()) {
      const list = map.get(cue.id)
      if (list) list.push(cue)
      else map.set(cue.id, [cue])
    }
    return [...map.values()]
  }

  private removeGroup(id: string, now: number) {
    const members = [...this.cues.values()].filter((cue) => cue.id === id)
    if (!members.length) return
    for (const cue of members) {
      this.cues.delete(cue.agentId)
      this.agentCooldown.set(
        cue.agentId,
        now + AGENT_COOLDOWN_MIN + Math.floor(this.rng() * (AGENT_COOLDOWN_MAX - AGENT_COOLDOWN_MIN)),
      )
    }
    if (members.length === 2 && members.every((cue) => cue.partnerId != null)) {
      this.pairCooldown.set(pairKey(members[0].agentId, members[1].agentId), now + PAIR_COOLDOWN)
    }
    this.revision += 1
  }

  private create(agents: Agent[], tasks: Task[], now: number): boolean {
    const slots = stationSlots(agents)
    const eligible = [...agents]
      .filter((agent) => isEligibleAgent(agent, tasks))
      .filter((agent) => !this.cues.has(agent.id))
      .filter((agent) => (this.agentCooldown.get(agent.id) ?? 0) <= now)
      .sort((a, b) => a.id - b.id)
    if (!eligible.length) return false

    const partnerGroups = this.groups().filter((group) => group[0].partnerId != null).length
    const solos = [...this.cues.values()].filter((cue) => cue.partnerId == null).length

    const roll = this.rng()
    const wanted: SocialKind = roll < 0.3 ? 'greet' : roll < 0.7 ? 'chat' : roll < 0.85 ? 'joke' : 'wander'
    const order: SocialKind[] = [...new Set<SocialKind>([
      wanted, 'chat', this.reduced ? 'greet' : 'wander', 'greet', 'joke',
    ])]

    for (const kind of order) {
      if (kind === 'wander') {
        if (this.reduced || solos >= SOLO_CAP) continue
        if (this.tryWander(eligible, tasks, slots, now)) return true
      } else {
        if (partnerGroups >= PAIR_CAP) continue
        if (this.tryPair(kind, eligible, tasks, slots, now)) return true
      }
    }
    return false
  }

  private tryPair(
    kind: PairKind,
    eligible: Agent[],
    tasks: Task[],
    slots: Record<number, number>,
    now: number,
  ): boolean {
    const resting = new Map<number, RestingPose>(
      eligible.map((agent) => [agent.id, restingPose(agent, slots[agent.id] ?? 0)]),
    )
    const usedRooms = new Set([...this.cues.values()].map((cue) => cue.roomId))
    const hosts = eligible.filter((agent) => {
      const rest = resting.get(agent.id)!
      return isSocialRoom(rest.room.id) && !usedRooms.has(rest.room.id)
    })
    if (!hosts.length) return false

    const start = Math.floor(this.rng() * hosts.length)
    for (let i = 0; i < hosts.length; i += 1) {
      const host = hosts[(start + i) % hosts.length]
      const hostRest = resting.get(host.id)!
      const partners = eligible.filter((agent) => {
        if (agent.id === host.id) return false
        if ((this.pairCooldown.get(pairKey(host.id, agent.id)) ?? 0) > now) return false
        if (kind !== 'greet') return true
        const guestRest = resting.get(agent.id)!
        if (guestRest.room.id !== hostRest.room.id) return false
        return Math.hypot(guestRest.x - hostRest.x, guestRest.z - hostRest.z) <= 4.5
      })
      if (!partners.length) continue

      const guest = partners[Math.floor(this.rng() * partners.length)]
      const guestRest = resting.get(guest.id)!
      const room = hostRest.room
      const pair = pairPoints(room.id)
      const hostDest: [number, number] = kind === 'greet' ? [hostRest.x, hostRest.z] : pair[0]
      const guestDest: [number, number] = kind === 'greet' ? [guestRest.x, guestRest.z] : pair[1]

      const hostTravel = kind === 'greet'
        ? 0
        : travelSeconds({ x: hostRest.x, z: hostRest.z, room }, room, hostDest)
      const guestTravel = kind === 'greet'
        ? 0
        : travelSeconds({ x: guestRest.x, z: guestRest.z, room: guestRest.room }, room, guestDest)
      const talkStart = now
        + Math.max(hostTravel, guestTravel) * 1000
        + (kind === 'greet' ? 900 : 2500)
      const seed = Math.floor(this.rng() * 0x7fffffff)
      const built = buildPairLines(kind, host, guest, room.id, tasks, talkStart, seed)
      const id = `${kind}-${host.id}-${guest.id}-${Math.round(talkStart)}`
      const endsAt = built.talkEnd + 1200
      const basisHost = basisFor(host, tasks)
      const basisGuest = basisFor(guest, tasks)

      this.cues.set(host.id, {
        id, kind, role: 'host', agentId: host.id, partnerId: guest.id, roomId: room.id,
        destination: hostDest, faceTarget: guestDest,
        seated: kind === 'greet' && hostRest.seated,
        talkStart, talkEnd: built.talkEnd, endsAt, lines: built.lines, basis: basisHost,
      })
      this.cues.set(guest.id, {
        id, kind, role: 'guest', agentId: guest.id, partnerId: host.id, roomId: room.id,
        destination: guestDest, faceTarget: hostDest,
        seated: kind === 'greet' && guestRest.seated,
        talkStart, talkEnd: built.talkEnd, endsAt, lines: built.lines, basis: basisGuest,
      })
      this.revision += 1
      return true
    }
    return false
  }

  private tryWander(
    eligible: Agent[],
    tasks: Task[],
    slots: Record<number, number>,
    now: number,
  ): boolean {
    const resting = new Map<number, RestingPose>(
      eligible.map((agent) => [agent.id, restingPose(agent, slots[agent.id] ?? 0)]),
    )
    const soloByRoom = new Map<string, number>()
    const pairRooms = new Set<string>()
    for (const cue of this.cues.values()) {
      if (cue.partnerId == null) soloByRoom.set(cue.roomId, (soloByRoom.get(cue.roomId) ?? 0) + 1)
      else pairRooms.add(cue.roomId)
    }

    const roamers = eligible.filter((agent) => isSocialRoom(resting.get(agent.id)!.room.id))
    if (!roamers.length) return false

    const start = Math.floor(this.rng() * roamers.length)
    for (let i = 0; i < roamers.length; i += 1) {
      const agent = roamers[(start + i) % roamers.length]
      const from = resting.get(agent.id)!
      const destinations = SOCIAL_ROOM_IDS.filter((id) => {
        if (id === from.room.id || pairRooms.has(id)) return false
        const cap = id === 'pantry' || id === 'lobby' ? 2 : 1
        return (soloByRoom.get(id) ?? 0) < cap
      })
      if (!destinations.length) continue

      const destId = destinations[Math.floor(this.rng() * destinations.length)]
      const slot = soloByRoom.get(destId) ?? 0
      const dest = wanderPoint(destId, slot)
      const destRoom = ROOMS[destId]

      const inSeconds = travelSeconds({ x: from.x, z: from.z, room: from.room }, destRoom, dest)
      const talkStart = now + inSeconds * 1000 + 900
      const seed = Math.floor(this.rng() * 0x7fffffff)
      const built = buildWanderLines(agent, destId, talkStart, seed)
      const dwell = 14_000 + this.rng() * 6_000
      // The cue ends when the visit is over; the walk home is the normal desk route.
      const endsAt = talkStart + Math.max(dwell, built.talkEnd - talkStart)
      const faceTarget: [number, number] = [destRoom.center[0], destRoom.center[1]]

      this.cues.set(agent.id, {
        id: `wander-${agent.id}-${Math.round(talkStart)}`,
        kind: 'wander', role: 'solo', agentId: agent.id, partnerId: null, roomId: destId,
        destination: dest, faceTarget, seated: false,
        talkStart, talkEnd: built.talkEnd, endsAt, lines: built.lines, basis: basisFor(agent, tasks),
      })
      this.revision += 1
      return true
    }
    return false
  }
}

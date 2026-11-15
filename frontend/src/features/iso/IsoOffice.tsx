/** 2D isometric office (PixiJS). Same data as the 3D scene — agents, tasks, the journal and the
 *  local social cues — drawn as a painted diorama with chibi figures, in the style of an office
 *  management game. Rooms, desks and routes come from `officeLayout.ts`, so a person sits at the
 *  same desk and walks the same corridor in both renderers. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Application, Container } from 'pixi.js'
import { poseFor, pulseAge, stationSlots, taskOfAgent } from '../../lib/activity'
import { ROOMS, ROOM_ORDER, FLOOR, OPERATIONAL_ROLES } from '../../lib/officeLayout'
import { fitView, iso, zIndexOf, zoomAt, facingView, type IsoView } from '../../lib/iso'
import { useSocialLife } from '../office/useSocialLife'
import { activeSocialLine, prefersReducedMotion, type CueMap } from '../office/socialScript'
import type { StaffVariant } from '../office/staffScript'
import { X } from 'lucide-react'
import { api } from '../../lib/api'
import type { Agent, ClaudeSession, StreamEvent, Task } from '../../types'
import { Avatar, bubbleLine, lookForAgent, lookForClaude, type AlertKind } from './avatar'
import { actionFor } from './actions'
import { breakGoalFor, errandFor } from './errands'
import type { MotionGoal } from './motion'
import { briefingActive, briefingFor, briefingGoal, type Briefing } from './briefing'
import { gestureFor, isBreakGoal, isPresenter, presenterGoal } from './poses'
import { claudeBubble, claudeGoals, claudeNames, freeDesks, onBreak, type Desk } from './claudeSeats'
import { buildOffice, type OfficeArt } from './officeArt'
import { agentTag, goalFor, initialMotion, stepMotion, type MotionState } from './motion'

const OPEN = new Set(['pending', 'clarifying', 'awaiting_approval', 'approved', 'queued', 'running', 'reviewing'])

/** Screen tint for a desk screen, keyed to the real status of whoever sits there. */
const SCREEN_TINT: Record<Agent['status'], number> = {
  working: 0x86eadb,
  waiting: 0xf3c987,
  reviewing: 0xc9bcf2,
  failed: 0xf09089,
  completed: 0x9adcbf,
  idle: 0x2b3a48,
}

const SIZE_KEY = 'agentville.iso.agentSize'
const FULL: [number, number, number, number] = [-FLOOR.halfX, -FLOOR.halfZ, FLOOR.halfX, FLOOR.halfZ]

function readSize(): number {
  try {
    const v = Number(window.localStorage.getItem(SIZE_KEY))
    return v >= 0.7 && v <= 1.8 ? v : 1
  } catch { return 1 }
}

interface Live {
  agents: Agent[]
  slots: Record<number, number>
  cues: CueMap
  activity: Record<number, StreamEvent>
  taskIds: Record<number, number | undefined>
  selectedId: number | null
  size: number
  onSelect: (id: number) => void
  onStaffTalk: (variant: StaffVariant) => void
  errands: Record<number, StreamEvent>
  briefing: Briefing | null
  meetingTopic?: string
  lastTasks: Record<number, Task | undefined>
  claude: ClaudeSession[]
  claudeNames: Record<string, string>
  desks: Desk[]
  claudeSelected: string | null
  onClaude: (id: string) => void
}

/** Poll interval for Claude Code sessions; the hooks write to the backend, the office reads here. */
const CLAUDE_POLL_MS = 2000

interface Camera {
  view: IsoView
  target: IsoView | null
  focus: string | null
}

export default function IsoOffice({ agents, tasks, selectedId, onSelect, onClearSelection, activity, errands, briefing, meetingTopic, onStaffTalk, leading, qa }: {
  agents: Agent[]
  tasks: Task[]
  selectedId: number | null
  onSelect: (id: number) => void
  onClearSelection: () => void
  activity: Record<number, StreamEvent>
  /** Newest handoff / review-visit frame per acting agent. */
  errands: Record<number, StreamEvent>
  /** Newest plan-briefing frame, replayed as a short meeting. */
  briefing: StreamEvent | null
  meetingTopic?: string
  onStaffTalk: (variant: StaffVariant) => void
  /** Rendered first in the top bar (the 2D/3D switch), so the bar lays itself out in one row. */
  leading?: ReactNode
  qa?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [size, setSize] = useState(readSize)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const cues = useSocialLife(agents, tasks, qa)
  const slots = useMemo(() => stationSlots(agents), [agents])
  const taskIds = useMemo(() => {
    const out: Record<number, number | undefined> = {}
    for (const a of agents) {
      const t = taskOfAgent(a.id, tasks)
      out[a.id] = t && OPEN.has(t.status) ? t.id : undefined
    }
    return out
  }, [agents, tasks])

  const lastTasks = useMemo(() => {
    const out: Record<number, Task | undefined> = {}
    for (const a of agents) out[a.id] = taskOfAgent(a.id, tasks)
    return out
  }, [agents, tasks])
  const briefingPlan = useMemo(() => briefingFor(briefing, agents), [briefing, agents])
  const [claude, setClaude] = useState<ClaudeSession[]>([])
  const [claudeSelected, setClaudeSelected] = useState<string | null>(null)
  const desks = useMemo(() => freeDesks(agents, slots), [agents, slots])
  const names = useMemo(() => claudeNames(claude), [claude])
  const onClaude = (id: string) => { onClearSelection(); setClaudeSelected(id) }
  // Picking an AgentVille agent closes the Claude panel, so only one dialog is ever open.
  useEffect(() => { if (selectedId != null) setClaudeSelected(null) }, [selectedId])

  // Claude Code sessions reported by the optional hooks. A failed poll keeps the last list.
  useEffect(() => {
    let alive = true
    const load = () => {
      if (document.hidden) return
      api.claudeSessions().then((d) => { if (alive) setClaude(d.sessions) }).catch(() => { /* backend offline */ })
    }
    load()
    const timer = window.setInterval(load, CLAUDE_POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  const live = useRef<Live>({ agents, slots, cues, activity, errands, lastTasks, briefing: briefingPlan, meetingTopic, taskIds, selectedId, size, onSelect, onStaffTalk, claude, claudeNames: names, desks, claudeSelected, onClaude })
  live.current = { agents, slots, cues, activity, errands, lastTasks, briefing: briefingPlan, meetingTopic, taskIds, selectedId, size, onSelect, onStaffTalk, claude, claudeNames: names, desks, claudeSelected, onClaude }
  const camera = useRef<Camera>({ view: { scale: 1, x: 0, y: 0 }, target: null, focus: null })
  const artRef = useRef<OfficeArt | null>(null)
  const dragged = useRef(false)

  // People per room, from backend state only (where the agent is stationed or heading).
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const a of agents) {
      const p = poseFor(a)
      const id = (p.targetRoom ?? p.homeRoom).id
      out[id] = (out[id] ?? 0) + 1
    }
    const goals = claudeGoals(claude, desks, Date.now())
    for (const s of claude) {
      const g = goals[s.session_id]
      if (g) out[g.room.id] = (out[g.room.id] ?? 0) + 1
    }
    return out
  }, [agents, claude, desks])
  const workingNow = agents.filter((a) => a.status === 'working').length
  const claudeSession = claudeSelected ? claude.find((c) => c.session_id === claudeSelected) ?? null : null

  useEffect(() => {
    try { window.localStorage.setItem(SIZE_KEY, String(size)) } catch { /* private mode */ }
  }, [size])

  // Re-aim the camera when the room focus changes.
  useEffect(() => {
    const el = host.current
    if (!el) return
    camera.current.focus = focus
    camera.current.target = framing(focus, el.clientWidth, el.clientHeight)
  }, [focus, ready])

  useEffect(() => {
    if (artRef.current) artRef.current.meetingText.text = meetingTopic?.trim() || 'Ruang rapat\nbelum ada agenda'
  }, [meetingTopic, ready])

  // One Pixi application for the component's lifetime.
  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    let started = false
    const app = new Application()
    const avatars = new Map<number, { avatar: Avatar; motion: MotionState }>()
    const claudeAvatars = new Map<string, { avatar: Avatar; motion: MotionState }>()
    const goalKeys: Record<number, string> = {}
    let ro: ResizeObserver | null = null
    const cleanups: (() => void)[] = []

    app.init({
      resizeTo: el,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      preference: 'webgl',
    }).then(() => {
      if (cancelled) { app.destroy(true, { children: true }); return }
      started = true
      el.appendChild(app.canvas)
      app.canvas.setAttribute('aria-label', 'Kantor isometrik 2D')

      const world = new Container()
      app.stage.addChild(world)
      const art = buildOffice()
      artRef.current = art
      art.meetingText.text = 'Ruang rapat\nbelum ada agenda'
      const sorted = new Container()
      sorted.sortableChildren = true
      world.addChild(art.under, art.back, sorted)
      for (const p of art.props) sorted.addChild(p)

      // Front-of-house staff: scene extras, not backend agents.
      for (const spot of art.staff) {
        const look = spot.variant === 'greeter'
          ? { skin: 0xe8c39c, hair: 0x2f2a28, shirt: 0x2f4f66, trousers: 0x39485a, shoes: 0x2b3036, hairStyle: 1, cap: null, glasses: false }
          : { skin: 0xc08e63, hair: 0x1f2229, shirt: 0x31525f, trousers: 0x333f4c, shoes: 0x262b31, hairStyle: 2, cap: null, glasses: false }
        const a = new Avatar(look, () => { if (!dragged.current) live.current.onStaffTalk(spot.variant) })
        const p = iso(spot.x, spot.z)
        a.root.position.set(p.x, p.y)
        a.root.zIndex = zIndexOf(spot.x, spot.z)
        a.setPose({ ...facingView(spot.facing), sit: 0, moving: false, phase: 0, typing: false, talking: false })
        a.setLabel(spot.variant === 'greeter' ? 'Resepsionis' : 'Teller', 'STAF', 'staff')
        sorted.addChild(a.root)
      }

      camera.current.target = null
      camera.current.view = framing(camera.current.focus, el.clientWidth, el.clientHeight)
      setReady(true)

      ro = new ResizeObserver(() => {
        // `resizeTo` only follows window resizes; the panel also changes size on its own (full
        // screen, the responsive layout), so the renderer is resized here as well.
        app.resize()
        camera.current.target = framing(camera.current.focus, el.clientWidth, el.clientHeight)
      })
      ro.observe(el)

      let labelClock = 0
      let calm = prefersReducedMotion()
      // Normal runs clamp one frame to 50 ms, so a throttled background tab does not teleport
      // anyone. The `?qa` probe instead catches up in 50 ms sub-steps, so a headless or occluded
      // browser (which can run at 1 fps) still shows the same movement as a live one.
      let wallDt = 0
      let lastWall = performance.now()
      const advance = (m: MotionState, g: MotionGoal, dt: number) => {
        // Pixi caps a tick at 100 ms; the probe uses the wall clock instead.
        const span = qa ? Math.max(dt, wallDt) : dt
        const n = qa ? Math.min(100, Math.max(1, Math.ceil(span / 0.05))) : 1
        for (let i = 0; i < n; i++) stepMotion(m, g, span / n)
      }
      let ledClock = 0
      app.ticker.add((ticker) => {
        const dt = ticker.deltaMS / 1000
        const wall = performance.now()
        wallDt = Math.min(5, (wall - lastWall) / 1000)
        lastWall = wall
        const now = Date.now()
        const d = live.current

        // Camera easing toward a requested framing; user pan/zoom clears the target.
        const cam = camera.current
        if (cam.target) {
          const k = Math.min(1, dt * 6)
          // Reduced motion: jump straight to the framing instead of easing toward it.
          const e = calm ? 1 : k
          cam.view = {
            scale: cam.view.scale + (cam.target.scale - cam.view.scale) * e,
            x: cam.view.x + (cam.target.x - cam.view.x) * e,
            y: cam.view.y + (cam.target.y - cam.view.y) * e,
          }
          if (Math.abs(cam.view.scale - cam.target.scale) < 0.001
            && Math.abs(cam.view.x - cam.target.x) < 0.5
            && Math.abs(cam.view.y - cam.target.y) < 0.5) {
            cam.view = cam.target
            cam.target = null
          }
        }
        world.scale.set(cam.view.scale)
        world.position.set(cam.view.x, cam.view.y)

        const activeBriefing = briefingActive(d.briefing, now) ? d.briefing : null
        // The meeting screen shows the briefing topic while it is replayed, else the live topic.
        const screenText = activeBriefing ? activeBriefing.topic : (d.meetingTopic?.trim() || 'Ruang rapat\nbelum ada agenda')
        if (art.meetingText.text !== screenText) art.meetingText.text = screenText

        // Roster sync.
        const ids = new Set(d.agents.map((a) => a.id))
        for (const [id, entry] of avatars) {
          if (!ids.has(id)) { entry.avatar.destroy(); avatars.delete(id) }
        }
        for (const agent of d.agents) {
          if (avatars.has(agent.id)) continue
          const goal = goalFor(agent, d.slots[agent.id] ?? 0, d.cues[agent.id])
          const avatar = new Avatar(lookForAgent(agent), () => { if (!dragged.current) live.current.onSelect(agent.id) })
          avatar.setSize(d.size)
          sorted.addChild(avatar.root)
          avatars.set(agent.id, { avatar, motion: initialMotion(goal, Math.abs(agent.id)) })
        }

        labelClock += dt
        const refreshLabels = labelClock > 0.2
        if (refreshLabels) { labelClock = 0; calm = prefersReducedMotion() }
        const lit = new Map<string, number>()

        for (const agent of d.agents) {
          const entry = avatars.get(agent.id)
          if (!entry) continue
          const { avatar, motion } = entry
          const cue = d.cues[agent.id]
          const slot = d.slots[agent.id] ?? 0
          // Priority: a trip replayed from a real handoff/review frame, then a local social cue,
          // then the after-work break, then the desk the backend assigned.
          const errand = errandFor(d.errands[agent.id], d.agents, d.slots, now)
          // The plan briefing replayed from its journal frame outranks everything but a trip.
          const bGoal = !errand && activeBriefing ? briefingGoal(activeBriefing, agent.id) : null
          const base = cue ? goalFor(agent, slot, cue) : breakGoalFor(agent, d.lastTasks[agent.id], now) ?? goalFor(agent, slot)
          // While a plan waits in the meeting room the Coordinator stands up beside the screen.
          const presenting = !errand && (activeBriefing?.leaderId === agent.id || (!cue && !bGoal && isPresenter(agent, base)))
          const goal = errand?.goal ?? bGoal ?? (presenting ? presenterGoal() : base)
          advance(motion, goal, dt)
          goalKeys[agent.id] = `${goal.key}|route:${motion.route.length}`
          avatar.setCarrying(!!errand?.carrying)
          const p = iso(motion.x, motion.z)
          avatar.root.position.set(p.x, p.y)
          avatar.root.zIndex = zIndexOf(motion.x, motion.z)
          const event = d.activity[agent.id]
          // A fresh per-tool frame says what the hands are doing: writing/running type, reading
          // and searching do not. With no frame the status alone decides, as before.
          const act = actionFor(event, now)
          const typing = !goal.social && goal.kind === 'work' && motion.sit > 0.6 && agent.status === 'working'
            && (act ? act.typing : true)
          const line = cue ? activeSocialLine(cue, agent.id, now) : null
          const greeting = cue?.kind === 'greet' && now < cue.talkStart + 1800
          avatar.setPose({
            ...facingView(motion.facing), sit: motion.sit, moving: motion.moving, phase: motion.phase,
            typing, talking: !!line, calm,
            gesture: gestureFor({
              moving: motion.moving, seated: goal.seated && motion.sit > 0.5, presenting,
              onBreak: isBreakGoal(goal), attention: greeting, action: act?.kind ?? null, typing,
            }),
          })
          const age = pulseAge(event, now)
          const fresh = !cue && age >= 0 && age < 2.2
          avatar.setSelected(d.selectedId === agent.id, agent.status, fresh ? 1 - age / 2.2 : 0)

          // A desk screen lights only for a person the backend actually parked at that desk.
          if (!cue && !OPERATIONAL_ROLES.has(agent.role) && !goal.social && goal.kind !== 'ambient' && motion.sit > 0.5) {
            lit.set(`${goal.room.id}:${slot}`, act ? act.screen : SCREEN_TINT[agent.status])
          }

          if (refreshLabels) {
            avatar.setSize(d.size)
            avatar.setLabel(agent.name, agentTag(agent, d.taskIds[agent.id]), agent.status)
            const alert: AlertKind = agent.status === 'waiting' ? 'waiting' : agent.status === 'failed' ? 'failed' : null
            avatar.setAlert(alert)
            if (errand) avatar.setBubble(bubbleLine(errand.label), 'event', errand.kind === 'review' ? 'read' : null)
            else if (line) avatar.setBubble(bubbleLine(line.text), 'social')
            else if (event?.message && (age < 14 || d.selectedId === agent.id)) avatar.setBubble(bubbleLine(event.message), 'event', act?.kind ?? null)
            else avatar.setBubble(null)
          }
        }

        // Claude Code sessions: same walking rules, desks the agents leave free.
        const liveIds = new Set(d.claude.map((c) => c.session_id))
        for (const [id, entry] of claudeAvatars) {
          if (!liveIds.has(id)) { entry.avatar.destroy(); claudeAvatars.delete(id) }
        }
        const cGoals = claudeGoals(d.claude, d.desks, now)
        for (const s of d.claude) {
          const goal = cGoals[s.session_id]
          if (!goal) continue
          let entry = claudeAvatars.get(s.session_id)
          if (!entry) {
            const avatar = new Avatar(lookForClaude(s.session_id), () => { if (!dragged.current) live.current.onClaude(s.session_id) })
            avatar.setSize(d.size)
            sorted.addChild(avatar.root)
            entry = { avatar, motion: initialMotion(goal, s.session_id.length) }
            claudeAvatars.set(s.session_id, entry)
          }
          const { avatar, motion } = entry
          advance(motion, goal, dt)
          const p = iso(motion.x, motion.z)
          avatar.root.position.set(p.x, p.y)
          avatar.root.zIndex = zIndexOf(motion.x, motion.z)
          const sessionTyping = s.status === 'working' && motion.sit > 0.6
          avatar.setPose({
            ...facingView(motion.facing), sit: motion.sit, moving: motion.moving, phase: motion.phase,
            typing: sessionTyping, talking: false, calm,
            // A session waiting on the user raises a hand; a quiet finished one sips coffee.
            gesture: gestureFor({
              moving: motion.moving, seated: goal.seated && motion.sit > 0.5, presenting: false,
              onBreak: isBreakGoal(goal), attention: s.status === 'waiting', action: null, typing: sessionTyping,
            }),
          })
          const picked = d.claudeSelected === s.session_id
          avatar.setSelected(picked, s.status)
          if (goal.seated && motion.sit > 0.5 && !onBreak(s, now)) {
            const desk = d.desks.find((k) => k.room.id === goal.room.id && goal.key.startsWith(`claude:${k.room.id}:${k.index}:`))
            if (desk) lit.set(`${desk.room.id}:${desk.index}`, SCREEN_TINT[s.status])
          }
          if (refreshLabels) {
            avatar.setSize(d.size)
            avatar.setLabel(d.claudeNames[s.session_id] ?? s.project, 'CLAUDE', s.status)
            avatar.setAlert(s.status === 'waiting' ? 'waiting' : s.status === 'failed' ? 'failed' : null)
            const line = claudeBubble(s, now, picked)
            avatar.setBubble(line ? bubbleLine(line) : null, 'event')
          }
        }

        if (refreshLabels) {
          for (const [key, list] of art.screens) {
            const tint = lit.get(key) ?? SCREEN_TINT.idle
            for (const s of list) s.tint = tint
          }
        }
        ledClock += dt
        if (ledClock > 0.35) {
          ledClock = 0
          art.leds.forEach((g, i) => { g.alpha = calm ? 1 : (Math.sin(now / 300 + i * 1.7) > -0.2) ? 1 : 0.25 })
        }
      })

      // Pan with drag, zoom with wheel, both on the canvas host.
      let down: { x: number; y: number; vx: number; vy: number } | null = null
      const onDown = (e: PointerEvent) => {
        down = { x: e.clientX, y: e.clientY, vx: camera.current.view.x, vy: camera.current.view.y }
        dragged.current = false
      }
      const onMove = (e: PointerEvent) => {
        if (!down) return
        const dx = e.clientX - down.x
        const dy = e.clientY - down.y
        if (!dragged.current && Math.hypot(dx, dy) < 5) return
        dragged.current = true
        camera.current.target = null
        camera.current.view = { ...camera.current.view, x: down.vx + dx, y: down.vy + dy }
      }
      const onUp = () => {
        down = null
        // Let the tap handler see the drag flag first, then clear it.
        window.setTimeout(() => { dragged.current = false }, 0)
      }
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const factor = Math.exp(-e.deltaY * 0.0015)
        camera.current.target = null
        camera.current.view = zoomAt(camera.current.view, factor, e.clientX - rect.left, e.clientY - rect.top, 0.3, 4)
      }
      el.addEventListener('pointerdown', onDown)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      el.addEventListener('wheel', onWheel, { passive: false })
      cleanups.push(() => {
        el.removeEventListener('pointerdown', onDown)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        el.removeEventListener('wheel', onWheel)
      })

      if (qa) {
        (window as unknown as Record<string, unknown>).__agentvilleIso = {
          positions: () => Object.fromEntries([...avatars].map(([id, e]) => [id, { x: e.motion.x, z: e.motion.z, sit: e.motion.sit }])),
          claude: () => Object.fromEntries([...claudeAvatars].map(([id, e]) => [id, { x: e.motion.x, z: e.motion.z, sit: e.motion.sit }])),
          view: () => camera.current.view,
          goals: () => ({ ...goalKeys }),
          leds: () => (artRef.current?.leds ?? []).map((g) => g.alpha),
        }
      }
    }).catch((err: unknown) => {
      if (!cancelled) setFailed(err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelled = true
      ro?.disconnect()
      cleanups.forEach((f) => f())
      artRef.current = null
      if (started) app.destroy(true, { children: true })
    }
  }, [qa])

  const zoomBy = (factor: number) => {
    const el = host.current
    if (!el) return
    camera.current.target = zoomAt(camera.current.view, factor, el.clientWidth / 2, el.clientHeight / 2, 0.3, 4)
  }

  if (failed) {
    return <div className="iso-error">Renderer 2D gagal dimulai: {failed}. Coba mode 3D.</div>
  }

  return (
    <div className="iso-office">
      <div ref={host} className="iso-host" />
      <div className="iso-topbar">
      {leading}
      <nav
        className="iso-rooms" aria-label="Pilih ruangan"
        // A mouse wheel scrolls the chips sideways when they do not all fit.
        onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY }}
      >
        <button type="button" className={focus === null ? 'active' : ''} onClick={() => setFocus(null)}>Semua</button>
        {ROOM_ORDER.map((id) => (
          <button key={id} type="button" className={focus === id ? 'active' : ''} onClick={() => setFocus(id)}>
            {ROOMS[id].label}
            {counts[id] ? <span className="iso-count">{counts[id]}</span> : null}
          </button>
        ))}
      </nav>
      <div className="iso-tools">
        <label className="iso-size">
          <span>Agen</span>
          <input
            type="range" min={0.7} max={1.8} step={0.05} value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label="Ukuran agen"
          />
        </label>
        <button type="button" aria-label="Perbesar" onClick={() => zoomBy(1.25)}>+</button>
        <button type="button" aria-label="Perkecil" onClick={() => zoomBy(0.8)}>−</button>
        <button type="button" aria-label="Pas layar" onClick={() => { setFocus(null); const el = host.current; if (el) camera.current.target = framing(null, el.clientWidth, el.clientHeight) }}>⤢</button>
      </div>
      </div>
      <div className="iso-badge">
        <span className="live-dot" />
        <span>STATUS & TUGAS DARI BACKEND · OBROLAN & JALAN-JALAN = SIMULASI LOKAL{workingNow > 0 ? ` · ${workingNow} BEKERJA` : ''}{claude.length > 0 ? ` · ${claude.length} SESI CLAUDE` : ''}</span>
      </div>
      {claudeSession && (
        <ClaudeDialog
          session={claudeSession}
          name={names[claudeSession.session_id] ?? claudeSession.project}
          onClose={() => setClaudeSelected(null)}
        />
      )}
      {!ready && <div className="iso-loading">Menyiapkan kantor…</div>}
    </div>
  )
}

/** Room tabs sit over the top of the canvas (two rows on narrow screens); framings leave that
 *  strip free. Keep the 520 px threshold in step with the CSS breakpoint for the toolbar. */
function framing(focus: string | null, w: number, h: number): IsoView {
  const TOP_INSET = w < 520 ? 88 : 44
  const room = focus ? ROOMS[focus] : null
  const usable = Math.max(120, h - TOP_INSET)
  const v = room
    ? fitView([room.box[0] - 0.4, room.box[1] - 0.4, room.box[2] + 0.4, room.box[3] + 0.4], w, usable, { pad: 36, height: 2.6, maxScale: 3.2 })
    : fitView(FULL, w, usable, { pad: 22, height: 3, maxScale: 2.2 })
  return { ...v, y: v.y + TOP_INSET }
}

const CLAUDE_STAGE: Record<ClaudeSession['status'], string> = {
  idle: 'Siaga', working: 'Bekerja', waiting: 'Menunggu kamu', completed: 'Selesai', failed: 'Gagal',
}

const HOOK_LABEL: Record<string, string> = {
  SessionStart: 'mulai', UserPromptSubmit: 'tugas', PreToolUse: 'alat', PermissionRequest: 'izin',
  Notification: 'notif', SubagentStart: 'subagen', Stop: 'selesai', StopFailure: 'gagal', SessionEnd: 'tutup',
}

/** Panel for a Claude Code session: only what its hooks reported, newest first. */
function ClaudeDialog({ session, name, onClose }: { session: ClaudeSession; name: string; onClose: () => void }) {
  const home = session.cwd.replace(/^\/Users\/[^/]+/, '~')
  return (
    <div className="agent-dialog claude-dialog" role="dialog" aria-label={`${name} — sesi Claude Code`}
         onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className={`agent-dialog-face claude ${session.status}`}>CC</div>
      <div className="agent-dialog-body">
        <div className="agent-dialog-head">
          <strong>{name}</strong>
          <span className="agent-dialog-role">Claude Code</span>
          <span className={`status-pill ${session.status}`}>{CLAUDE_STAGE[session.status]}</span>
        </div>
        <p className="agent-dialog-doing">{session.activity || 'Belum ada aktivitas.'}</p>
        <ul className="claude-events">
          {session.events.map((e, i) => (
            <li key={`${e.created_at}-${i}`}>
              <time>{new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              <span className="claude-kind">{HOOK_LABEL[e.event] ?? e.event}</span>
              <span>{e.summary}</span>
            </li>
          ))}
        </ul>
        <div className="agent-dialog-meta">
          <span title={session.cwd}>{home}</span>
          <span>{session.tool_count} panggilan alat</span>
          {session.permission_mode && <span>mode {session.permission_mode}</span>}
          <span>dari hook Claude Code</span>
        </div>
      </div>
      <button type="button" className="agent-dialog-close" aria-label="Close" onClick={onClose}><X size={14} /></button>
    </div>
  )
}

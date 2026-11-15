import { Suspense, lazy, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { poseFor, stationSlots, taskOfAgent, workBrief, type WorkBrief } from '../../lib/activity'
import { ENTRANCE, ROOMS, ROOM_ORDER, roomById } from '../../lib/officeLayout'
import { CAMPUS_VIEW } from '../../lib/campusLayout'
import { Campus } from '../campus/Campus'
import { ExploreController, type VirtualPad } from '../campus/ExploreController'
import { AgentFigure, DeskBeacons } from './AgentFigure'
import { Lighting, SKY, SKY_CAMPUS, SKY_EXPLORE } from './Lighting'
import { CorridorProps, RoomFitout } from './RoomFitout'
import { CharacterChat, type CharacterAiMeta } from './CharacterChat'
import { STAFF_INTRO, STAFF_SUGGESTIONS, answerStaff, type StaffVariant } from './staffScript'
import { useSocialLife } from './useSocialLife'
import { isTypingTarget, useFullscreen } from './useFullscreen'
import { Ceiling, DoorLight, EntrancePortal, Floors, OfficeShell, Signage, Walls } from './Structure'
import type { Agent, StreamEvent, Task } from '../../types'

/** Three camera modes over one Canvas:
 *  · `campus` — orbit the bounded campus, interior culled, roof shell on;
 *  · `office` — the original interior diorama with zone focus and agent picking;
 *  · `explore` — real first-person walking on the plaza and through the entrance.
 *  Agent state, event motion and the renderer are never rebuilt by a mode switch. */
export type CameraMode = 'campus' | 'office' | 'explore'
export type Quality = 'high' | 'lean'
/** `2d` is the painted isometric office (PixiJS); `3d` the original React Three Fiber scene. */
export type Renderer = '2d' | '3d'

// Loaded on demand so the 3D-only path never downloads PixiJS, and vice versa for Three's scene.
const IsoOffice = lazy(() => import('../iso/IsoOffice'))

const RENDERER_KEY = 'agentville.renderer'

function readRenderer(): Renderer {
  try { return window.localStorage.getItem(RENDERER_KEY) === '3d' ? '3d' : '2d' } catch { return '2d' }
}

interface View {
  pos: [number, number, number]
  look: [number, number, number]
  fov: number
}

/** Office View keeps the 3/4 framing; focus narrows to one zone from the same direction. */
function viewFor(mode: CameraMode, focus: string | null): View {
  if (mode === 'office' && focus && ROOMS[focus]) {
    const r = ROOMS[focus]
    return { pos: [r.center[0] + 3.2, 6.4, r.center[1] + 6.8], look: [r.center[0], 0.9, r.center[1]], fov: 40 }
  }
  if (mode === 'campus' || mode === 'explore') {
    return {
      pos: [...CAMPUS_VIEW.pos] as [number, number, number],
      look: [...CAMPUS_VIEW.look] as [number, number, number],
      fov: CAMPUS_VIEW.fov,
    }
  }
  // A higher, closer 3/4 view than the old 18.5/24.5 framing: the plate still fits horizontally
  // at the panel's aspect, but the far wall and the near workstations fill the vertical frame.
  return { pos: [0, 20, 20], look: [0, 1.1, 0.3], fov: 42 }
}

/** The aspect ratio the framings were authored against (the desktop office panel). */
const DESIGN_ASPECT = 1.43

/** Keep horizontal coverage constant: below the design aspect, widen the vertical fov instead of
 * letting the near corners of the floor plate fall outside the frame. */
function aspectFov(fov: number, aspect: number): number {
  const half = Math.tan(THREE.MathUtils.degToRad(fov) / 2)
  const scaled = aspect < DESIGN_ASPECT ? (half * DESIGN_ASPECT) / Math.max(0.5, aspect) : half
  return Math.min(82, THREE.MathUtils.radToDeg(Math.atan(scaled) * 2))
}

/** Eases camera and orbit target to the requested framing, then hands control back to the user. */
const EASE_SECONDS = 1.1

function CameraDirector({ view }: { view: View }) {
  const { camera, controls, size } = useThree()
  const progress = useRef(1)
  const from = useMemo(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3() }), [])
  const goal = useMemo(() => ({
    pos: new THREE.Vector3(...view.pos),
    look: new THREE.Vector3(...view.look),
  }), [view])
  useEffect(() => {
    from.pos.copy(camera.position)
    const orbit = controls as unknown as { target?: THREE.Vector3 } | null
    if (orbit?.target) from.look.copy(orbit.target)
    progress.current = 0
    // fov is set here rather than through the Canvas `camera` prop, which only reliably applies at
    // creation. `view.fov` is authored for the desktop canvas aspect; a narrower container gets a
    // taller vertical fov so the floor plate keeps the same horizontal coverage instead of cropping.
    const cam = camera as THREE.PerspectiveCamera
    if (!cam.isPerspectiveCamera) return
    const wanted = aspectFov(view.fov, size.width / Math.max(1, size.height))
    if (Math.abs(cam.fov - wanted) > 0.05) {
      cam.fov = wanted
      cam.updateProjectionMatrix()
    }
  }, [view, camera, controls, size, from])
  // Interpolating between a captured start and the goal over a fixed wall-clock duration, rather
  // than a per-frame exponential: a per-frame ease never reaches its target when the renderer runs
  // at a few frames a second, and a half-finished move to eye height leaves the camera above the roof.
  useFrame((_, delta) => {
    if (progress.current >= 1) return
    progress.current = Math.min(1, progress.current + delta / EASE_SECONDS)
    const t = progress.current
    const k = t * t * (3 - 2 * t)
    camera.position.lerpVectors(from.pos, goal.pos, k)
    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null
    if (orbit?.target) {
      orbit.target.lerpVectors(from.look, goal.look, k)
      orbit.update?.()
    }
  })
  return null
}

function OfficeFloor({ agents, tasks, selectedId, onSelect, activity, meetingTopic, mode, quality, qa, onStaffTalk }: {
  agents: Agent[]
  tasks?: Task[]
  selectedId: number | null
  onSelect: (id: number) => void
  activity?: Record<number, StreamEvent>
  meetingTopic?: string
  mode: CameraMode
  quality: Quality
  qa?: boolean
  onStaffTalk?: (variant: StaffVariant) => void
}) {
  // Local social cues. They only move figures and speech bubbles; backend rows stay untouched.
  const cues = useSocialLife(agents, tasks ?? [], qa)
  // A zone counts as occupied when a real event parked a non-idle agent inside it. A colleague
  // who is only chatting or roaming does not light the door or a desk beacon.
  const occupied = useMemo(() => {
    const set = new Set<string>()
    for (const a of agents) {
      if (cues[a.id]) continue
      const p = poseFor(a)
      if (!p.targetRoom && p.kind !== 'ambient') set.add(p.homeRoom.id)
    }
    return set
  }, [agents, cues])
  // Which desk each agent owns, resolved once so two people never share a chair.
  const slots = useMemo(() => stationSlots(agents), [agents])
  const sky = mode === 'office' ? SKY : mode === 'campus' ? SKY_CAMPUS : SKY_EXPLORE
  const extent = mode === 'office' ? 15 : 68
  const interior = mode !== 'campus'
  return (
    <>
      <color attach="background" args={[sky.color]} />
      <fog attach="fog" args={[sky.color, sky.near, sky.far]} />
      <Lighting quality={quality} extent={extent} />
      <Campus visible={mode !== 'office'} />
      <Floors />
      <Walls shell={mode === 'campus'} partitions={interior} cullGlass={mode === 'office'} />
      <OfficeShell visible={mode === 'campus'} />
      <EntrancePortal canopy={mode !== 'office'} />
      <group visible={interior}>
        <Ceiling visible={mode === 'explore'} />
        <Signage />
        {ROOM_ORDER.map((id) => <DoorLight key={id} room={ROOMS[id]} occupied={occupied.has(id)} />)}
        <CorridorProps />
        {ROOM_ORDER.map((id) => <RoomFitout key={id} id={id} active={occupied.has(id)} topic={meetingTopic} onStaffTalk={onStaffTalk} />)}
        <DeskBeacons agents={agents} slots={slots} social={cues} />
        {agents.map((agent) => (
          <AgentFigure
            key={agent.id}
            agent={agent}
            slot={slots[agent.id] ?? 0}
            selected={selectedId === agent.id}
            onSelect={() => onSelect(agent.id)}
            event={activity?.[agent.id]}
            social={cues[agent.id]}
          />
        ))}
      </group>
    </>
  )
}

const HINTS: Record<CameraMode, string> = {
  campus: 'Campus View — drag to orbit the bounded campus · scroll to zoom · Explore to walk it',
  office: 'Office View — drag to orbit · Scroll to zoom · Click a person · Zones light up only when a real event parks an agent there',
  explore: 'Explore — click the scene for mouse look · WASD / arrows walk · Shift runs · Esc frees the mouse, press again to exit',
}

export default function OfficeScene({ agents, tasks, selectedId, onSelect, activity, errands, meetingTopic }: {
  agents: Agent[]
  tasks?: Task[]
  selectedId: number | null
  onSelect: (id: number | null) => void
  activity?: Record<number, StreamEvent>
  /** Newest handoff / review-visit frame per acting agent (2D office replays the trip). */
  errands?: Record<number, StreamEvent>
  meetingTopic?: string
}) {
  const [mode, setMode] = useState<CameraMode>('office')
  const [focus, setFocus] = useState<string | null>(null)
  const [quality, setQuality] = useState<Quality>('high')
  const [nearEntrance, setNearEntrance] = useState(false)
  const [staffTalk, setStaffTalk] = useState<StaffVariant | null>(null)
  const [renderer, setRenderer] = useState<Renderer>(readRenderer)
  const boxRef = useRef<HTMLDivElement>(null)
  const fullscreen = useFullscreen(boxRef)
  // `F` toggles full screen from anywhere on the office view, except while typing.
  const toggleFullscreen = fullscreen.toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      e.preventDefault()
      toggleFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFullscreen])
  useEffect(() => {
    try { window.localStorage.setItem(RENDERER_KEY, renderer) } catch { /* private mode */ }
  }, [renderer])
  const pad = useRef<VirtualPad>({ forward: false, back: false, left: false, right: false })
  const supported = useMemo(hasWebGL, [])
  const qa = useMemo(() => {
    try { return new URLSearchParams(window.location.search).has('qa') } catch { return false }
  }, [])
  const view = useMemo(() => viewFor(mode, focus), [mode, focus])
  const orbit = useMemo(() => (mode === 'campus'
    ? { min: 18, max: 160, maxPolar: 1.45, pan: true }
    : { min: 7, max: 44, maxPolar: 1.32, pan: false }), [mode])
  // The on-screen dialogue box reads only real state: the selected agent row, its task row and the
  // freshest journal frame. Nothing here is invented, so an idle figure honestly says it is idle.
  const selected = selectedId == null ? null : agents.find((a) => a.id === selectedId) ?? null
  const brief = useMemo(
    () => (selected ? workBrief(selected, taskOfAgent(selected.id, tasks ?? []), activity?.[selected.id]) : null),
    [selected, tasks, activity],
  )
  const selectedRoom = selected ? roomById(selected.current_room) : null
  // The badge reports the real working count so the office never claims more activity than the
  // backend actually shows. Zero working agents reads honestly as zero.
  const workingNow = agents.filter((a) => a.status === 'working').length

  if (!supported) return <SceneFallback agents={agents} selectedId={selectedId} onSelect={onSelect} />

  const switchMode = (next: CameraMode) => {
    setMode(next)
    if (next !== 'office') { setFocus(null); setStaffTalk(null) }
    if (next !== 'explore') setNearEntrance(false)
  }
  const setPad = (key: keyof VirtualPad, value: boolean) => { pad.current[key] = value }
  const hold = (key: keyof VirtualPad) => ({
    onPointerDown: (e: ReactPointerEvent) => { e.preventDefault(); setPad(key, true) },
    onPointerUp: () => setPad(key, false),
    onPointerLeave: () => setPad(key, false),
    onPointerCancel: () => setPad(key, false),
  })

  // Explore only exists in the 3D scene, so the 2D renderer gets an explicit door to it instead of
  // hiding the feature behind a renderer toggle nobody would guess.
  const goExplore = () => { setRenderer('3d'); switchMode('explore') }
  const rendererSwitch = (withExplore = false) => (
    <div className="renderer-switch" role="group" aria-label="Renderer">
      <button type="button" className={renderer === '2d' ? 'active' : ''} onClick={() => setRenderer('2d')}>2D</button>
      <button type="button" className={renderer === '3d' ? 'active' : ''} onClick={() => setRenderer('3d')}>3D</button>
      {withExplore && <button type="button" onClick={goExplore}>Explore</button>}
      <button
        type="button" className="fs" onClick={fullscreen.toggle}
        aria-pressed={fullscreen.active}
        aria-label={fullscreen.active ? 'Keluar layar penuh' : 'Layar penuh'}
        title={fullscreen.active ? 'Keluar layar penuh (F / Esc)' : 'Layar penuh (F)'}
      >{fullscreen.active ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
    </div>
  )

  const dialogs = (
    <>
      {selected && brief && (
        <AgentDialog
          key={selected.id}
          agent={selected}
          brief={brief}
          room={selectedRoom?.label ?? 'On the floor'}
          target={selected.target_room && selected.target_room !== selected.current_room
            ? roomById(selected.target_room).label : null}
          onClose={() => onSelect(null)}
        />
      )}
      {staffTalk && (
        <StaffDialog
          key={staffTalk}
          variant={staffTalk}
          agents={agents}
          onClose={() => setStaffTalk(null)}
        />
      )}
    </>
  )

  if (renderer === '2d') {
    return (
      <div ref={boxRef} className={`office-canvas iso${selected || staffTalk ? ' has-dialog' : ''}${fullscreen.overlay ? ' expanded' : ''}`} id="office-canvas" data-mode="2d" data-qa={qa ? '1' : '0'} data-fullscreen={fullscreen.active ? '1' : '0'}>
        <Suspense fallback={<div className="iso-loading">Memuat kantor 2D…</div>}>
          <IsoOffice
            agents={agents}
            tasks={tasks ?? []}
            selectedId={selectedId}
            onSelect={(id) => { setStaffTalk(null); onSelect(id) }}
            onClearSelection={() => { setStaffTalk(null); onSelect(null) }}
            activity={activity ?? {}}
            errands={errands ?? {}}
            meetingTopic={meetingTopic}
            onStaffTalk={(variant) => { onSelect(null); setStaffTalk(variant) }}
            qa={qa}
          />
        </Suspense>
        {rendererSwitch(true)}
        {dialogs}
      </div>
    )
  }

  return (
    <div ref={boxRef} className={`office-canvas ${mode}${selected || staffTalk ? ' has-dialog' : ''}${fullscreen.overlay ? ' expanded' : ''}`} id="office-canvas" data-mode={mode} data-qa={qa ? '1' : '0'} data-fullscreen={fullscreen.active ? '1' : '0'}>
      {rendererSwitch()}
      <Canvas
        shadows
        dpr={quality === 'high' ? [1, 1.8] : [1, 1.2]}
        camera={{ position: view.pos, fov: view.fov, near: 0.2, far: 340 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => { gl.toneMappingExposure = 1.0 }}
      >
        <OfficeFloor
          agents={agents}
          tasks={tasks}
          selectedId={selectedId}
          onSelect={(id) => { setStaffTalk(null); onSelect(id) }}
          activity={activity}
          meetingTopic={meetingTopic}
          mode={mode}
          quality={quality}
          qa={qa}
          onStaffTalk={(variant) => { onSelect(null); setStaffTalk(variant) }}
        />
        <OrbitControls
          makeDefault
          enabled={mode !== 'explore'}
          minDistance={orbit.min}
          maxDistance={orbit.max}
          minPolarAngle={0.25}
          maxPolarAngle={orbit.maxPolar}
          enablePan={orbit.pan}
          enableDamping
          dampingFactor={0.08}
        />
        {mode !== 'explore' && <CameraDirector view={view} />}
        {mode === 'explore' && (
          <ExploreController
            active
            paused={staffTalk !== null || selected !== null}
            spawn={ENTRANCE.plazaSpawn}
            pad={pad}
            onExit={() => switchMode('campus')}
            onNearEntrance={setNearEntrance}
          />
        )}
      </Canvas>

      <div className="scene-controls">
        <div className="scene-segment" role="group" aria-label="Camera mode">
          <button type="button" className={`scene-btn ${mode === 'campus' ? 'active' : ''}`} onClick={() => switchMode('campus')}>Campus</button>
          <button type="button" className={`scene-btn ${mode === 'office' ? 'active' : ''}`} onClick={() => switchMode('office')}>Office</button>
          <button type="button" className={`scene-btn ${mode === 'explore' ? 'active' : ''}`} onClick={() => switchMode('explore')}>Explore</button>
        </div>
        <div className="scene-rooms" role="group" aria-label="Focus a zone">
          <button type="button" className={`scene-chip ${focus === null && mode === 'office' ? 'active' : ''}`} onClick={() => { switchMode('office'); setFocus(null) }}>All zones</button>
          {ROOM_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className={`scene-chip ${focus === id && mode === 'office' ? 'active' : ''}`}
              onClick={() => { setMode('office'); setFocus(id) }}
              title={ROOMS[id].label}
            >{ROOMS[id].label}</button>
          ))}
        </div>
        <button
          type="button"
          className={`scene-chip quality ${quality === 'lean' ? 'active' : ''}`}
          onClick={() => setQuality(quality === 'high' ? 'lean' : 'high')}
          title="Turns off sun shadows and lowers resolution scaling for weaker machines"
        >{quality === 'high' ? 'Quality: high' : 'Quality: lean'}</button>
      </div>

      <div className="scene-badge">
        <span className="live-dot" />
        <span>STATE & TASKS FROM BACKEND · SOCIAL CHATTER & ROAMING ARE LOCAL SIMULATION{workingNow > 0 ? ` · ${workingNow} WORKING NOW` : ''}</span>
      </div>
      <div className="scene-hint">{HINTS[mode]}</div>

      {dialogs}

      {mode === 'explore' && !staffTalk && !selected && (
        <>
          <div className="explore-crosshair" aria-hidden />
          <button type="button" className="explore-exit" onClick={() => switchMode('campus')}>Exit explore</button>
          <div className="explore-pad" role="group" aria-label="Walk">
            <button type="button" className="pad-btn pad-up" aria-label="Walk forward" {...hold('forward')}>▲</button>
            <button type="button" className="pad-btn pad-left" aria-label="Walk left" {...hold('left')}>◀</button>
            <button type="button" className="pad-btn pad-right" aria-label="Walk right" {...hold('right')}>▶</button>
            <button type="button" className="pad-btn pad-down" aria-label="Walk back" {...hold('back')}>▼</button>
          </div>
          {nearEntrance && (
            <div className="scene-proximity">Main entrance · the open doors lead into the lobby</div>
          )}
        </>
      )}
    </div>
  )
}

const STAGE_ID: Record<string, string> = {
  Resting: 'siaga',
  Working: 'bekerja',
  Waiting: 'menunggu',
  'In review': 'meninjau',
  Completed: 'selesai',
  Failed: 'gagal',
}

const AGENT_SUGGESTIONS = [
  'Apa yang sedang kamu kerjakan?',
  'Bisa konsultasi soal tugasmu?',
  'Apa peranmu di tim?',
  'Apa langkah berikutnya?',
]

/** Game-style dialogue box: appears over the scene when a figure is picked. The Tanya tab asks
 * this specific person through the AI character endpoint; the Status tab keeps the original
 * real-state brief. The intro and local fallback use only the agent row and task row. */
function AgentDialog({ agent, brief, room, target, onClose }: {
  agent: Agent
  brief: WorkBrief
  room: string
  target: string | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<'chat' | 'status'>('chat')
  const [aiMeta, setAiMeta] = useState<CharacterAiMeta | null>(null)
  const pct = Math.round(brief.fraction * 100)
  const stage = STAGE_ID[brief.stage] ?? brief.stage
  return (
    <div
      className="agent-dialog agent-dialog-chat"
      role="dialog"
      aria-label={`${agent.name} — tanya jawab`}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div className={`agent-dialog-face ${agent.status}`}>{initials(agent.name)}</div>
      <div className="agent-dialog-body">
        <div className="agent-dialog-head">
          <strong>{agent.name}</strong>
          <span className="agent-dialog-role">{agent.role}</span>
          <span className={`status-pill ${agent.status}`}>{brief.stage}</span>
        </div>
        <div className="dialog-tabs" role="tablist" aria-label={`${agent.name} — panel`}>
          <button
            type="button" role="tab" aria-selected={tab === 'chat'}
            className={tab === 'chat' ? 'active' : ''}
            onClick={() => setTab('chat')}
          >Tanya AI</button>
          <button
            type="button" role="tab" aria-selected={tab === 'status'}
            className={tab === 'status' ? 'active' : ''}
            onClick={() => setTab('status')}
          >Status</button>
        </div>
        {tab === 'status' ? (
          <div role="tabpanel" aria-label="Status">
            <p className="agent-dialog-doing">{brief.doing}</p>
            <div className="agent-dialog-bar" aria-hidden>
              <span className={`fill ${agent.status}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="agent-dialog-meta">
              <span>{room}{target ? ` → ${target}` : ''}</span>
              <span>{brief.task ? brief.task.title : 'No task assigned'}</span>
              <span className="agent-dialog-pct">{pct}%{brief.step != null ? ` · step #${brief.step}` : ''}</span>
            </div>
          </div>
        ) : (
          <div role="tabpanel" aria-label="Tanya">
            <div className="agent-dialog-meta agent-dialog-live">
              <span>{stage}</span>
              <span>{room}{target ? ` → ${target}` : ''}</span>
              {aiMeta && (
                <span className={`dialog-ai ${aiMeta.mode}`}>
                  {aiMeta.mode === 'ai' ? `AI ${aiMeta.provider}` : 'lokal'}
                </span>
              )}
            </div>
            <CharacterChat
              character={`agent:${agent.id}`}
              intro={`Halo, saya ${agent.name}, ${agent.role}. Status saya sekarang: ${stage}. Silakan tanya soal pekerjaan saya atau minta konsultasi sesuai peran saya.`}
              suggestions={AGENT_SUGGESTIONS}
              placeholder={`Tanya ${agent.name}…`}
              offlineReply={(question) => localAgentReply(agent, brief, question)}
              onMeta={setAiMeta}
            />
          </div>
        )}
      </div>
      <button type="button" className="agent-dialog-close" aria-label="Close" onClick={onClose}><X size={14} /></button>
    </div>
  )
}

const TASK_STATUS_ID: Record<string, string> = {
  pending: 'menunggu', clarifying: 'klarifikasi', awaiting_approval: 'menunggu persetujuan',
  approved: 'disetujui', queued: 'dalam antrean', running: 'berjalan',
  reviewing: 'ditinjau', completed: 'selesai', failed: 'gagal', cancelled: 'dibatalkan',
}

function localAgentReply(agent: Agent, brief: WorkBrief, question: string): string {
  const title = brief.task && brief.task.title.length > 90
    ? `${brief.task.title.slice(0, 87)}…`
    : brief.task?.title
  const task = brief.task
    ? `Tugas ${TASK_STATUS_ID[brief.task.status] ?? brief.task.status}: “${title}”.`
    : 'Belum ada tugas yang terhubung ke saya.'
  if (/(konsultasi|saran|pendapat|bisa bantu|tanya|diskusi)/i.test(question)) {
    return `Saya ${agent.name}, ${agent.role}. ${task} AI belum aktif, jadi saya belum bisa menjawab bebas; aktifkan AI di panel AI Engine agar kita bisa berdiskusi penuh.`
  }
  return `Status saya: ${STAGE_ID[brief.stage] ?? brief.stage}. ${brief.doing} ${task} AI belum aktif, jadi jawaban ini dari status backend terakhir.`
}

const STAFF_META: Record<StaffVariant, { name: string; role: string; room: string; badge: string }> = {
  greeter: { name: 'Front Desk', role: 'Reception', room: 'Lobby & Reception', badge: 'FD' },
  teller: { name: 'Teller', role: 'Customer Service', room: 'Customer Service', badge: 'TL' },
}

/** Front-of-house Q&A. Staff are fit-out extras, so the AI persona lives on the server and uses
 *  the live roster/map; if AI is off the same box falls back to the local knowledge base. It
 *  never mutates tasks, plans or agent data. */
function StaffDialog({ variant, agents, onClose }: {
  variant: StaffVariant
  agents: { name: string; role: string }[]
  onClose: () => void
}) {
  const meta = STAFF_META[variant]
  const [aiMeta, setAiMeta] = useState<CharacterAiMeta | null>(null)
  return (
    <div
      className="agent-dialog staff-dialog"
      role="dialog"
      aria-label={`${meta.name} — tanya jawab`}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div className="agent-dialog-face working">{meta.badge}</div>
      <div className="agent-dialog-body">
        <div className="agent-dialog-head">
          <strong>{meta.name}</strong>
          <span className="agent-dialog-role">{meta.role}</span>
          <span className="status-pill working">Siap membantu</span>
        </div>
        <CharacterChat
          character={`staff:${variant}`}
          intro={STAFF_INTRO[variant]}
          suggestions={STAFF_SUGGESTIONS[variant]}
          placeholder={`Tanya ${meta.name}…`}
          offlineReply={(question) => answerStaff(variant, question, { agents })}
          onMeta={setAiMeta}
        />
        <div className="agent-dialog-meta">
          <span>{meta.room}</span>
          <span>Bukan agen backend · tidak mengubah task</span>
          {aiMeta && (
            <span className={`dialog-ai ${aiMeta.mode}`}>
              {aiMeta.mode === 'ai' ? `AI ${aiMeta.provider}` : 'AI nonaktif · jawaban lokal'}
            </span>
          )}
        </div>
      </div>
      <button type="button" className="agent-dialog-close" aria-label="Close" onClick={onClose}><X size={14} /></button>
    </div>
  )
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase()
}

/** Machines with WebGL switched off (or without a context at all) still have to show who is where,
 * so the scene degrades to the same live state as a list instead of a blank panel. */
function hasWebGL(): boolean {
  try {
    const probe = document.createElement('canvas')
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

function SceneFallback({ agents, selectedId, onSelect }: {
  agents: Agent[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  return (
    <div className="office-fallback">
      <p className="fallback-note">
        This browser has no WebGL context, so the office is shown as a list. The 3D scene needs
        hardware acceleration enabled.
      </p>
      <ul>
        {agents.map((agent) => {
          const room = poseFor(agent).homeRoom
          return (
            <li key={agent.id}>
              <button
                type="button"
                className={`fallback-row ${selectedId === agent.id ? 'selected' : ''}`}
                onClick={() => onSelect(agent.id)}
              >
                <span className={`legend-dot ${agent.status}`} />
                <strong>{agent.name}</strong>
                <span className="fallback-role">{agent.role}</span>
                <span className="fallback-room">{room.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

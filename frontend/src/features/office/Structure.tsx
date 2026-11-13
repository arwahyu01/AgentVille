import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Group } from 'three'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import { C, STATUS_DOT } from './palette'
import { Box, Plane, mat } from './primitives'
import { surfaceTex, type SurfaceKind } from './textures'
import { CORRIDOR, DOOR_H, DOOR_W, ENTRANCE, FLOOR, ROOMS, ROOM_ORDER, WALLS, type Room, type WallSegment } from '../../lib/officeLayout'

const T = 0.09
const scratchDir = new THREE.Vector3()
const scratchOrigin = new THREE.Vector3()

/** Orient a wall box along the segment and return its centre, length and rotation. */
function place(a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  return {
    len: Math.hypot(dx, dz),
    angle: Math.atan2(-dz, dx),
    mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number],
  }
}

/** Plain painted partition with a skirting board and a shadow-gap reveal at the top. Faint plaster
 *  grain stops a long wall from reading as one flat slab under the daylight. */
function SolidWall({ seg }: { seg: WallSegment }) {
  const { len, angle, mid } = place(seg.a, seg.b)
  return (
    <group position={[mid[0], 0, mid[1]]} rotation={[0, angle, 0]}>
      <Box size={[len, seg.height, T]} at={[0, seg.height / 2, 0]} m={mat('#ffffff', { rough: 0.92, map: surfaceTex('concrete', C.wall, [Math.max(1, Math.round(len / 2)), Math.max(1, Math.round(seg.height / 2))]) })} cast receive />
      <Box size={[len, 0.09, T + 0.02]} at={[0, 0.045, 0]} m={mat(C.trim, { rough: 0.8 })} />
      <Box size={[len, 0.035, T + 0.015]} at={[0, seg.height - 0.02, 0]} m={mat(C.wallShade, { rough: 0.9 })} />
    </group>
  )
}

/** Slim-framed glazed partition: full-height glass, a mullion grid and a doorway with a held-open leaf. */
function GlassWall({ seg, room }: { seg: WallSegment; room?: Room }) {
  const { len, angle, mid } = place(seg.a, seg.b)
  const frame = mat('#ccd1d4', { rough: 0.38, metal: 0.55 })
  // Looking down the corridor stacks six or seven partitions along one ray; anything much more
  // opaque than this and the far half of the floor washes out to white.
  const glassMat = mat(C.glass, { rough: 0.08, metal: 0.1, opacity: 0.14 })
  const h = seg.height
  const door = seg.door
  const pieces: { from: number; to: number }[] = []
  if (door) {
    const half = door.width / 2 / len
    const c = door.at / len
    if (c - half > 0.01) pieces.push({ from: 0, to: c - half })
    if (c + half < 0.99) pieces.push({ from: c + half, to: 1 })
  } else {
    pieces.push({ from: 0, to: 1 })
  }
  return (
    <group position={[mid[0], 0, mid[1]]} rotation={[0, angle, 0]}>
      {pieces.map((p, i) => {
        const w = (p.to - p.from) * len
        const x = (p.from + p.to) / 2 * len - len / 2
        const posts = Math.max(2, Math.round(w / 2.1) + 1)
        return (
          <group key={i} position={[x, 0, 0]}>
            <Box size={[w, h - 0.02, 0.035]} at={[0, (h - 0.02) / 2 + 0.06, 0]} m={glassMat} />
            <Box size={[w, 0.07, 0.09]} at={[0, 0.035, 0]} m={frame} />
            <Box size={[w, 0.06, 0.09]} at={[0, h, 0]} m={frame} cast />
            {Array.from({ length: posts }, (_, k) => {
              const px = -w / 2 + (k / (posts - 1)) * w
              return <Box key={k} size={[0.055, h, 0.075]} at={[px, h / 2, 0]} m={frame} cast />
            })}
          </group>
        )
      })}
      {door && (
        <group position={[door.at - len / 2, 0, 0]}>
          <Box size={[door.width + 0.14, 0.08, 0.12]} at={[0, DOOR_H + 0.04, 0]} m={frame} cast />
          <Box size={[0.07, DOOR_H, 0.12]} at={[-door.width / 2 - 0.03, DOOR_H / 2, 0]} m={frame} />
          <Box size={[0.07, DOOR_H, 0.12]} at={[door.width / 2 + 0.03, DOOR_H / 2, 0]} m={frame} />
          <Box size={[door.width, h - DOOR_H - 0.12, 0.03]} at={[0, (h + DOOR_H + 0.12) / 2, 0]} m={glassMat} />
          {/* Door leaf held open against the jamb so the route through stays readable. */}
          <group position={[door.width / 2 + 0.02, 0, 0]} rotation={[0, -1.9, 0]}>
            <Box size={[door.width * 0.96, DOOR_H - 0.04, 0.035]} at={[-door.width * 0.48, DOOR_H / 2, 0]} m={mat('#e6e6e2', { rough: 0.35, opacity: 0.4 })} cast />
            <Box size={[0.02, 0.16, 0.02]} at={[-door.width * 0.9, 1.02, 0.05]} m={metalHandle()} />
          </group>
          {room && (
            <Box size={[0.14, 0.22, 0.03]} at={[-door.width / 2 - 0.12, 1.35, 0.06]} m={mat(room.accent, { rough: 0.6 })} />
          )}
        </group>
      )}
    </group>
  )
}

const metalHandle = () => mat(C.metalDark, { rough: 0.3, metal: 0.8 })

/** Curtain-wall facade: solid plinth, full-height glazing with mullions, white head beam.
 * The glazing is culled per frame when the camera is outside that wall — otherwise the near
 * facade of the diorama grids over the entire office and hides the people behind it. The plinth
 * stays, so the building still reads as an enclosed plate from any angle.
 *
 * `shell` is the Campus View casing: the building is seen from outside and the interior is
 * culled, so the glazing stays visible and turns into reflective tinted glass instead. */
function CurtainWall({ seg, shell, cullGlass = false }: { seg: WallSegment; shell?: boolean; cullGlass?: boolean }) {
  const glass = useRef<Group>(null)
  const { len, angle, mid } = place(seg.a, seg.b)
  // Outward normal: the wall's local +z, flipped so it points away from the building centre.
  const normal = useMemo(() => {
    const n = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
    const outward = new THREE.Vector3(mid[0], 0, mid[1])
    return n.multiplyScalar(Math.sign(n.dot(outward)) || 1)
  }, [angle, mid])
  useFrame(({ camera }) => {
    if (!glass.current) return
    // Campus View keeps the tinted casing; Explore is a real first-person exterior, so the glass
    // stays where a window would be. Only the interior diorama culls the near bays.
    if (shell || !cullGlass) { glass.current.visible = true; return }
    scratchOrigin.set(mid[0], 0, mid[1])
    scratchDir.copy(camera.position).sub(scratchOrigin).setY(0).normalize()
    glass.current.visible = normal.dot(scratchDir) < 0.12
  })
  const frame = mat('#c2c7ca', { rough: 0.4, metal: 0.55 })
  const glassMat = shell
    ? mat('#789a97', { rough: 0.16, metal: 0.35, opacity: 0.92 })
    : mat(C.sky, { rough: 0.06, metal: 0.05, opacity: 0.16 })
  // Split the glazing around the main doorway; the floor plinth is interrupted too, so the
  // threshold really is at grade and the player can walk through the opening.
  const pieces = useMemo(() => {
    if (!seg.door) return [{ x0: -len / 2, x1: len / 2 }]
    const centre = seg.door.at - len / 2
    return [
      { x0: -len / 2, x1: centre - seg.door.width / 2 },
      { x0: centre + seg.door.width / 2, x1: len / 2 },
    ].filter((p) => p.x1 - p.x0 > 0.02)
  }, [len, seg.door])
  const doorCentre = seg.door ? seg.door.at - len / 2 : 0
  const head = FLOOR.height - 0.21
  return (
    <group position={[mid[0], 0, mid[1]]} rotation={[0, angle, 0]}>
      {pieces.map((p, i) => {
        const w = p.x1 - p.x0
        const x = (p.x0 + p.x1) / 2
        return (
          <group key={i} position={[x, 0, 0]}>
            <Box size={[w, 0.45, 0.16]} at={[0, 0.225, 0]} m={mat(C.wall, { rough: 0.9 })} cast receive />
            <Box size={[w, 0.04, 0.13]} at={[0, 0.47, 0]} m={frame} />
            <Box size={[w, 0.42, 0.14]} at={[0, head, 0]} m={mat(C.wallShade, { rough: 0.9 })} cast />
            <Box size={[w, 0.04, 0.13]} at={[0, 0.02, 0]} m={mat(C.trim, { rough: 0.8 })} />
          </group>
        )
      })}
      <group ref={glass}>
        {pieces.map((p, i) => {
          const w = p.x1 - p.x0
          const x = (p.x0 + p.x1) / 2
          const bays = Math.max(1, Math.round(w / 2.4))
          const bayW = w / bays
          return (
            <group key={i} position={[x, 0, 0]}>
              <Box size={[w, FLOOR.height - 0.9, 0.03]} at={[0, 0.45 + (FLOOR.height - 0.9) / 2, 0]} m={glassMat} />
              {Array.from({ length: bays + 1 }, (_, k) => {
                const px = -w / 2 + k * bayW
                return <Box key={k} size={[0.08, FLOOR.height - 0.87, 0.1]} at={[px, 0.45 + (FLOOR.height - 0.9) / 2, 0]} m={frame} cast />
              })}
              <Box size={[w, 0.05, 0.11]} at={[0, FLOOR.height - 0.44, 0]} m={frame} />
            </group>
          )
        })}
        {seg.door && (
          <Box size={[seg.door.width, FLOOR.height - 2.5 - 0.02, 0.03]} at={[doorCentre, (2.5 + FLOOR.height) / 2, 0]} m={glassMat} />
        )}
      </group>
      {seg.door && (
        <>
          {/* Header over the opening, so the facade line stays continuous. */}
          <Box size={[seg.door.width + 0.28, 0.42, 0.16]} at={[doorCentre, FLOOR.height - 0.21, 0]} m={mat(C.wallShade, { rough: 0.9 })} cast />
          <Box size={[seg.door.width + 0.34, 0.06, 0.18]} at={[doorCentre, 2.55, 0]} m={mat(C.trim, { rough: 0.75 })} />
          <Box size={[seg.door.width + 0.4, 0.02, 0.42]} at={[doorCentre, 0.012, 0]} m={mat('#c9c2b4', { rough: 0.9 })} receive />
        </>
      )}
    </group>
  )
}

export function Walls({ shell = false, partitions = true, cullGlass = false }: {
  shell?: boolean; partitions?: boolean; cullGlass?: boolean
}) {
  return (
    <group>
      {WALLS.map((seg) => {
        if (seg.kind === 'curtain') return <CurtainWall key={seg.key} seg={seg} shell={shell} cullGlass={cullGlass} />
        if (!partitions) return null
        const owner = Object.values(ROOMS).find((r) => seg.key === `front-${r.id}`)
        if (seg.kind === 'solid') return <SolidWall key={seg.key} seg={seg} />
        return <GlassWall key={seg.key} seg={seg} room={owner} />
      })}
    </group>
  )
}

/** Floor slab, corridor runner and per-zone floor tint with a threshold strip at each door.
 * Every surface carries a procedural pattern (pale stone in the corridor, softer carpet inside the
 * zones) so the plate reads as built space instead of flat colour. `repeat` is the surface size in
 * metres over a 2 m pattern tile, which keeps the grain the same physical size in every room. */
export function Floors() {
  const rooms = Object.values(ROOMS)
  const floorTex = (kind: SurfaceKind, color: string, w: number, d: number) =>
    surfaceTex(kind, color, [Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(d / 2))])
  return (
    <group>
      <Box size={[FLOOR.halfX * 2 + 0.3, 0.12, FLOOR.halfZ * 2 + 0.3]} at={[0, -0.06, 0]} m={mat('#ffffff', { rough: 0.86, map: floorTex('concrete', C.floor, FLOOR.halfX * 2, FLOOR.halfZ * 2) })} receive />
      {rooms.map((r) => {
        const [x0, z0, x1, z1] = r.box
        const w = x1 - x0 - 0.02
        const d = z1 - z0 - 0.02
        const polished = r.kind === 'server' || r.kind === 'meeting'
        return (
          <group key={r.id}>
            <Box size={[w, 0.012, d]} at={[r.center[0], 0.006, r.center[1]]} m={mat('#ffffff', { rough: polished ? 0.6 : 0.9, map: floorTex(polished ? 'tile' : 'carpet', tintOf(r), w, d) })} receive />
            <Box size={[w, 0.004, 0.08]} at={[r.center[0], 0.013, r.band === 'north' ? z1 - 0.12 : z0 + 0.12]} m={mat(r.accent, { rough: 0.8 })} />
          </group>
        )
      })}
      {/* Corridor: paler terrazzo with two inlaid lines that read as the main circulation route. */}
      <Box size={[FLOOR.halfX * 2, 0.014, CORRIDOR.halfZ * 2]} at={[0, 0.007, 0]} m={mat('#ffffff', { rough: 0.72, map: floorTex('tile', C.corridor, FLOOR.halfX * 2, CORRIDOR.halfZ * 2) })} receive />
      {[-0.95, 0.95].map((z) => (
        <Box key={z} size={[FLOOR.halfX * 2 - 0.6, 0.004, 0.05]} at={[0, 0.016, z]} m={mat('#cbc6bc', { rough: 0.8 })} />
      ))}
      {rooms.map((r) => (
        <Box key={`th-${r.id}`} size={[DOOR_W + 0.3, 0.006, 0.34]} at={[r.door[0], 0.018, r.door[1]]} m={mat('#cfc9bd', { rough: 0.8 })} receive />
      ))}
    </group>
  )
}

function tintOf(r: Room): string {
  if (r.kind === 'server') return '#dfe2e4'
  // A 16% wash of the zone accent keeps ten departments distinguishable from the overview
  // without turning the floor into a colour chart.
  return mixHex(r.accent, '#f1ebe0', 0.16)
}

function mixHex(accent: string, base: string, amount: number): string {
  const a = parseInt(accent.slice(1), 16)
  const b = parseInt(base.slice(1), 16)
  const channel = (shift: number) => Math.round(
    ((a >> shift) & 255) * amount + ((b >> shift) & 255) * (1 - amount))
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

/** Ceiling grid. Only shown in Explore mode — the isometric view is an open diorama on purpose. */
export function Ceiling({ visible }: { visible: boolean }) {
  const group = useRef<Group>(null)
  const tiles = useMemo(() => {
    const out: [number, number][] = []
    for (let x = -12; x <= 12; x += 2) for (let z = -8; z <= 8; z += 2) out.push([x, z])
    return out
  }, [])
  // Same diorama rule as the facades: the roof only hides the room from one side, so it drops out
  // as soon as the camera climbs above the ceiling plane.
  useFrame(({ camera }) => {
    if (group.current) group.current.visible = camera.position.y < FLOOR.height - 0.1
  })
  if (!visible) return null
  return (
    <group ref={group}>
      <Box size={[FLOOR.halfX * 2, 0.08, FLOOR.halfZ * 2]} at={[0, FLOOR.height + 0.04, 0]} m={mat(C.ceiling, { rough: 0.95 })} />
      {tiles.map(([x, z], i) => (
        <group key={i} position={[x, FLOOR.height - 0.02, z]}>
          <Box size={[1.9, 0.02, 1.9]} at={[0, 0, 0]} m={mat('#f7f4ee', { rough: 0.95 })} rot={[Math.PI / 2, 0, 0]} />
          {i % 3 === 0 && (
            <Plane size={[1.1, 0.32]} at={[0, -0.05, 0]} m={mat('#fffaf0', { rough: 0.4, emissive: '#fff5e2', glow: 1.5 })} rot={[Math.PI / 2, 0, 0]} />
          )}
        </group>
      ))}
    </group>
  )
}

/** Door-side signage plate plus a floating label, so each zone is identifiable from the camera. */
export function Signage() {
  return (
    <group>
      {ROOM_ORDER.map((id) => {
        const r = ROOMS[id]
        const inward = r.band === 'north' ? 1 : -1
        const [x, z] = r.door
        return (
          <group key={id}>
            {/* Printed plate beside the doorway: the label needs a surface or it floats in the air. */}
            <Box size={[Math.max(1.0, r.label.length * 0.098), 0.34, 0.02]} at={[x + 1.0, 2.02, z + inward * 0.13]} m={mat(C.white, { rough: 0.55 })} />
            <Text
              position={[x + 1.0, 2.02, z + inward * 0.15]}
              rotation={[0, inward > 0 ? 0 : Math.PI, 0]}
              fontSize={0.15}
              color="#4d5560"
              anchorX="center"
              anchorY="middle"
              letterSpacing={0.06}
              maxWidth={2.4}
            >
              {r.label.toUpperCase()}
            </Text>
            <Box size={[0.62, 0.025, 0.022]} at={[x + 1.0, 1.84, z + inward * 0.15]} m={mat(r.accent, { rough: 0.6 })} />
            <Billboard position={[r.center[0], 2.92, r.center[1]]}>
              <Text fontSize={0.165} color="#69727d" anchorX="center" anchorY="bottom" outlineWidth={0.012} outlineColor="#ffffff">
                {r.label}
              </Text>
            </Billboard>
          </group>
        )
      })}
    </group>
  )
}

/** Small status strip above each doorway: lit when somebody is actually working in that zone. */
export function DoorLight({ room, occupied }: { room: Room; occupied: boolean }) {
  const inward = room.band === 'north' ? 1 : -1
  return (
    <Box
      size={[0.3, 0.035, 0.06]}
      at={[room.door[0], DOOR_H + 0.16, room.door[1] + inward * 0.02]}
      m={mat(occupied ? STATUS_DOT.working : '#cfd4d8', { rough: 0.5, emissive: occupied ? STATUS_DOT.working : '#000000', glow: occupied ? 1.3 : 0 })}
    />
  )
}

/* ── Entrance and campus-facing shell ──────────────────────────────────────── */

const PORTAL = {
  width: ENTRANCE.width + 0.3,
  canopyW: 4.6,
  canopyD: 2.8,
  canopyY: 2.94,
}

/** Portal, canopy and held-open glass leaves on the real south entrance. Visible from the
 *  plaza and from inside the lobby, so the walk-through connects to actual geometry. The office
 *  diorama drops only the outside canopy, which would hang in front of the plate from above. */
export function EntrancePortal({ canopy = true }: { canopy?: boolean }) {
  const metal = mat('#7c868c', { rough: 0.38, metal: 0.5 })
  const frame = mat('#b7b4aa', { rough: 0.5, metal: 0.25 })
  const glass = mat('#cfe0e2', { rough: 0.08, metal: 0.1, opacity: 0.34 })
  const x = ENTRANCE.x
  const z = ENTRANCE.z
  return (
    <group position={[x, 0, z]}>
      {/* Threshold plate and jamb frames. */}
      <Box size={[PORTAL.width + 0.3, 0.035, 0.72]} at={[0, 0.018, 0.12]} m={mat('#cfc8ba', { rough: 0.85 })} receive />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box size={[0.16, 2.58, 0.3]} at={[s * (PORTAL.width / 2), 1.29, 0]} m={metal} cast />
          <Box size={[0.2, 0.08, 0.34]} at={[s * (PORTAL.width / 2), 2.56, 0]} m={frame} />
        </group>
      ))}
      <Box size={[PORTAL.width + 0.2, 0.24, 0.34]} at={[0, 2.52, 0]} m={metal} cast />
      {/* Held-open glass leaves, hinged on the jambs and swung out under the canopy. */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (PORTAL.width / 2 - 0.07), 0, 0]} rotation={[0, s * 1.1, 0]}>
          <Box size={[1.22, 2.4, 0.035]} at={[-s * 0.61, 1.23, 0]} m={glass} />
          <Box size={[0.05, 2.4, 0.07]} at={[-s * 0.03, 1.23, 0]} m={frame} />
          <Box size={[0.05, 2.4, 0.07]} at={[-s * 1.2, 1.23, 0]} m={frame} />
          <Box size={[0.05, 2.2, 0.06]} at={[-s * 0.02, 1.23, 0]} m={metal} />
          <Box size={[0.06, 0.34, 0.06]} at={[-s * 1.02, 1.08, 0.04]} m={metal} />
        </group>
      ))}
      {/* Canopy slab, fascia sign and two slender posts. */}
      {canopy && (
        <>
          <Box size={[PORTAL.canopyW, 0.16, PORTAL.canopyD]} at={[0, PORTAL.canopyY, 1.4]} m={mat('#d8d4c8', { rough: 0.62 })} cast />
          <Box size={[PORTAL.canopyW, 0.34, 0.12]} at={[0, PORTAL.canopyY - 0.1, 2.78]} m={mat('#e9e5da', { rough: 0.6 })} cast />
          <Text position={[0, PORTAL.canopyY - 0.1, 2.85]} fontSize={0.22} color="#35535a" anchorX="center" anchorY="middle" letterSpacing={0.2}>
            AGENTVILLE
          </Text>
          {[-1, 1].map((s) => (
            <group key={s}>
              <Box size={[0.1, PORTAL.canopyY, 0.1]} at={[s * 2.15, PORTAL.canopyY / 2, 1.8]} m={metal} cast />
              <Box size={[0.22, 0.04, 0.22]} at={[s * 2.15, 0.02, 1.8]} m={frame} />
              <Box size={[0.4, 0.02, 0.4]} at={[s * 1.5, PORTAL.canopyY - 0.1, 1.5]} m={mat('#fff3d8', { rough: 0.4, emissive: '#ffe4ad', glow: 1.5 })} />
            </group>
          ))}
          {/* A warm downlight under the canopy, so the soffit and the threshold do not go black. */}
          <pointLight position={[0, PORTAL.canopyY - 0.42, 1.35]} color="#ffe6bd" intensity={2.2} distance={7} decay={2} />
        </>
      )}
    </group>
  )
}

/** Roof, parapet, lantern, green roof and photovoltaic array. Campus View only: the interior
 *  below is culled then, and this is what the building shows from the plaza, the park and the
 *  bridge. Everything that must be *seen* from above is placed outside the lantern footprint. */
export function OfficeShell({ visible }: { visible: boolean }) {
  if (!visible) return null
  const roof = mat('#cfc9bb', { rough: 0.9 })
  const parapet = mat('#e6e1d4', { rough: 0.8 })
  const glass = mat('#7fa3a1', { rough: 0.16, metal: 0.25, opacity: 0.88 })
  const wall = mat('#e4dfd3', { rough: 0.82 })
  const green = mat('#87a679', { rough: 0.95 })
  const w = FLOOR.halfX * 2 + 1.2
  const d = FLOOR.halfZ * 2 + 1.2
  // 2 columns × 3 rows on the east half, clear of the lantern at x ±5.6.
  const panels = [8.6, 11.0].flatMap((px) => [-6, -3, 0].map((pz) => [px, pz] as [number, number]))
  return (
    <group>
      <Box size={[w, 0.18, d]} at={[0, FLOOR.height + 0.09, 0]} m={roof} cast receive />
      {[
        [0, -d / 2 + 0.12, w, 0.46], [0, d / 2 - 0.12, w, 0.46],
        [-w / 2 + 0.12, 0, 0.24, d], [w / 2 - 0.12, 0, 0.24, d],
      ].map(([px, pz, pw, pd], i) => (
        <Box key={i} size={[pw, 0.46, pd]} at={[px, FLOOR.height + 0.23, pz]} m={parapet} cast />
      ))}
      {/* Set-back glazed lantern: gives the one-storey pavilion a readable roof profile. */}
      <Box size={[11.2, 1.05, 5.6]} at={[0, FLOOR.height + 0.615, -0.6]} m={wall} cast />
      <Box size={[11.6, 0.6, 6.0]} at={[0, FLOOR.height + 1.44, -0.6]} m={glass} />
      <Box size={[12.0, 0.14, 6.4]} at={[0, FLOOR.height + 1.81, -0.6]} m={parapet} cast />
      {/* Green roof: a planted strip down the west edge and along the south parapet. */}
      <Box size={[3.2, 0.08, 10.0]} at={[-11.0, FLOOR.height + 0.22, 1.0]} m={green} />
      <Box size={[14.0, 0.08, 2.4]} at={[-1.0, FLOOR.height + 0.22, 7.0]} m={green} />
      {/* Photovoltaic array over the east half. */}
      {panels.map(([px, pz], i) => (
        <group key={i} position={[px, FLOOR.height + 0.36, pz]} rotation={[0.22, 0, 0]}>
          <Box size={[0.06, 0.26, 0.06]} at={[-0.9, -0.16, -0.55]} m={mat('#9aa5a8', { rough: 0.4, metal: 0.4 })} />
          <Box size={[0.06, 0.26, 0.06]} at={[0.9, -0.16, 0.55]} m={mat('#9aa5a8', { rough: 0.4, metal: 0.4 })} />
          <Box size={[2.2, 0.06, 1.3]} at={[0, 0, 0]} m={mat('#31464f', { rough: 0.3, metal: 0.5 })} />
          <Box size={[2.1, 0.012, 1.2]} at={[0, 0.04, 0]} m={mat('#5d7f95', { rough: 0.2, metal: 0.55 })} />
        </group>
      ))}
      {/* Plant room in the north-west corner. */}
      <Box size={[2.6, 1.1, 2.0]} at={[-10.4, FLOOR.height + 0.73, -6.6]} m={mat('#c8c4b9', { rough: 0.7 })} cast />
      <Box size={[0.5, 0.06, 0.5]} at={[-9.4, FLOOR.height + 1.3, -6.6]} m={mat('#9aa5a8', { rough: 0.4, metal: 0.4 })} />
    </group>
  )
}

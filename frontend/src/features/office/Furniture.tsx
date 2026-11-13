import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { C } from './palette'
import { Box, Cyl, Sph, mat } from './primitives'
import { surfaceTex } from './textures'

type P3 = [number, number, number]

/** Timber always carries a grain, upholstery a weave, so a desk and a sofa never read as painted
 * boxes. The colour moves into the pattern, which is why these materials are created white. */
const wood = (c: string) => mat('#ffffff', { rough: 0.62, map: surfaceTex('wood', c, [2, 1]) })
const metalM = (c = C.metal) => mat(c, { rough: 0.35, metal: 0.75 })
const soft = (c: string) => mat('#ffffff', { rough: 0.92, map: surfaceTex('fabric', c, [1, 1]) })
const plastic = (c = C.plastic) => mat(c, { rough: 0.55 })
const screen = (glow = 0.55, tint = C.screenUi) =>
  mat(tint, { rough: 0.25, emissive: tint, glow })

/** ── Workstations ───────────────────────────────────────────────────────────── */

export function Desk({ position, rotationY = 0, w = 1.5, d = 0.75, top = C.oak, modesty = true }: {
  position: P3; rotationY?: number; w?: number; d?: number; top?: string; modesty?: boolean
}) {
  const m = wood(top)
  const frame = metalM(C.metalDark)
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w, 0.04, d]} at={[0, 0.735, 0]} m={m} cast receive />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.05, 0.72, d - 0.08]} at={[s * (w / 2 - 0.05), 0.36, 0]} m={frame} cast />
      ))}
      <Box size={[w - 0.16, 0.02, 0.04]} at={[0, 0.18, -d / 2 + 0.07]} m={frame} />
      {modesty && <Box size={[w - 0.2, 0.4, 0.025]} at={[0, 0.5, -d / 2 + 0.06]} m={soft(C.wallShade)} />}
    </group>
  )
}

export function Monitor({ position, rotationY = 0, w = 0.56, h = 0.34, on = true, mount = 1.09 }: {
  position: P3; rotationY?: number; w?: number; h?: number; on?: boolean; mount?: number
}) {
  const bezel = plastic('#2d353d')
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.18, 0.012, 0.12]} at={[0, mount - h / 2 - 0.19, -0.02]} m={metalM()} cast />
      <Cyl at={[0, mount - h / 2 - 0.1, -0.02]} m={metalM()} rt={0.022} rb={0.028} h={0.19} seg={12} cast />
      <Box size={[w, h, 0.022]} at={[0, mount, 0]} m={bezel} cast />
      <Box size={[w - 0.03, h - 0.03, 0.006]} at={[0, mount, 0.015]} m={on ? screen(0.75) : mat(C.screenOff, { rough: 0.3 })} />
      {on && (
        <>
          <Box size={[w * 0.62, 0.012, 0.004]} at={[-w * 0.12, mount + h * 0.24, 0.019]} m={mat('#ffffff', { rough: 0.4, emissive: '#eaf6f7', glow: 0.9 })} />
          <Box size={[w * 0.44, 0.012, 0.004]} at={[-w * 0.2, mount + h * 0.1, 0.019]} m={mat('#ffffff', { rough: 0.4, emissive: '#cfe6e8', glow: 0.6 })} />
          <Box size={[w * 0.5, 0.012, 0.004]} at={[-w * 0.16, mount - h * 0.06, 0.019]} m={mat('#ffffff', { rough: 0.4, emissive: '#cfe6e8', glow: 0.5 })} />
        </>
      )}
    </group>
  )
}

export function Keyboard({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.43, 0.018, 0.14]} at={[0, 0, 0]} m={plastic('#3a434c')} cast />
      <Box size={[0.4, 0.004, 0.11]} at={[0, 0.011, -0.005]} m={plastic('#2a3138')} />
      <Sph at={[0.31, 0.018, 0.01]} m={plastic('#3a434c')} r={0.033} seg={10} />
    </group>
  )
}

export function DeskProps({ position, mug = C.accentWarm }: { position: P3; mug?: string }) {
  return (
    <group position={position}>
      <Cyl at={[0, 0.045, 0]} m={mat(mug, { rough: 0.5 })} rt={0.038} rb={0.034} h={0.09} seg={12} cast />
      <Box size={[0.2, 0.012, 0.27]} at={[0.26, 0.006, 0.04]} m={mat(C.paper, { rough: 0.9 })} rot={[0, 0.24, 0]} />
      <Box size={[0.17, 0.03, 0.23]} at={[0.25, 0.02, 0.05]} m={mat('#f0ece3', { rough: 0.9 })} rot={[0, -0.12, 0]} />
    </group>
  )
}

export function OfficeChair({ position, rotationY = 0, color = C.fabricDark }: { position: P3; rotationY?: number; color?: string }) {
  const cloth = soft(color)
  const stem = metalM(C.metalDark)
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.46, 0.07, 0.44]} at={[0, 0.45, 0]} m={cloth} cast />
      <Box size={[0.44, 0.46, 0.06]} at={[0, 0.72, -0.2]} m={cloth} rot={[-0.09, 0, 0]} cast />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.05, 0.04, 0.3]} at={[s * 0.25, 0.6, -0.03]} m={plastic('#4a525a')} />
      ))}
      <Cyl at={[0, 0.24, 0]} m={stem} rt={0.032} rb={0.032} h={0.4} seg={10} />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return <Box key={i} size={[0.24, 0.03, 0.05]} at={[Math.sin(a) * 0.13, 0.05, Math.cos(a) * 0.13]} m={stem} rot={[0, -a, 0]} />
      })}
    </group>
  )
}

/** One seat at a workstation: desk, screen(s), chair and the small things that make it lived in. */
export function Workstation({ position, rotationY = 0, dual = false, accent = C.oak, variant = 0 }: {
  position: P3; rotationY?: number; dual?: boolean; accent?: string; variant?: number
}) {
  const back = variant % 2 === 0 ? -0.2 : -0.24
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Desk position={[0, 0, 0]} top={accent} />
      {dual ? (
        <>
          <Monitor position={[-0.24, 0, back]} w={0.46} h={0.3} mount={1.06} />
          <Monitor position={[0.26, 0, back + 0.02]} w={0.46} h={0.3} mount={1.06} rotationY={-0.24} />
        </>
      ) : (
        <Monitor position={[0, 0, back]} mount={1.08} />
      )}
      <Keyboard position={[0, 0.755, 0.2]} />
      <DeskProps position={[-0.52, 0.755, 0.14]} mug={accent === C.oak ? C.accentWarm : accent} />
      {/* Seated occupant of OfficeChair faces local +z; the workstation user faces the screen at
       * local -z, so the chair is turned around or the backrest lands in their lap. */}
      <OfficeChair position={[0, 0, 0.78]} rotationY={Math.PI + 0.22} />
    </group>
  )
}

/** ── Storage and partitions ─────────────────────────────────────────────────── */

export function Credenza({ position, rotationY = 0, w = 1.4, color = C.white }: { position: P3; rotationY?: number; w?: number; color?: string }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w, 0.66, 0.42]} at={[0, 0.33, 0]} m={mat(color, { rough: 0.7 })} cast receive />
      {[0.34, 0.68].map((x, i) => (
        <Box key={i} size={[0.02, 0.5, 0.01]} at={[x - w / 2 + 0.02, 0.34, 0.215]} m={metalM(C.metalDark)} />
      ))}
      <Box size={[w - 0.04, 0.03, 0.44]} at={[0, 0.675, 0]} m={wood(C.oakPale)} />
    </group>
  )
}

export function Shelf({ position, rotationY = 0, w = 1.2, h = 1.8, levels = 4, back = true }: {
  position: P3; rotationY?: number; w?: number; h?: number; levels?: number; back?: boolean
}) {
  const carcass = wood(C.oakPale)
  const books = [mat('#b9685f', { rough: 0.9 }), mat('#6f8fa8', { rough: 0.9 }), mat('#c2a86a', { rough: 0.9 }), mat('#7f9a7c', { rough: 0.9 })]
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[-1, 1].map((s) => <Box key={s} size={[0.035, h, 0.32]} at={[s * (w / 2), h / 2, 0]} m={carcass} cast />)}
      {back && <Box size={[w, h, 0.02]} at={[0, h / 2, -0.16]} m={mat(C.wallShade, { rough: 0.85 })} />}
      {Array.from({ length: levels + 1 }, (_, i) => {
        const y = (i / levels) * (h - 0.04) + 0.02
        return (
          <group key={i}>
            <Box size={[w - 0.04, 0.03, 0.3]} at={[0, y, 0]} m={carcass} />
            {i < levels && Array.from({ length: 6 }, (_, k) => {
              const bw = 0.05 + ((k * 7 + i * 3) % 4) * 0.014
              const bh = 0.17 + ((k * 5 + i) % 4) * 0.03
              const x = -w / 2 + 0.09 + k * 0.15 + ((i + k) % 3) * 0.012
              return <Box key={k} size={[bw, bh, 0.2]} at={[x, y + bh / 2 + 0.015, 0.02]} m={books[(k + i) % books.length]} />
            })}
          </group>
        )
      })}
    </group>
  )
}

export function FilingCabinet({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  const body = metalM('#b0b6bb')
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.52, 1.32, 0.62]} at={[0, 0.66, 0]} m={body} cast receive />
      {[0.24, 0.56, 0.88, 1.14].map((y, i) => (
        <group key={i}>
          <Box size={[0.46, 0.26, 0.02]} at={[0, y, 0.315]} m={metalM('#a3a9ae')} />
          <Box size={[0.16, 0.02, 0.03]} at={[0, y + 0.06, 0.33]} m={metalM(C.metalDark)} />
        </group>
      ))}
    </group>
  )
}

export function Printer({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.62, 0.42, 0.5]} at={[0, 0.21, 0]} m={mat(C.white, { rough: 0.6 })} cast />
      <Box size={[0.56, 0.05, 0.44]} at={[0, 0.44, 0.01]} m={plastic('#d8d4cd')} />
      <Box size={[0.5, 0.02, 0.34]} at={[0, 0.47, -0.03]} m={mat(C.paper, { rough: 0.9 })} rot={[0.05, 0, 0]} />
      <Box size={[0.16, 0.02, 0.09]} at={[0.2, 0.455, 0.18]} m={mat('#2f3a42', { rough: 0.4 })} />
    </group>
  )
}

export function AcousticPanel({ position, rotationY = 0, w = 1.2, h = 1.1, color }: {
  position: P3; rotationY?: number; w?: number; h?: number; color?: string
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w, h, 0.04]} at={[0, 0, 0]} m={soft(color ?? C.fabric)} />
      {[-1, 1].map((s) => <Box key={s} size={[0.03, h + 0.05, 0.055]} at={[s * (w / 2 + 0.015), 0, 0.01]} m={metalM()} />)}
    </group>
  )
}

/** ── Greenery, lighting and small decor ─────────────────────────────────────── */

export function Plant({ position, scale = 1, kind = 0 }: { position: P3; scale?: number; kind?: number }) {
  const pot = mat(kind % 2 ? '#cbbfae' : C.pot, { rough: 0.85 })
  const leafA = mat(C.leafDark, { rough: 0.85 })
  const leafB = mat(C.leafLight, { rough: 0.85 })
  // Two silhouettes only: flat upright leaves (sansevieria) or a low bush. Capsule "blades" read
  // as green sticks from the isometric camera, which is what the old props looked like.
  const bush: [number, number, number, number][] = [
    [0, 0.55, 0, 0.2], [0.14, 0.66, 0.05, 0.16], [-0.13, 0.63, -0.06, 0.15],
    [0.03, 0.78, -0.09, 0.13], [-0.05, 0.5, 0.14, 0.14],
  ]
  return (
    <group position={position} scale={scale}>
      <Cyl at={[0, 0.17, 0]} m={pot} rt={0.19} rb={0.14} h={0.34} seg={18} cast />
      <Cyl at={[0, 0.34, 0]} m={mat(C.soil, { rough: 1 })} rt={0.175} rb={0.175} h={0.02} seg={18} />
      {kind % 2 === 0
        ? Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2 + kind
            const lean = 0.1 + (i % 3) * 0.09
            const len = 0.5 + (i % 4) * 0.16
            return (
              <group key={i} rotation={[0, a, 0]}>
                <Box
                  size={[0.08, len, 0.022]}
                  at={[Math.sin(lean) * len * 0.5, 0.34 + Math.cos(lean) * len * 0.5, 0]}
                  m={i % 2 ? leafA : leafB}
                  rot={[0, 0, -lean]}
                  cast
                />
              </group>
            )
          })
        : bush.map(([x, y, z, r], i) => <Sph key={i} at={[x, y, z]} m={i % 2 ? leafA : leafB} r={r} seg={12} cast />)}
    </group>
  )
}

export function TreePlant({ position }: { position: P3 }) {
  const trunk = wood(C.oakDark)
  return (
    <group position={position}>
      <Cyl at={[0, 0.16, 0]} m={mat('#b9ac9a', { rough: 0.9 })} rt={0.24} rb={0.2} h={0.32} seg={18} cast />
      <Cyl at={[0, 0.72, 0]} m={trunk} rt={0.045} rb={0.06} h={0.9} seg={10} cast />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2
        return <Sph key={i} at={[Math.sin(a) * 0.24, 1.28 + (i % 2) * 0.2, Math.cos(a) * 0.24]} m={i % 2 ? mat(C.leafDark, { rough: 0.85 }) : mat(C.leafLight, { rough: 0.85 })} r={0.3 - (i % 2) * 0.05} seg={14} cast />
      })}
      <Sph at={[0, 1.62, 0]} m={mat(C.leafLight, { rough: 0.85 })} r={0.26} seg={14} cast />
    </group>
  )
}

export function FloorLamp({ position }: { position: P3 }) {
  return (
    <group position={position}>
      <Cyl at={[0, 0.02, 0]} m={metalM(C.metalDark)} rt={0.16} rb={0.18} h={0.04} seg={18} />
      <Cyl at={[0, 0.75, 0]} m={metalM()} rt={0.018} rb={0.018} h={1.46} seg={10} cast />
      <Cyl at={[0, 1.56, 0]} m={mat('#f6efe1', { rough: 0.9, emissive: '#ffe6bd', glow: 0.55 })} rt={0.14} rb={0.21} h={0.26} seg={18} cast />
    </group>
  )
}

export function TableLamp({ position, shade = '#f2e6d3' }: { position: P3; shade?: string }) {
  return (
    <group position={position}>
      <Cyl at={[0, 0.02, 0]} m={metalM(C.metalDark)} rt={0.06} rb={0.07} h={0.04} seg={12} />
      <Cyl at={[0, 0.13, 0]} m={metalM()} rt={0.012} rb={0.012} h={0.2} seg={8} />
      <Cyl at={[0, 0.28, 0]} m={mat(shade, { rough: 0.85, emissive: '#ffe2b6', glow: 0.5 })} rt={0.08} rb={0.12} h={0.14} seg={16} cast />
    </group>
  )
}

const handDark = mat('#3a444d', { rough: 0.6 })

export function WallClock({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  const hour = useRef<Group>(null)
  const minute = useRef<Group>(null)
  // Hands follow the real wall clock, so a lobby clock reads the actual time instead of a fixed
  // 10:09. This is decoration, not agent motion, so it runs regardless of backend status.
  useFrame(() => {
    const now = new Date()
    const min = now.getMinutes() + now.getSeconds() / 60
    const hr = (now.getHours() % 12) + now.getMinutes() / 60
    if (minute.current) minute.current.rotation.z = -(min / 60) * Math.PI * 2
    if (hour.current) hour.current.rotation.z = -(hr / 12) * Math.PI * 2
  })
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Cyl at={[0, 0, 0.02]} m={mat(C.white, { rough: 0.6 })} rt={0.16} rb={0.16} h={0.04} seg={24} rot={[Math.PI / 2, 0, 0]} />
      <group ref={hour} position={[0, 0, 0.05]}>
        <Box size={[0.016, 0.06, 0.006]} at={[0, 0.03, 0]} m={handDark} />
      </group>
      <group ref={minute} position={[0, 0, 0.054]}>
        <Box size={[0.012, 0.092, 0.006]} at={[0, 0.046, 0]} m={handDark} />
      </group>
      <Cyl at={[0, 0, 0.058]} m={handDark} rt={0.012} rb={0.012} h={0.01} seg={10} rot={[Math.PI / 2, 0, 0]} />
    </group>
  )
}

export function Poster({ position, rotationY = 0, w = 0.7, h = 0.95, art = 0, accent = C.accentWarm }: {
  position: P3; rotationY?: number; w?: number; h?: number; art?: number; accent?: string
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w + 0.05, h + 0.05, 0.025]} at={[0, 0, 0]} m={wood(C.oakDark)} />
      <Box size={[w, h, 0.01]} at={[0, 0, 0.018]} m={mat(C.paper, { rough: 0.9 })} />
      {art % 3 === 0 && (
        <>
          <Box size={[w * 0.7, h * 0.3, 0.006]} at={[0, h * 0.22, 0.024]} m={soft(accent)} />
          <Box size={[w * 0.44, h * 0.1, 0.006]} at={[-w * 0.12, -h * 0.08, 0.024]} m={mat(C.leafLight, { rough: 0.9 })} />
          <Box size={[w * 0.6, 0.02, 0.006]} at={[0, -h * 0.28, 0.024]} m={mat('#9aa3ab')} />
        </>
      )}
      {art % 3 === 1 && (
        <>
          <Sph at={[0, h * 0.12, 0.024]} m={soft(accent)} r={w * 0.26} seg={20} />
          <Box size={[w * 0.66, 0.024, 0.006]} at={[0, -h * 0.26, 0.024]} m={mat('#9aa3ab')} />
        </>
      )}
      {art % 3 === 2 && (
        <>
          <Box size={[w * 0.3, h * 0.62, 0.006]} at={[-w * 0.18, 0, 0.024]} m={soft(accent)} />
          <Box size={[w * 0.24, h * 0.4, 0.006]} at={[w * 0.16, -h * 0.1, 0.024]} m={mat('#9fb6a6', { rough: 0.9 })} />
        </>
      )}
    </group>
  )
}

export function AreaRug({ position, size, color, rotationY = 0 }: {
  position: P3; size: [number, number]; color: string; rotationY?: number
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[size[0], 0.016, size[1]]} at={[0, 0.008, 0]} m={soft(color)} receive />
      <Box size={[size[0] - 0.16, 0.004, size[1] - 0.16]} at={[0, 0.018, 0]} m={soft(color === C.fabric ? '#d9dfe3' : '#efe9df')} />
    </group>
  )
}

export function TrashBin({ position }: { position: P3 }) {
  return (
    <Cyl at={position} m={metalM('#a9afb4')} rt={0.13} rb={0.11} h={0.34} seg={14} cast />
  )
}

export function WallSocket({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  return (
    <Box size={[0.14, 0.09, 0.02]} at={position} m={mat('#efe9dd', { rough: 0.6 })} rot={[0, rotationY, 0]} />
  )
}

/** ── Server, security and meeting hardware ──────────────────────────────────── */

export function ServerRack({ position, rotationY = 0, active = false, seed = 0 }: { position: P3; rotationY?: number; active?: boolean; seed?: number }) {
  const body = mat('#9aa3aa', { rough: 0.42, metal: 0.55 })
  const ledA = active ? '#5fd0a0' : '#9fadb5'
  const ledB = active ? '#e0b070' : '#b6c0c7'
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.62, 1.9, 0.56]} at={[0, 0.95, 0]} m={body} cast receive />
      <Box size={[0.58, 0.03, 0.52]} at={[0, 1.915, 0]} m={mat('#c8ced2', { rough: 0.45, metal: 0.5 })} />
      <Box size={[0.56, 0.06, 0.02]} at={[0, 1.86, 0.285]} m={metalM('#8d959c')} />
      {Array.from({ length: 9 }, (_, i) => {
        const y = 0.28 + i * 0.18
        const lit = active && (i + seed) % 3 !== 0
        return (
          <group key={i}>
            <Box size={[0.54, 0.13, 0.02]} at={[0, y, 0.283]} m={mat('#4a545d', { rough: 0.5, metal: 0.4 })} />
            <Box size={[0.4, 0.02, 0.006]} at={[-0.05, y + 0.03, 0.294]} m={mat('#39424a')} />
            <Sph at={[0.2, y + 0.02, 0.295]} m={mat(lit ? ledA : '#8f9aa2', { rough: 0.4, emissive: lit ? ledA : '#000000', glow: lit ? 1.4 : 0 })} r={0.014} seg={8} />
            <Sph at={[0.16, y + 0.02, 0.295]} m={mat(lit ? ledB : '#8f9aa2', { rough: 0.4, emissive: lit ? ledB : '#000000', glow: lit ? 1.2 : 0 })} r={0.012} seg={8} />
          </group>
        )
      })}
    </group>
  )
}

export function CoolingUnit({ position }: { position: P3 }) {
  const body = mat('#dfe4e6', { rough: 0.6, metal: 0.2 })
  return (
    <group position={position}>
      <Box size={[0.5, 1.95, 0.44]} at={[0, 0.98, 0]} m={body} cast receive />
      {[0.4, 0.9, 1.4].map((y, i) => (
        <Box key={i} size={[0.4, 0.24, 0.02]} at={[0, y, 0.225]} m={mat('#b9c1c5', { rough: 0.7 })} />
      ))}
      <Cyl at={[0, 1.78, 0.23]} m={metalM('#98a1a7')} rt={0.09} rb={0.09} h={0.03} seg={16} rot={[Math.PI / 2, 0, 0]} />
      <Sph at={[0.16, 0.24, 0.24]} m={mat('#66c6a8', { rough: 0.4, emissive: '#66c6a8', glow: 1.2 })} r={0.022} seg={8} />
    </group>
  )
}

export function CableTray({ position, size }: { position: P3; size: [number, number, number] }) {
  return (
    <group position={position}>
      <Box size={[size[0], 0.05, size[2]]} at={[0, 0, 0]} m={metalM('#9aa2a8')} />
      <Box size={[size[0] * 0.8, 0.03, 0.06]} at={[0, 0.04, 0.05]} m={mat('#4b5259', { rough: 0.8 })} />
    </group>
  )
}

export function Whiteboard({ position, rotationY = 0, w = 2.2 }: { position: P3; rotationY?: number; w?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w + 0.08, 1.24, 0.05]} at={[0, 0, 0]} m={metalM()} cast />
      <Box size={[w, 1.16, 0.02]} at={[0, 0, 0.032]} m={mat('#fbfcfb', { rough: 0.22 })} />
      <Box size={[w * 0.42, 0.018, 0.006]} at={[-w * 0.2, 0.34, 0.044]} m={mat('#7f9bb5')} />
      <Box size={[w * 0.26, 0.018, 0.006]} at={[-w * 0.28, 0.18, 0.044]} m={mat('#c08a8a')} />
      <Box size={[w * 0.5, 0.018, 0.006]} at={[w * 0.12, 0.02, 0.044]} m={mat('#84a98d')} />
      <Box size={[0.3, 0.05, 0.06]} at={[w * 0.3, -0.62, 0.06]} m={metalM(C.metalDark)} />
    </group>
  )
}

export function WallDisplay({ position, rotationY = 0, w = 1.9, h = 1.06, label, tint = '#8fbfc4' }: {
  position: P3; rotationY?: number; w?: number; h?: number; label?: string; tint?: string
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w, h, 0.05]} at={[0, 0, 0]} m={mat('#2b333a', { rough: 0.5, metal: 0.3 })} cast />
      <Box size={[w - 0.05, h - 0.05, 0.012]} at={[0, 0, 0.03]} m={mat(tint, { rough: 0.25, emissive: tint, glow: 0.5 })} />
      {label && (
        <Box size={[w * 0.5, 0.05, 0.008]} at={[-w * 0.14, h * 0.3, 0.04]} m={mat('#ffffff', { emissive: '#f2fbfb', glow: 0.8 })} />
      )}
      <Box size={[w * 0.34, 0.04, 0.008]} at={[-w * 0.22, h * 0.14, 0.04]} m={mat('#ffffff', { emissive: '#e4f2f3', glow: 0.55 })} />
      <Box size={[w * 0.42, 0.04, 0.008]} at={[-w * 0.17, -h * 0.02, 0.04]} m={mat('#ffffff', { emissive: '#e4f2f3', glow: 0.45 })} />
    </group>
  )
}

export function CctvWall({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[1.86, 1.16, 0.06]} at={[0, 0, 0]} m={mat(C.wallShade, { rough: 0.8 })} />
      {[[-0.45, 0.27], [0.45, 0.27], [-0.45, -0.29], [0.45, -0.29]].map(([x, y], i) => (
        <group key={i}>
          <Box size={[0.82, 0.5, 0.03]} at={[x, y, 0.04]} m={mat('#2b333a', { rough: 0.5 })} />
          <Box size={[0.76, 0.44, 0.01]} at={[x, y, 0.058]} m={mat(i % 2 ? '#6d8a93' : '#7d97a0', { rough: 0.3, emissive: '#5c7d86', glow: 0.5 })} />
          <Box size={[0.2, 0.03, 0.006]} at={[x - 0.2, y + 0.12, 0.065]} m={mat('#cfe0e2', { emissive: '#cfe0e2', glow: 0.6 })} />
        </group>
      ))}
    </group>
  )
}

export function QueueBoard({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[1.24, 0.74, 0.05]} at={[0, 0, 0]} m={mat('#2b333a', { rough: 0.5 })} cast />
      <Box size={[1.16, 0.66, 0.012]} at={[0, 0, 0.03]} m={mat('#89b6b0', { rough: 0.3, emissive: '#6fa39c', glow: 0.55 })} />
      {[0.16, -0.06, -0.26].map((y, i) => (
        <Box key={i} size={[0.7 - i * 0.12, 0.05, 0.008]} at={[-0.1 + i * 0.06, y, 0.04]} m={mat('#ffffff', { emissive: '#f0f7f6', glow: 0.7 })} />
      ))}
    </group>
  )
}

/** ── Lobby, pantry and meeting furniture ────────────────────────────────────── */

export function ReceptionDesk({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  const body = mat(C.wall, { rough: 0.7 })
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[2.6, 1.06, 0.7]} at={[0, 0.53, 0]} m={body} cast receive />
      <Box size={[2.6, 0.66, 0.06]} at={[0, 0.33, 0.36]} m={wood(C.oak)} />
      <Box size={[2.76, 0.06, 0.86]} at={[0, 1.09, 0]} m={wood(C.oakPale)} cast />
      <Box size={[2.5, 0.04, 0.5]} at={[0, 0.74, -0.06]} m={mat(C.wallShade, { rough: 0.8 })} />
      <Monitor position={[-0.55, 0, -0.12]} w={0.44} h={0.28} mount={1.32} rotationY={Math.PI} />
      <Keyboard position={[0.5, 1.12, 0.1]} />
      <DeskProps position={[0.95, 1.12, -0.1]} mug="#c9a06a" />
      <Plant position={[1.5, 1.12, -0.18]} scale={0.42} kind={1} />
    </group>
  )
}

export function Sofa({ position, rotationY = 0, seats = 2, color = C.fabric }: { position: P3; rotationY?: number; seats?: number; color?: string }) {
  const cloth = soft(color)
  const w = 0.82 * seats + 0.24
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w, 0.34, 0.86]} at={[0, 0.24, 0]} m={cloth} cast receive />
      <Box size={[w, 0.46, 0.18]} at={[0, 0.6, -0.36]} m={cloth} cast />
      {[-1, 1].map((s) => <Box key={s} size={[0.18, 0.5, 0.86]} at={[s * (w / 2 - 0.09), 0.42, 0]} m={cloth} cast />)}
      {Array.from({ length: seats }, (_, i) => {
        const x = (i - (seats - 1) / 2) * (w / seats)
        return (
          <group key={i}>
            <Box size={[w / seats - 0.24, 0.13, 0.62]} at={[x, 0.47, 0.04]} m={soft('#dde2e6')} cast />
            <Box size={[w / seats - 0.3, 0.3, 0.12]} at={[x, 0.68, -0.28]} m={soft('#dde2e6')} rot={[-0.16, 0, 0]} />
          </group>
        )
      })}
      {[-1, 1].map((s) => <Box key={`l${s}`} size={[0.06, 0.1, 0.06]} at={[s * (w / 2 - 0.12), 0.05, 0.34]} m={metalM(C.metalDark)} />)}
    </group>
  )
}

export function Armchair({ position, rotationY = 0, color = '#d8cfc0' }: { position: P3; rotationY?: number; color?: string }) {
  const cloth = soft(color)
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.78, 0.34, 0.78]} at={[0, 0.24, 0]} m={cloth} cast receive />
      <Box size={[0.78, 0.5, 0.16]} at={[0, 0.62, -0.32]} m={cloth} rot={[-0.12, 0, 0]} cast />
      {[-1, 1].map((s) => <Box key={s} size={[0.14, 0.46, 0.78]} at={[s * 0.32, 0.4, 0]} m={cloth} cast />)}
      <Box size={[0.5, 0.12, 0.56]} at={[0, 0.46, 0.04]} m={soft('#e6ded1')} cast />
      {[0, 1, 2, 3].map((i) => {
        const x = i < 2 ? -0.28 : 0.28
        const z = i % 2 ? -0.28 : 0.28
        return <Cyl key={i} at={[x, 0.04, z]} m={wood(C.oakDark)} rt={0.03} rb={0.022} h={0.08} seg={8} />
      })}
    </group>
  )
}

export function CoffeeTable({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[1.1, 0.05, 0.6]} at={[0, 0.4, 0]} m={wood(C.oakPale)} cast receive />
      <Box size={[0.9, 0.34, 0.04]} at={[0, 0.19, -0.24]} m={metalM(C.metalDark)} />
      <Box size={[0.9, 0.34, 0.04]} at={[0, 0.19, 0.24]} m={metalM(C.metalDark)} />
      <Box size={[0.3, 0.03, 0.22]} at={[-0.2, 0.44, 0.02]} m={mat('#8fa6a8', { rough: 0.4 })} rot={[0, 0.3, 0]} />
      <Cyl at={[0.26, 0.47, -0.04]} m={mat(C.paper, { rough: 0.9 })} rt={0.05} rb={0.045} h={0.09} seg={12} cast />
    </group>
  )
}

export function BistroTable({ position }: { position: P3 }) {
  return (
    <group position={position}>
      <Cyl at={[0, 0.02, 0]} m={metalM(C.metalDark)} rt={0.22} rb={0.24} h={0.04} seg={18} />
      <Cyl at={[0, 0.37, 0]} m={metalM()} rt={0.03} rb={0.03} h={0.7} seg={10} cast />
      <Cyl at={[0, 0.73, 0]} m={wood(C.oakPale)} rt={0.42} rb={0.42} h={0.045} seg={24} cast receive />
      <Cyl at={[0.1, 0.81, 0.06]} m={mat('#e8eef0', { rough: 0.3 })} rt={0.05} rb={0.045} h={0.1} seg={12} cast />
      <Cyl at={[-0.14, 0.79, -0.08]} m={mat(C.paper, { rough: 0.9 })} rt={0.07} rb={0.07} h={0.03} seg={14} />
    </group>
  )
}

export function Stool({ position, color = '#c9cfd4' }: { position: P3; color?: string }) {
  return (
    <group position={position}>
      <Cyl at={[0, 0.62, 0]} m={soft(color)} rt={0.19} rb={0.18} h={0.07} seg={18} cast />
      <Cyl at={[0, 0.3, 0]} m={metalM(C.metalDark)} rt={0.022} rb={0.022} h={0.6} seg={8} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2
        return <Box key={i} size={[0.19, 0.025, 0.035]} at={[Math.sin(a) * 0.1, 0.03, Math.cos(a) * 0.1]} m={metalM(C.metalDark)} rot={[0, -a, 0]} />
      })}
      <Cyl at={[0, 0.24, 0]} m={metalM()} rt={0.14} rb={0.14} h={0.02} seg={16} rot={[Math.PI / 2, 0, 0]} />
    </group>
  )
}

export function ConferenceTable({ position, rotationY = 0, length = 2.6, seats = 3 }: {
  position: P3; rotationY?: number; length?: number; seats?: number
}) {
  const top = wood(C.oakPale)
  const w = length, d = 1.24
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w, 0.05, d]} at={[0, 0.74, 0]} m={top} cast receive />
      <Box size={[w - 0.5, 0.04, 0.3]} at={[0, 0.72, 0]} m={mat('#b7a68f', { rough: 0.8 })} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.09, 0.72, d - 0.3]} at={[s * (w / 2 - 0.28), 0.36, 0]} m={metalM(C.metalDark)} cast />
      ))}
      <Box size={[w - 0.7, 0.06, 0.06]} at={[0, 0.12, 0]} m={metalM(C.metalDark)} />
      <Cyl at={[0, 0.79, 0]} m={mat('#4a545c', { rough: 0.5 })} rt={0.14} rb={0.16} h={0.05} seg={18} />
      <Cyl at={[-0.6, 0.79, 0.3]} m={mat('#e8eef0', { rough: 0.25 })} rt={0.045} rb={0.04} h={0.11} seg={12} cast />
      <Cyl at={[0.62, 0.79, -0.28]} m={mat('#e8eef0', { rough: 0.25 })} rt={0.045} rb={0.04} h={0.11} seg={12} cast />
      <Box size={[0.26, 0.01, 0.18]} at={[0.3, 0.768, 0.34]} m={mat(C.paper, { rough: 0.9 })} rot={[0, 0.2, 0]} />
      {Array.from({ length: seats }, (_, i) => i).map((i) => {
        const x = (i - (seats - 1) / 2) * (w / (seats + 0.2))
        return <Box key={i} size={[0.2, 0.006, 0.12]} at={[x, 0.77, -0.42]} m={mat('#cfd6d8', { rough: 0.6 })} />
      })}
    </group>
  )
}

/** ── Pantry ─────────────────────────────────────────────────────────────────── */

export function CounterRun({ position, rotationY = 0, length = 3.2, sink = true }: {
  position: P3; rotationY?: number; length?: number; sink?: boolean
}) {
  const carcass = mat('#eee9e0', { rough: 0.7 })
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[length, 0.86, 0.62]} at={[0, 0.43, 0]} m={carcass} cast receive />
      {Array.from({ length: Math.round(length / 0.62) }, (_, i) => {
        const x = -length / 2 + 0.31 + i * 0.62
        return (
          <group key={i}>
            <Box size={[0.56, 0.78, 0.02]} at={[x, 0.43, 0.315]} m={mat('#e4ded3', { rough: 0.7 })} />
            <Box size={[0.16, 0.018, 0.03]} at={[x, 0.76, 0.33]} m={metalM(C.metalDark)} />
          </group>
        )
      })}
      <Box size={[length + 0.04, 0.05, 0.66]} at={[0, 0.885, 0]} m={mat('#cfd3d4', { rough: 0.35, metal: 0.2 })} cast />
      <Box size={[length, 0.5, 0.02]} at={[0, 1.16, -0.31]} m={mat('#e9e4da', { rough: 0.8 })} />
      {sink && (
        <group position={[length * 0.28, 0.9, 0.02]}>
          <Box size={[0.62, 0.06, 0.44]} at={[0, 0, 0]} m={metalM('#b7bec2')} />
          <Box size={[0.52, 0.16, 0.34]} at={[0, -0.06, 0]} m={mat('#a9b1b6', { rough: 0.3, metal: 0.6 })} />
          <Cyl at={[0, 0.14, -0.14]} m={metalM()} rt={0.018} rb={0.018} h={0.24} seg={10} cast />
          <Box size={[0.02, 0.02, 0.16]} at={[0, 0.25, -0.06]} m={metalM()} />
        </group>
      )}
      <CoffeeMachine position={[-length * 0.3, 0.91, 0]} />
      <Box size={[0.34, 0.06, 0.26]} at={[length * 0.02, 0.94, 0.06]} m={mat('#dfe3e4', { rough: 0.5 })} />
    </group>
  )
}

export function CoffeeMachine({ position }: { position: P3 }) {
  return (
    <group position={position}>
      <Box size={[0.34, 0.4, 0.32]} at={[0, 0.2, 0]} m={mat('#40474d', { rough: 0.4, metal: 0.3 })} cast />
      <Box size={[0.26, 0.06, 0.06]} at={[0, 0.36, 0.16]} m={metalM('#9aa2a8')} />
      <Box size={[0.16, 0.1, 0.14]} at={[0, 0.1, 0.12]} m={mat('#2b3136', { rough: 0.5 })} />
      <Cyl at={[0, 0.06, 0.12]} m={mat('#f0f2f1', { rough: 0.3 })} rt={0.05} rb={0.045} h={0.07} seg={12} />
      <Sph at={[0.12, 0.3, 0.17]} m={mat('#7fd6b6', { rough: 0.4, emissive: '#7fd6b6', glow: 1.1 })} r={0.016} seg={8} />
    </group>
  )
}

export function Fridge({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.72, 1.82, 0.68]} at={[0, 0.91, 0]} m={mat('#dfe4e6', { rough: 0.3, metal: 0.55 })} cast receive />
      <Box size={[0.7, 0.02, 0.02]} at={[0, 1.22, 0.345]} m={mat('#b6bdc1', { rough: 0.4 })} />
      <Box size={[0.03, 0.5, 0.03]} at={[0.3, 1.52, 0.35]} m={metalM(C.metalDark)} />
      <Box size={[0.03, 0.4, 0.03]} at={[0.3, 0.86, 0.35]} m={metalM(C.metalDark)} />
      <Box size={[0.2, 0.12, 0.01]} at={[-0.16, 1.62, 0.345]} m={mat('#39424a', { rough: 0.5 })} />
    </group>
  )
}

export function Dispenser({ position }: { position: P3 }) {
  return (
    <group position={position}>
      <Box size={[0.36, 0.94, 0.36]} at={[0, 0.47, 0]} m={mat('#e9ecee', { rough: 0.6 })} cast />
      <Cyl at={[0, 1.16, 0]} m={mat('#a8d6e2', { rough: 0.15, opacity: 0.75 })} rt={0.15} rb={0.13} h={0.4} seg={16} cast />
      <Box size={[0.2, 0.12, 0.04]} at={[0, 0.62, 0.19]} m={mat('#9aa3a9', { rough: 0.4 })} />
      <Cyl at={[0, 0.5, 0.1]} m={mat('#f2f5f6', { rough: 0.25 })} rt={0.045} rb={0.04} h={0.1} seg={12} />
    </group>
  )
}

export function Microwave({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.52, 0.3, 0.36]} at={[0, 0, 0]} m={mat('#4b5257', { rough: 0.4, metal: 0.3 })} cast />
      <Box size={[0.34, 0.22, 0.02]} at={[-0.07, 0, 0.19]} m={mat('#22292f', { rough: 0.2, opacity: 0.85 })} />
      <Box size={[0.1, 0.2, 0.02]} at={[0.19, 0, 0.19]} m={mat('#39424a', { rough: 0.5 })} />
    </group>
  )
}

export function UpperCabinets({ position, rotationY = 0, length = 2.6 }: { position: P3; rotationY?: number; length?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[length, 0.66, 0.36]} at={[0, 0, 0]} m={mat('#efeae1', { rough: 0.7 })} cast />
      {Array.from({ length: Math.round(length / 0.65) }, (_, i) => {
        const x = -length / 2 + 0.325 + i * 0.65
        return (
          <group key={i}>
            <Box size={[0.6, 0.6, 0.02]} at={[x, 0, 0.185]} m={mat('#e5dfd4', { rough: 0.7 })} />
            <Box size={[0.14, 0.016, 0.03]} at={[x, -0.22, 0.2]} m={metalM(C.metalDark)} />
          </group>
        )
      })}
    </group>
  )
}

/** ── Small fittings ─────────────────────────────────────────────────────────── */

export function Headset({ position, color = '#3d454d' }: { position: P3; color?: string }) {
  const band = mat(color, { rough: 0.5 })
  return (
    <group position={position} rotation={[0, 0.4, 0]}>
      <Cyl at={[0, 0, 0]} m={band} rt={0.085} rb={0.085} h={0.012} seg={18} rot={[0, 0, Math.PI / 2.4]} />
      <Box size={[0.035, 0.06, 0.05]} at={[-0.06, -0.03, 0.03]} m={band} />
      <Box size={[0.035, 0.06, 0.05]} at={[0.06, -0.03, -0.03]} m={band} />
      <Box size={[0.05, 0.012, 0.012]} at={[0.02, -0.05, 0.05]} m={metalM(C.metalDark)} />
    </group>
  )
}

export function StickyBoard({ position, rotationY = 0, w = 1.8, h = 1.15, accent = C.accentWarm }: {
  position: P3; rotationY?: number; w?: number; h?: number; accent?: string
}) {
  const notes = ['#f4d97a', '#a9d6b8', '#f0a99a', '#9fc3e0', '#e2c6ef']
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w + 0.06, h + 0.06, 0.04]} at={[0, 0, 0]} m={wood(C.oakDark)} />
      <Box size={[w, h, 0.02]} at={[0, 0, 0.028]} m={mat('#f6f3ec', { rough: 0.9 })} />
      {Array.from({ length: 15 }, (_, i) => {
        const col = i % 5
        const row = Math.floor(i / 5)
        return (
          <Box
            key={i}
            size={[0.15, 0.15, 0.006]}
            at={[-w / 2 + 0.22 + col * 0.3, h / 2 - 0.2 - row * 0.28, 0.042]}
            m={mat(notes[(i * 3 + row) % notes.length], { rough: 0.9 })}
            rot={[0, 0, ((i % 5) - 2) * 0.04]}
          />
        )
      })}
      <Box size={[w * 0.5, 0.03, 0.008]} at={[-w * 0.18, -h / 2 + 0.1, 0.042]} m={soft(accent)} />
    </group>
  )
}

export function PendantLamp({ position, drop = 0.85, shade = '#f0e4d1', radius = 0.2 }: {
  position: P3; drop?: number; shade?: string; radius?: number
}) {
  const [x, ceiling, z] = position
  const y = ceiling - drop
  return (
    <group>
      <Cyl at={[x, ceiling - drop / 2, z]} m={mat('#4b5257', { rough: 0.6 })} rt={0.006} rb={0.006} h={drop} seg={6} />
      <Cyl at={[x, y, z]} m={mat(shade, { rough: 0.7, twoSided: true })} rt={radius * 0.35} rb={radius} h={radius * 0.9} seg={20} cast />
      <Sph at={[x, y - radius * 0.3, z]} m={mat('#fff4dd', { rough: 0.4, emissive: '#ffe9c2', glow: 1.8 })} r={radius * 0.3} seg={12} />
    </group>
  )
}

export function WallSign({ position, rotationY = 0, w = 0.9, h = 0.24, color = '#3f4a54' }: {
  position: P3; rotationY?: number; w?: number; h?: number; color?: string
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w, h, 0.025]} at={[0, 0, 0]} m={mat(color, { rough: 0.55 })} cast />
      <Box size={[w - 0.1, 0.02, 0.008]} at={[0, -h * 0.18, 0.017]} m={mat('#e9eef0', { rough: 0.4 })} />
    </group>
  )
}

export function Bench({ position, rotationY = 0, w = 1.6 }: { position: P3; rotationY?: number; w?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[w, 0.08, 0.42]} at={[0, 0.44, 0]} m={wood(C.oakPale)} cast receive />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.06, 0.42, 0.38]} at={[s * (w / 2 - 0.06), 0.21, 0]} m={metalM(C.metalDark)} cast />
      ))}
      <Box size={[w - 0.2, 0.05, 0.06]} at={[0, 0.1, 0]} m={metalM(C.metalDark)} />
    </group>
  )
}

/** ── Seating for the meeting room ───────────────────────────────────────────── */
export function ConferenceChair({ position, rotationY = 0 }: { position: P3; rotationY?: number }) {
  const cloth = soft('#b3bcc3')
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.46, 0.07, 0.44]} at={[0, 0.45, 0]} m={cloth} cast />
      <Box size={[0.44, 0.5, 0.06]} at={[0, 0.74, -0.2]} m={cloth} rot={[-0.12, 0, 0]} cast />
      <Cyl at={[0, 0.23, 0]} m={metalM(C.metalDark)} rt={0.03} rb={0.03} h={0.42} seg={10} />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return <Box key={i} size={[0.23, 0.028, 0.045]} at={[Math.sin(a) * 0.12, 0.04, Math.cos(a) * 0.12]} m={metalM(C.metalDark)} rot={[0, -a, 0]} />
      })}
    </group>
  )
}

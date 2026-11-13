import { useMemo } from 'react'
import { Text } from '@react-three/drei'
import { Box, mat } from '../office/primitives'
import { InstancedBoxes, InstancedCylinders } from './CampusKit'
import {
  CAFE_COUNTER, CAFE_PERGOLA, DISTRICT, PARK_PAVILION, PARKING,
  type Building,
} from '../../lib/campusLayout'

/** Landmark masses around the office: Innovation District, café, park pavilion and parking
 *  canopy. Interiors are decorative and closed; the collision world treats them as solids. */
export function CampusBuildings() {
  const fins = useMemo(() => {
    const out: { x: number; y: number; z: number; w: number; h: number; d: number; color: string }[] = []
    for (const b of DISTRICT) {
      const h = b.height * 0.68
      for (let x = b.x0 + 1.2; x < b.x1 - 0.4; x += 2.1) {
        out.push({ x, y: 0.5 + h / 2, z: b.z1 + 0.08, w: 0.12, h, d: 0.12, color: '#d7d2c6' })
      }
    }
    return out
  }, [])
  return (
    <group>
      {DISTRICT.map((b) => <DistrictBuilding key={b.id} b={b} />)}
      <InstancedBoxes items={fins} rough={0.75} />
      <Cafe />
      <Pavilion />
      <ParkingCanopy />
      <Monument />
    </group>
  )
}

function DistrictBuilding({ b }: { b: Building }) {
  const w = b.x1 - b.x0
  const d = b.z1 - b.z0
  const cx = (b.x0 + b.x1) / 2
  const cz = (b.z0 + b.z1) / 2
  const south = b.z1
  return (
    <group>
      <Box size={[w, b.height, d]} at={[cx, b.height / 2, cz]} m={mat(b.wall, { rough: 0.86 })} cast receive />
      {[0.34, 0.6].map((f) => (
        <Box key={f} size={[w * 0.9, b.height * 0.18, 0.08]} at={[cx, b.height * f, south + 0.05]} m={mat(b.glass, { rough: 0.18, metal: 0.25, opacity: 0.9 })} />
      ))}
      <Box size={[w * 0.34, b.height * 0.5, 0.09]} at={[cx - w * 0.22, b.height * 0.46, south + 0.06]} m={mat('#7f9b9a', { rough: 0.2, metal: 0.2, opacity: 0.85 })} />
      <Box size={[w * 0.98, 0.24, d * 0.98]} at={[cx, b.height + 0.08, cz]} m={mat(b.roof, { rough: 0.9 })} cast />
      <Box size={[w * 0.5, 0.1, d * 0.42]} at={[cx + w * 0.16, b.height + 0.22, cz - d * 0.12]} m={mat('#7c9a72', { rough: 0.95 })} />
      <Box size={[w * 0.2, 0.7, d * 0.2]} at={[cx - w * 0.24, b.height + 0.45, cz + d * 0.18]} m={mat('#b8b4a9', { rough: 0.8 })} cast />
      <Text
        position={[cx, b.height * 0.83, south + 0.13]}
        fontSize={Math.min(0.92, w * 0.1)}
        color="#42525a"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.12}
        maxWidth={w * 0.86}
      >
        {b.label}
      </Text>
    </group>
  )
}

function Cafe() {
  const cx = (CAFE_COUNTER.x0 + CAFE_COUNTER.x1) / 2
  const cz = (CAFE_COUNTER.z0 + CAFE_COUNTER.z1) / 2
  const posts = useMemo(() => {
    const out = []
    const xs = [CAFE_PERGOLA.x0 + 0.35, CAFE_PERGOLA.x1 - 0.35]
    const zs = [CAFE_PERGOLA.z0 + 0.35, CAFE_PERGOLA.z1 - 0.35]
    for (const x of xs) for (const z of zs) out.push({ x, y: 1.35, z, r: 0.075, h: 2.7, color: '#6d6c63' })
    return out
  }, [])
  const slats = useMemo(() => {
    const out = []
    for (let x = CAFE_PERGOLA.x0 + 0.5; x < CAFE_PERGOLA.x1 - 0.2; x += 0.62) {
      out.push({ x, y: 2.74, z: (CAFE_PERGOLA.z0 + CAFE_PERGOLA.z1) / 2, w: 0.1, h: 0.08, d: CAFE_PERGOLA.z1 - CAFE_PERGOLA.z0 - 0.4, color: '#b99d76' })
    }
    return out
  }, [])
  return (
    <group>
      {/* Kiosk / counter on the east edge of the terrace. */}
      <Box size={[CAFE_COUNTER.x1 - CAFE_COUNTER.x0, 2.7, CAFE_COUNTER.z1 - CAFE_COUNTER.z0]} at={[cx, 1.35, cz]} m={mat('#d7cbb6', { rough: 0.82 })} cast />
      <Box size={[CAFE_COUNTER.x1 - CAFE_COUNTER.x0 + 0.24, 0.16, CAFE_COUNTER.z1 - CAFE_COUNTER.z0 + 0.24]} at={[cx, 2.76, cz]} m={mat('#8a836f', { rough: 0.7 })} cast />
      <Box size={[0.06, 1.0, 2.6]} at={[CAFE_COUNTER.x0 - 0.02, 1.5, cz]} m={mat('#6f8f8d', { rough: 0.16, metal: 0.2, opacity: 0.9 })} />
      <Box size={[0.1, 0.12, 3.4]} at={[CAFE_COUNTER.x0 - 0.12, 1.05, cz]} m={mat('#b29770', { rough: 0.45 })} />
      <Text position={[cx, 2.28, CAFE_COUNTER.z1 + 0.06]} fontSize={0.34} color="#4a554e" anchorX="center" anchorY="middle" letterSpacing={0.14}>
        GREEN CAFÉ
      </Text>
      <InstancedCylinders items={posts} rough={0.55} metal={0.2} cast />
      <InstancedBoxes items={slats} rough={0.8} cast />
      {/* Pergola beams. */}
      {[CAFE_PERGOLA.z0 + 0.35, CAFE_PERGOLA.z1 - 0.35].map((z) => (
        <Box key={z} size={[CAFE_PERGOLA.x1 - CAFE_PERGOLA.x0, 0.13, 0.12]} at={[(CAFE_PERGOLA.x0 + CAFE_PERGOLA.x1) / 2, 2.66, z]} m={mat('#8c7152', { rough: 0.75 })} cast />
      ))}
    </group>
  )
}

function Pavilion() {
  const posts = useMemo(() => {
    const out = []
    for (const x of [PARK_PAVILION.x0 + 0.12, PARK_PAVILION.x1 - 0.12]) {
      for (const z of [PARK_PAVILION.z0 + 0.12, PARK_PAVILION.z1 - 0.12]) {
        out.push({ x, y: 1.3, z, r: 0.09, h: 2.6, color: '#886f50' })
      }
    }
    return out
  }, [])
  const cx = (PARK_PAVILION.x0 + PARK_PAVILION.x1) / 2
  const cz = (PARK_PAVILION.z0 + PARK_PAVILION.z1) / 2
  return (
    <group>
      <InstancedCylinders items={posts} rough={0.8} cast />
      <Box size={[PARK_PAVILION.x1 - PARK_PAVILION.x0 + 0.6, 0.16, PARK_PAVILION.z1 - PARK_PAVILION.z0 + 0.6]} at={[cx, 2.66, cz]} m={mat('#b7a687', { rough: 0.82 })} cast />
      <Box size={[PARK_PAVILION.x1 - PARK_PAVILION.x0 - 0.4, 0.08, PARK_PAVILION.z1 - PARK_PAVILION.z0 - 0.4]} at={[cx, 2.78, cz]} m={mat('#7f9c72', { rough: 0.95 })} />
      <Box size={[2.6, 0.1, 0.7]} at={[cx, 0.5, cz]} m={mat('#b49a76', { rough: 0.8 })} cast />
      <Box size={[2.6, 0.5, 0.08]} at={[cx, 0.28, cz - 0.3]} m={mat('#9b8566', { rough: 0.8 })} />
    </group>
  )
}

function ParkingCanopy() {
  const posts = useMemo(() => {
    const out = []
    for (let x = PARKING.x0 + 1; x <= PARKING.x0 + 19; x += 3.6) {
      for (const z of [PARKING.z0 + 0.7, PARKING.z0 + 4.5]) {
        out.push({ x, y: 1.4, z, r: 0.075, h: 2.8, color: '#71807f' })
      }
    }
    return out
  }, [])
  const cx = PARKING.x0 + 10
  const cz = PARKING.z0 + 2.6
  return (
    <group>
      <InstancedCylinders items={posts} rough={0.5} metal={0.35} cast />
      <Box size={[20.2, 0.14, 5.6]} at={[cx, 2.84, cz]} m={mat('#c9c4b6', { rough: 0.7 })} cast />
      {[0, 1, 2, 3, 4].map((i) => (
        <Box key={i} size={[3.4, 0.04, 4.8]} at={[PARKING.x0 + 2.7 + i * 3.6, 2.93, cz]} m={mat('#38505a', { rough: 0.22, metal: 0.45 })} />
      ))}
      {[-28.6, -21.4].map((x) => (
        <group key={x}>
          <Box size={[0.34, 1.3, 0.28]} at={[x, 0.65, PARKING.z0 + 5.1]} m={mat('#e3e0d5', { rough: 0.55 })} cast />
          <Box size={[0.24, 0.36, 0.03]} at={[x, 1.05, PARKING.z0 + 5.25]} m={mat('#5aa99b', { rough: 0.25, emissive: '#4d9d8f', glow: 0.7 })} />
        </group>
      ))}
    </group>
  )
}

/** Low campus monument at the forecourt edge: names the place without blocking the entrance. */
function Monument() {
  return (
    <group position={[7.3, 0, 24.6]}>
      <Box size={[5.2, 0.22, 1.0]} at={[0, 0.11, 0]} m={mat('#c8c1b1', { rough: 0.92 })} receive />
      <Box size={[4.8, 0.9, 0.32]} at={[0, 0.62, 0]} m={mat('#5d7368', { rough: 0.7 })} cast />
      <Text position={[0, 0.74, 0.18]} fontSize={0.3} color="#ecf2e8" anchorX="center" anchorY="middle" letterSpacing={0.16}>
        GREEN TECH CAMPUS
      </Text>
      <Text position={[0, 0.5, 0.18]} fontSize={0.12} color="#b8d0c1" anchorX="center" anchorY="middle" letterSpacing={0.22}>
        AGENTVILLE · BUILD 01
      </Text>
    </group>
  )
}

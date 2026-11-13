import { useMemo } from 'react'
import { Text } from '@react-three/drei'
import { mat } from '../office/primitives'
import { InstancedBoxes, InstancedCylinders, InstancedSpheres, type BoxSpec, type CylinderSpec, type SphereSpec } from './CampusKit'
import { CAFE_CHAIRS, CAFE_TABLES, CARS, PARKING } from '../../lib/campusLayout'

/** Static vehicles and the café terrace furniture, all instanced by part. */
export function CampusProps() {
  const carBodies = useMemo<BoxSpec[]>(() => CARS.map((c) => ({
    x: c.x, y: 0.52, z: c.z, w: 1.78, h: 0.56, d: 4.0, ry: c.ry, color: c.color,
  })), [])

  const carCabins = useMemo<BoxSpec[]>(() => CARS.map((c) => ({
    x: c.x, y: 1.05, z: c.z - 0.18, w: 1.52, h: 0.5, d: 2.0, ry: c.ry, color: '#5f7c82',
  })), [])

  const wheels = useMemo<SphereSpec[]>(() => CARS.flatMap((c) =>
    [-0.84, 0.84].flatMap((dx) => [-1.3, 1.3].map((dz) => ({
      x: c.x + dx, y: 0.32, z: c.z + dz, sx: 0.13, sy: 0.31, sz: 0.31, color: '#2e3438',
    })))), [])

  const tableTops = useMemo<CylinderSpec[]>(() => CAFE_TABLES.map((t) => ({
    x: t.x, y: 0.74, z: t.z, r: 0.42, h: 0.05, color: '#c8ad84',
  })), [])

  const tablePosts = useMemo<CylinderSpec[]>(() => CAFE_TABLES.flatMap((t) => [
    { x: t.x, y: 0.37, z: t.z, r: 0.045, h: 0.74, color: '#5e6567' },
    { x: t.x, y: 0.02, z: t.z, r: 0.2, h: 0.03, color: '#5e6567' },
  ]), [])

  const chairs = useMemo<BoxSpec[]>(() => {
    const out: BoxSpec[] = []
    for (const c of CAFE_CHAIRS) {
      const co = Math.cos(c.ry)
      const si = Math.sin(c.ry)
      const at = (lx: number, lz: number): [number, number] => [c.x + lx * co + lz * si, c.z - lx * si + lz * co]
      const [sx, sz] = at(0, 0)
      out.push({ x: sx, y: 0.45, z: sz, w: 0.44, h: 0.06, d: 0.44, ry: c.ry, color: '#cbb99e' })
      const [bx, bz] = at(0, -0.2)
      out.push({ x: bx, y: 0.7, z: bz, w: 0.44, h: 0.44, d: 0.06, ry: c.ry, color: '#b9a586' })
      for (const s of [-1, 1]) {
        const [lx, lz] = at(s * 0.18, 0.18)
        out.push({ x: lx, y: 0.22, z: lz, w: 0.05, h: 0.44, d: 0.05, ry: c.ry, color: '#5e6567' })
      }
    }
    return out
  }, [])

  return (
    <group>
      <InstancedBoxes items={carBodies} rough={0.42} metal={0.35} cast />
      <InstancedBoxes items={carCabins} rough={0.16} metal={0.5} />
      <InstancedSpheres items={wheels} rough={0.85} />
      <InstancedCylinders items={tableTops} rough={0.62} cast />
      <InstancedCylinders items={tablePosts} rough={0.4} metal={0.5} />
      <InstancedBoxes items={chairs} rough={0.78} cast />
      <Text
        position={[PARKING.x0 + 10, 2.55, PARKING.z0 + 5.5]}
        fontSize={0.34}
        color="#dfe8e1"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.18}
      >
        PARKING · EV
      </Text>
      <Text position={[PARKING.x0 + 10, 2.3, PARKING.z0 + 5.5]} fontSize={0.12} color="#a9c6b2" anchorX="center" anchorY="middle" letterSpacing={0.22}>
        4 SOLAR CANOPY BAYS
      </Text>
      {/* A café planter sign, low enough not to hide the terrace. */}
      <Text position={[17.2, 0.72, 10.65]} fontSize={0.16} color="#ecf0e4" anchorX="center" anchorY="middle" letterSpacing={0.2}>
        ROASTED HERE
      </Text>
      <mesh position={[17.2, 0.72, 10.63]} material={mat('#4f6a5a', { rough: 0.7 })} raycast={() => null}>
        <planeGeometry args={[1.4, 0.28]} />
      </mesh>
      {[16.55, 17.85].map((x) => (
        <mesh key={x} position={[x, 0.29, 10.6]} material={mat('#5e6567', { rough: 0.5, metal: 0.3 })} raycast={() => null}>
          <boxGeometry args={[0.05, 0.58, 0.05]} />
        </mesh>
      ))}
    </group>
  )
}

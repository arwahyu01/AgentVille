import { useMemo } from 'react'
import { InstancedBoxes, InstancedCylinders, InstancedSpheres, type BoxSpec, type CylinderSpec, type SphereSpec } from './CampusKit'
import { BENCHES, BIKE_RACKS, LAMPS, PLANTERS, SHRUBS, TREES } from '../../lib/campusLayout'

const FOLIAGE = ['#6f9a6c', '#4f7f5c', '#86a877', '#7d9467']
const TRUNK = '#7a6146'
const SOIL = '#6b5a45'

/** Instanced nature: 58 trees, low shrubs, lamps, benches and planters in five draw groups. */
export function CampusNature() {
  const trunks = useMemo<CylinderSpec[]>(() => TREES.map((t) => ({
    x: t.x, y: t.h / 2, z: t.z, r: t.trunk, h: t.h, color: TRUNK,
  })), [])

  const canopies = useMemo<SphereSpec[]>(() => {
    const out: SphereSpec[] = []
    for (const t of TREES) {
      const color = FOLIAGE[t.kind % FOLIAGE.length]
      out.push({ x: t.x, y: t.h + t.r * 0.52, z: t.z, sx: t.r, sy: t.r * 0.86, sz: t.r, color })
      out.push({
        x: t.x + t.r * 0.42, y: t.h + t.r * 1.02, z: t.z - t.r * 0.28,
        sx: t.r * 0.62, sy: t.r * 0.58, sz: t.r * 0.62, color,
      })
    }
    return out
  }, [])

  const shrubs = useMemo<SphereSpec[]>(() => [
    ...SHRUBS.map((s) => ({
      x: s.x, y: s.r * 0.62, z: s.z, sx: s.r, sy: s.r * 0.72, sz: s.r, color: '#6f9270',
    })),
    ...PLANTERS.map((p) => ({
      x: p.x, y: 0.64, z: p.z, sx: 0.32, sy: 0.2, sz: 0.32, color: '#7a9c72',
    })),
  ], [])

  const lampPosts = useMemo<CylinderSpec[]>(() => LAMPS.map((l) => ({
    x: l.x, y: (l.tall ? 3.3 : 2.5) / 2, z: l.z, r: 0.05, h: l.tall ? 3.3 : 2.5, color: '#5b666b',
  })), [])

  const lampHeads = useMemo<SphereSpec[]>(() => LAMPS.map((l) => ({
    x: l.x, y: (l.tall ? 3.3 : 2.5) + 0.1, z: l.z,
    sx: 0.2, sy: 0.12, sz: 0.2, color: '#f2e7c9',
  })), [])

  const planters = useMemo<BoxSpec[]>(() => PLANTERS.flatMap((p) => [
    { x: p.x, y: 0.28, z: p.z, w: p.w, h: 0.56, d: p.d, color: '#b8ac97' },
    { x: p.x, y: 0.57, z: p.z, w: p.w - 0.1, h: 0.03, d: p.d - 0.1, color: SOIL },
  ]), [])

  const benches = useMemo<BoxSpec[]>(() => {
    const out: BoxSpec[] = []
    for (const b of BENCHES) {
      const c = Math.cos(b.ry)
      const s = Math.sin(b.ry)
      const at = (lx: number, lz: number): [number, number] => [b.x + lx * c + lz * s, b.z - lx * s + lz * c]
      const [sx, sz] = at(0, 0)
      out.push({ x: sx, y: 0.44, z: sz, w: 1.6, h: 0.08, d: 0.42, ry: b.ry, color: '#c2a77e' })
      for (const side of [-1, 1]) {
        const [lx, lz] = at(side * 0.72, 0)
        out.push({ x: lx, y: 0.21, z: lz, w: 0.07, h: 0.42, d: 0.36, ry: b.ry, color: '#6e7477' })
      }
      const [fx, fz] = at(0, 0)
      out.push({ x: fx, y: 0.1, z: fz, w: 1.4, h: 0.05, d: 0.06, ry: b.ry, color: '#6e7477' })
    }
    return out
  }, [])

  const racks = useMemo<CylinderSpec[]>(() => {
    const out: CylinderSpec[] = []
    for (const r of BIKE_RACKS) {
      for (let i = 0; i < r.n; i++) {
        const z = r.z + i * 0.62
        out.push({ x: r.x - 0.32, y: 0.4, z, r: 0.028, h: 0.8, color: '#7b8588' })
        out.push({ x: r.x + 0.32, y: 0.4, z, r: 0.028, h: 0.8, color: '#7b8588' })
      }
    }
    return out
  }, [])

  const rackBars = useMemo<BoxSpec[]>(() => BIKE_RACKS.flatMap((r) => Array.from({ length: r.n }, (_, i) => ({
    x: r.x, y: 0.8, z: r.z + i * 0.62, w: 0.68, h: 0.05, d: 0.05, color: '#7b8588',
  }))), [])

  return (
    <group>
      <InstancedCylinders items={trunks} rough={0.95} cast />
      <InstancedSpheres items={canopies} rough={0.92} cast />
      <InstancedSpheres items={shrubs} rough={0.95} />
      <InstancedCylinders items={lampPosts} rough={0.45} metal={0.4} cast />
      <InstancedSpheres items={lampHeads} rough={0.5} />
      <InstancedBoxes items={planters} rough={0.88} receive />
      <InstancedBoxes items={benches} rough={0.78} cast />
      <InstancedCylinders items={racks} rough={0.4} metal={0.55} cast />
      <InstancedBoxes items={rackBars} rough={0.4} metal={0.55} cast />
      <Bollards />
    </group>
  )
}

/** A few stone bollards where the forecourt meets the drop-off lane. */
function Bollards() {
  const items = useMemo<CylinderSpec[]>(() => {
    const out: CylinderSpec[] = []
    for (let z = 23.6; z <= 28.4; z += 1.2) {
      out.push({ x: 3.4, y: 0.34, z, r: 0.11, h: 0.68, color: '#a9a497' })
    }
    return out
  }, [])
  return <InstancedCylinders items={items} rough={0.85} cast />
}

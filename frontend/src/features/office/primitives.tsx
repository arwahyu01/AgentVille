import { useMemo } from 'react'
import * as THREE from 'three'

/** Geometry and materials are cached by shape/colour. The office builds several thousand small
 * boxes; sharing them keeps the draw-call and GPU-memory cost proportional to the variety of
 * parts rather than their count. */
const geoCache = new Map<string, THREE.BufferGeometry>()
const matCache = new Map<string, THREE.MeshStandardMaterial>()

function cached<T>(map: Map<string, T>, key: string, make: () => T): T {
  const hit = map.get(key)
  if (hit) return hit
  const made = make()
  map.set(key, made)
  return made
}

export const boxGeo = (w: number, h: number, d: number) =>
  cached(geoCache, `b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d))
export const planeGeo = (w: number, h: number) =>
  cached(geoCache, `p${w},${h}`, () => new THREE.PlaneGeometry(w, h))
export const cylGeo = (rt: number, rb: number, h: number, seg = 16) =>
  cached(geoCache, `c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg))
export const sphGeo = (r: number, seg = 16) =>
  cached(geoCache, `s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)))
export const capGeo = (r: number, len: number) =>
  cached(geoCache, `k${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10))
export const torusGeo = (r: number, tube: number) =>
  cached(geoCache, `t${r},${tube}`, () => new THREE.TorusGeometry(r, tube, 8, 24))

export interface MatOpts {
  rough?: number
  metal?: number
  emissive?: string
  glow?: number
  opacity?: number
  twoSided?: boolean
  /** Optional repeating surface pattern. Its `name` joins the cache key, so each (colour, repeat)
   *  pair still resolves to exactly one shared material. */
  map?: THREE.Texture | null
}

export function mat(color: string, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `m${color}|${opts.rough ?? 0.7}|${opts.metal ?? 0}|${opts.emissive ?? ''}|${opts.glow ?? 0}|${opts.opacity ?? 1}|${opts.twoSided ? 1 : 0}|${opts.map?.name ?? ''}`
  return cached(matCache, key, () => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.rough ?? 0.7,
      metalness: opts.metal ?? 0,
      emissive: new THREE.Color(opts.emissive ?? '#000000'),
      emissiveIntensity: opts.glow ?? 1,
      map: opts.map ?? null,
    })
    if (opts.twoSided) m.side = THREE.DoubleSide
    if (opts.opacity !== undefined && opts.opacity < 1) {
      m.transparent = true
      m.opacity = opts.opacity
      m.depthWrite = false
    }
    return m
  })
}

type Vec3 = [number, number, number]

/** Environment props are decoration: they must never swallow a click meant for an agent, and
 * skipping them in the raycast keeps picking cheap as the fitout grows. */
const noRaycast = () => null

export function Box({ size, at, m, cast, receive, rot }: {
  size: Vec3; at: Vec3; m: THREE.Material; cast?: boolean; receive?: boolean; rot?: Vec3
}) {
  return <mesh geometry={boxGeo(...size)} position={at} material={m} rotation={rot} raycast={noRaycast} castShadow={!!cast} receiveShadow={!!receive} />
}

export function Plane({ size, at, m, rot }: {
  size: [number, number]; at: Vec3; m: THREE.Material; rot?: Vec3
}) {
  return <mesh geometry={planeGeo(...size)} position={at} material={m} rotation={rot} raycast={noRaycast} />
}

export function Cyl({ at, m, rt = 0.05, rb = 0.05, h = 1, seg = 16, rot, cast, receive }: {
  at: Vec3; m: THREE.Material; rt?: number; rb?: number; h?: number; seg?: number; rot?: Vec3; cast?: boolean; receive?: boolean
}) {
  return <mesh geometry={cylGeo(rt, rb, h, seg)} position={at} material={m} rotation={rot} raycast={noRaycast} castShadow={!!cast} receiveShadow={!!receive} />
}

export function Sph({ at, m, r = 0.05, seg = 16, cast }: {
  at: Vec3; m: THREE.Material; r?: number; seg?: number; cast?: boolean
}) {
  return <mesh geometry={sphGeo(r, seg)} position={at} material={m} raycast={noRaycast} castShadow={!!cast} />
}

export function Cap({ at, m, r = 0.05, len = 0.2, rot, cast }: {
  at: Vec3; m: THREE.Material; r?: number; len?: number; rot?: Vec3; cast?: boolean
}) {
  return <mesh geometry={capGeo(r, len)} position={at} material={m} rotation={rot} raycast={noRaycast} castShadow={!!cast} />
}

/** Memo wrapper so a room's shared materials are built once per render, not once per prop. */
export function useMakers<T>(make: () => T): T {
  return useMemo(make, [make])
}

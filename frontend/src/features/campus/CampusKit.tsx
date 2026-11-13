import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mat } from '../office/primitives'
import { surfaceTex, type SurfaceKind } from '../office/textures'
import type { Rect } from '../../lib/campusLayout'

/** Small shared kit for the campus: paving rectangles and instanced primitives.
 *  Everything repeated (trees, lamps, benches, fins, road dashes) goes through an
 *  InstancedMesh so the campus stays inside a modest draw-call budget. */

const unitBox = new THREE.BoxGeometry(1, 1, 1)
const unitSphere = new THREE.SphereGeometry(1, 10, 8)
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 10)

export interface BoxSpec {
  x: number; y: number; z: number
  w: number; h: number; d: number
  ry?: number
  color: string
}

export interface SphereSpec {
  x: number; y: number; z: number
  sx: number; sy: number; sz: number
  color: string
}

export interface CylinderSpec {
  x: number; y: number; z: number
  r: number; h: number
  color: string
}

const dummy = new THREE.Object3D()

function useInstancedMaterial(rough: number, metal: number) {
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: rough, metalness: metal, vertexColors: false,
  }), [rough, metal])
  useEffect(() => () => material.dispose(), [material])
  return material
}

export function InstancedBoxes({ items, rough = 0.85, metal = 0, cast = false, receive = false }: {
  items: BoxSpec[]; rough?: number; metal?: number; cast?: boolean; receive?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const material = useInstancedMaterial(rough, metal)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const color = new THREE.Color()
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z)
      dummy.rotation.set(0, it.ry ?? 0, 0)
      dummy.scale.set(it.w, it.h, it.d)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, color.set(it.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])
  if (!items.length) return null
  return (
    <instancedMesh
      ref={ref}
      args={[unitBox, material, items.length]}
      castShadow={cast}
      receiveShadow={receive}
      raycast={() => null}
    />
  )
}

export function InstancedSpheres({ items, rough = 0.9, cast = false }: {
  items: SphereSpec[]; rough?: number; cast?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const material = useInstancedMaterial(rough, 0)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const color = new THREE.Color()
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(it.sx, it.sy, it.sz)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, color.set(it.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])
  if (!items.length) return null
  return (
    <instancedMesh ref={ref} args={[unitSphere, material, items.length]} castShadow={cast} raycast={() => null} />
  )
}

export function InstancedCylinders({ items, rough = 0.7, metal = 0, cast = false }: {
  items: CylinderSpec[]; rough?: number; metal?: number; cast?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const material = useInstancedMaterial(rough, metal)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const color = new THREE.Color()
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(it.r, it.h, it.r)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, color.set(it.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])
  if (!items.length) return null
  return (
    <instancedMesh ref={ref} args={[unitCylinder, material, items.length]} castShadow={cast} raycast={() => null} />
  )
}

/** Flat paved rectangle with a subtle edge tone. One draw call per patch is fine here, and the
 *  pattern repeat is derived from the patch size so slabs stay the same physical size everywhere. */
export function Pave({ rect, y = 0.025, color, rough = 0.92, opacity, kind = 'paving' }: {
  rect: Rect; y?: number; color: string; rough?: number; opacity?: number; kind?: SurfaceKind
}) {
  const w = rect.x1 - rect.x0
  const d = rect.z1 - rect.z0
  return (
    <mesh
      position={[(rect.x0 + rect.x1) / 2, y, (rect.z0 + rect.z1) / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={mat('#ffffff', {
        rough,
        opacity,
        map: surfaceTex(kind, color, [Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(d / 2))]),
      })}
      raycast={() => null}
      receiveShadow
    >
      <planeGeometry args={[w, d]} />
    </mesh>
  )
}

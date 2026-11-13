import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Box, Plane, mat } from '../office/primitives'
import { surfaceTex } from '../office/textures'
import { InstancedBoxes, InstancedCylinders, Pave } from './CampusKit'
import {
  BRIDGE, CAMPUS_BOUNDS, CAFE, CROSSWALKS, DISTRICT_PLAZA,
  DROP_OFF_LANE, ENTRANCE_PROMENADE, FORECOURT, HILLS, PARKING, PLAZA,
  RIVER, RIVERWALK, ROAD, SIDEWALK_NORTH, SIDEWALK_SOUTH, WALKS,
  type Rect,
} from '../../lib/campusLayout'

const foamMat = () => mat('#e9f6f2', { rough: 0.4, opacity: 0.55 })

/** Ground plate, paving network, road markings, river, bridge and weir. */
export function CampusGround() {
  const roadMarks = useMemo(() => {
    const dashes = []
    for (let x = -158; x <= 158; x += 4.2) {
      dashes.push({ x, y: 0.052, z: 33.5, w: 1.8, h: 0.012, d: 0.14, color: '#e7e2d4' })
    }
    for (const cw of CROSSWALKS) {
      for (let z = cw.z0 + 0.6; z < cw.z1 - 0.2; z += 0.8) {
        dashes.push({
          x: (cw.x0 + cw.x1) / 2, y: 0.052, z,
          w: cw.x1 - cw.x0 - 0.5, h: 0.012, d: 0.34, color: '#ece7da',
        })
      }
    }
    for (let x = -30; x <= -12; x += 3) {
      dashes.push({ x, y: 0.052, z: 42.5, w: 0.08, h: 0.012, d: 5, color: '#e8e3d6' })
    }
    return dashes
  }, [])

  const bridgePosts = useMemo(() => {
    const posts = []
    for (let x = BRIDGE.x0 + 0.6; x <= BRIDGE.x1 - 0.4; x += 1.8) {
      posts.push({ x, y: 0.58, z: BRIDGE.z0 + 0.14, r: 0.045, h: 1.0, color: '#59636a' })
      posts.push({ x, y: 0.58, z: BRIDGE.z1 - 0.14, r: 0.045, h: 1.0, color: '#59636a' })
    }
    return posts
  }, [])

  return (
    <group>
      {/* Site lawn inside the fence line, then a wider landscape plate under the hills. Both carry
       *  a procedural turf pattern so the ground keeps detail all the way to the horizon. */}
      <Plane size={[340, 340]} at={[0, -0.12, 0]} m={mat('#ffffff', { rough: 1, map: surfaceTex('grass', '#adbda3', [120, 120]) })} rot={[-Math.PI / 2, 0, 0]} />
      <Plane size={[CAMPUS_BOUNDS.x1 - CAMPUS_BOUNDS.x0, CAMPUS_BOUNDS.z1 - CAMPUS_BOUNDS.z0]} at={[0, -0.03, 0]} m={mat('#ffffff', { rough: 1, map: surfaceTex('grass', '#a3ba97', [60, 60]) })} rot={[-Math.PI / 2, 0, 0]} />

      {/* Paved surfaces. The road and its sidewalks run past the site boundary so the campus
       *  reads as part of a larger district instead of a diorama on a table. */}
      <Pave rect={PLAZA} color="#d8d1c1" />
      <Pave rect={ENTRANCE_PROMENADE} y={0.035} color="#c6bead" />
      <Pave rect={FORECOURT} color="#d3ccbc" />
      <Pave rect={DISTRICT_PLAZA} color="#d6d0c2" />
      <Pave rect={{ ...SIDEWALK_SOUTH, x0: -164, x1: 164 }} color="#cfcabe" />
      <Pave rect={{ ...SIDEWALK_NORTH, x0: -164, x1: 164 }} color="#cfcabe" />
      <Pave rect={{ ...ROAD, x0: -164, x1: 164 }} color="#596367" kind="concrete" />
      <Pave rect={DROP_OFF_LANE} y={0.03} color="#525c60" kind="concrete" />
      <Pave rect={PARKING} color="#5f696c" kind="concrete" />
      <Pave rect={CAFE} color="#d8cebb" />
      {WALKS.map((r, i) => <Walk key={i} rect={r} />)}

      <InstancedBoxes items={roadMarks} rough={0.8} />

      <River />
      <RoadBridge />
      <Bridge posts={bridgePosts} />
      <Weir />

      {/* Layered landscape hills: visible from Campus View, outside the playable bounds. */}
      <Hills />
    </group>
  )
}

function Walk({ rect }: { rect: Rect }) {
  if (rect === BRIDGE) return null
  const color = rect === RIVERWALK ? '#b7a083' : '#c8c1b0'
  return <Pave rect={rect} y={0.03} color={color} />
}

function River() {
  const strips = useRef<THREE.Group>(null)
  // One material for the water, built once: the surface pattern scrolls along the flow line, so
  // the current reads as moving water instead of a blue slab, without a fluid simulation.
  const water = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.18,
    metalness: 0.12,
    transparent: true,
    opacity: 0.94,
    map: surfaceTex('water', '#6fa8ad', [8, 120]),
  }), [])
  useEffect(() => () => water.dispose(), [water])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (water.map) water.map.offset.y = (t * 0.05) % 1
    if (!strips.current) return
    strips.current.children.forEach((child, i) => {
      child.position.z = -150 + ((i * 75 + t * 1.1) % 300)
      child.position.x = (RIVER.x0 + RIVER.x1) / 2 + Math.sin(t * 0.35 + i * 1.7) * 2.6
    })
  })
  const cx = (RIVER.x0 + RIVER.x1) / 2
  const bank = mat('#b9b3a6', { rough: 0.95 })
  return (
    <group>
      {/* The river continues past the site boundary, so it reads as landscape rather than a
       *  rectangular pool. The banks are split where the arterial road bridges it. */}
      <Plane size={[RIVER.x1 - RIVER.x0, 300]} at={[cx, 0.006, 0]} m={water} rot={[-Math.PI / 2, 0, 0]} />
      <Plane size={[(RIVER.x1 - RIVER.x0) - 4, 300]} at={[cx, 0.012, 0]} m={mat('#4e878f', { rough: 0.25, metal: 0.1, opacity: 0.25 })} rot={[-Math.PI / 2, 0, 0]} />
      {[RIVER.x0 - 0.45, RIVER.x1 + 0.45].map((x) => (
        <group key={x}>
          <Box size={[0.9, 0.22, 179]} at={[x, 0.02, -60.5]} m={bank} receive />
          <Box size={[0.9, 0.22, 112]} at={[x, 0.02, 94]} m={bank} receive />
        </group>
      ))}
      <group ref={strips}>
        {[0, 1, 2, 3].map((i) => (
          <Plane key={i} size={[3.2, 0.2]} at={[RIVER.x0 + 6, 0.022, i * 22 - 40]} m={foamMat()} rot={[-Math.PI / 2, 0, 0]} />
        ))}
      </group>
    </group>
  )
}

/** The arterial road crosses the river: a flat deck with parapets, piers and abutments. */
function RoadBridge() {
  const x0 = RIVER.x0 - 1.4
  const x1 = RIVER.x1 + 1.4
  const cx = (x0 + x1) / 2
  const stone = mat('#b3ada0', { rough: 0.94 })
  const rail = mat('#8e9699', { rough: 0.6, metal: 0.25 })
  return (
    <group>
      <Box size={[x1 - x0, 0.1, 9.4]} at={[cx, 0.055, 33.5]} m={mat('#6b6f70', { rough: 0.9 })} receive />
      {[31.05, 35.95].map((z) => (
        <group key={z}>
          <Box size={[x1 - x0, 0.52, 0.2]} at={[cx, 0.4, z]} m={stone} cast />
          <Box size={[x1 - x0, 0.07, 0.26]} at={[cx, 0.69, z]} m={rail} />
        </group>
      ))}
      {[x0, x1].map((x) => (
        <Box key={x} size={[1.4, 1.4, 9.8]} at={[x, -0.35, 33.5]} m={stone} />
      ))}
      {[-4.4, 4.4].map((dx) => (
        <Box key={dx} size={[0.9, 1.5, 8.2]} at={[cx + dx, -0.5, 33.5]} m={stone} />
      ))}
    </group>
  )
}

function Bridge({ posts }: { posts: { x: number; y: number; z: number; r: number; h: number; color: string }[] }) {
  return (
    <group>
      <Box size={[BRIDGE.x1 - BRIDGE.x0, 0.12, BRIDGE.z1 - BRIDGE.z0]} at={[(BRIDGE.x0 + BRIDGE.x1) / 2, 0.09, (BRIDGE.z0 + BRIDGE.z1) / 2]} m={mat('#bda47f', { rough: 0.82 })} cast receive />
      {[BRIDGE.z0 + 0.08, BRIDGE.z1 - 0.08].map((z) => (
        <Box key={z} size={[BRIDGE.x1 - BRIDGE.x0, 0.12, 0.16]} at={[(BRIDGE.x0 + BRIDGE.x1) / 2, 0.92, z]} m={mat('#6a6f70', { rough: 0.4, metal: 0.55 })} cast />
      ))}
      <InstancedCylinders items={posts} rough={0.45} metal={0.6} cast />
      {[-43.5, -36.5].map((x) => (
        <group key={x}>
          <Box size={[0.7, 1.2, 1.4]} at={[x, -0.45, (BRIDGE.z0 + BRIDGE.z1) / 2]} m={mat('#a9a599', { rough: 0.95 })} />
          <Box size={[0.9, 0.18, 1.7]} at={[x, 0.02, (BRIDGE.z0 + BRIDGE.z1) / 2]} m={mat('#c1bcae', { rough: 0.9 })} />
        </group>
      ))}
    </group>
  )
}

function Weir() {
  return (
    <group>
      <Box size={[RIVER.x1 - RIVER.x0, 0.34, 0.7]} at={[(RIVER.x0 + RIVER.x1) / 2, -0.02, -18]} m={mat('#aaa79a', { rough: 0.95 })} />
      <Box size={[RIVER.x1 - RIVER.x0, 0.02, 0.5]} at={[(RIVER.x0 + RIVER.x1) / 2, 0.03, -17.3]} m={foamMat()} />
      <Box size={[RIVER.x1 - RIVER.x0, 0.02, 0.3]} at={[(RIVER.x0 + RIVER.x1) / 2, 0.028, -16.8]} m={foamMat()} />
    </group>
  )
}

const hillGeo = new THREE.SphereGeometry(1, 18, 12)

function Hills() {
  return (
    <group>
      {HILLS.map((h, i) => (
        <mesh
          key={i}
          geometry={hillGeo}
          position={[h.x, -h.h * 0.28, h.z]}
          scale={[h.r, h.h, h.r * 0.72]}
          material={mat(h.color, { rough: 1 })}
          raycast={() => null}
        />
      ))}
    </group>
  )
}

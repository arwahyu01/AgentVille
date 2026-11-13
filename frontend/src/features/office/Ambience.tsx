import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { Box, Cyl, mat } from './primitives'

const bladeMat = mat('#ced3d7', { rough: 0.55, metal: 0.25 })
const hubMat = mat('#454d55', { rough: 0.5, metal: 0.4 })
const rodMat = mat('#6b737b', { rough: 0.45, metal: 0.5 })

/** A ceiling fan is room ambience, not an agent action: it says the building is switched on. It
 *  spins on its own clock rather than any backend status, so it can never imply that a resting
 *  agent is working. One fan is one `useFrame`, so a pair of them stays negligible. */
export function CeilingFan({ position, speed = 2.6 }: { position: [number, number, number]; speed?: number }) {
  const rotor = useRef<Group>(null)
  useFrame((_, delta) => {
    if (rotor.current) rotor.current.rotation.y += speed * Math.min(delta, 0.05)
  })
  return (
    <group position={position}>
      <Cyl at={[0, 2.96, 0]} m={rodMat} rt={0.09} rb={0.07} h={0.09} seg={14} />
      <Cyl at={[0, 2.7, 0]} m={rodMat} rt={0.026} rb={0.026} h={0.5} seg={10} />
      <group ref={rotor} position={[0, 2.45, 0]}>
        <Cyl at={[0, 0, 0]} m={hubMat} rt={0.07} rb={0.085} h={0.13} seg={16} />
        {[0, 1, 2, 3].map((i) => (
          <group key={i} rotation={[0, (i * Math.PI) / 2, 0]}>
            <Box size={[0.62, 0.014, 0.16]} at={[0.37, 0, 0]} m={bladeMat} rot={[0, 0, 0.11]} cast />
          </group>
        ))}
      </group>
    </group>
  )
}
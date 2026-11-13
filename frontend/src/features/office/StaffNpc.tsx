import { useEffect, useRef, useState } from 'react'
import { MeshBasicMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import type { Group } from 'three'
import { Humanoid, type Skeleton } from './AgentFigure'
import { capGeo } from './primitives'
import { SocialBubble } from './SocialBubble'
import { STAFF_AMBIENT_LINES, type StaffVariant } from './staffScript'

/** Invisible pick shell so the small lobby figure is still an easy click target. */
const pickMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })

/** Fit-out front-of-house staff (greeter / teller). These are scene extras, not backend agents:
 *  they carry no agent row, no status and no task, so talking to one only opens the local Q&A.
 *  That keeps the 14-agent roster intact while the lobby has someone to welcome guests. */
export function StaffNpc({ variant, position, rotationY = 0, seed = 0, onTalk }: {
  variant: StaffVariant
  position: [number, number, number]
  rotationY?: number
  seed?: number
  onTalk?: (variant: StaffVariant) => void
}) {
  const body = useRef<Group>(null)
  const head = useRef<Group>(null)
  const armL = useRef<Group>(null)
  const armR = useRef<Group>(null)
  const foreL = useRef<Group>(null)
  const foreR = useRef<Group>(null)
  const thighL = useRef<Group>(null)
  const thighR = useRef<Group>(null)
  const shinL = useRef<Group>(null)
  const shinR = useRef<Group>(null)
  const sk: Skeleton = { body, head, armL, armR, foreL, foreR, thighL, thighR, shinL, shinR }
  const [hovered, setHovered] = useState(false)
  const [ambient, setAmbient] = useState<string | null>(null)

  // A quiet self-managed greeting every 22–30 s. Staff do not move, and the line is hidden while
  // the hover prompt asks the visitor to talk, so the lobby never shows two boards at once.
  useEffect(() => {
    let alive = true
    let show = 0
    let hide = 0
    let index = 0
    const lines = STAFF_AMBIENT_LINES[variant]
    const reveal = () => {
      if (!alive) return
      setAmbient(lines[(seed + index) % lines.length])
      index += 1
      hide = window.setTimeout(() => { if (alive) setAmbient(null) }, 6000)
      show = window.setTimeout(reveal, 22000 + ((seed * 7 + index * 13) % 8000))
    }
    show = window.setTimeout(reveal, 9000 + seed * 1200)
    return () => {
      alive = false
      window.clearTimeout(show)
      window.clearTimeout(hide)
    }
  }, [variant, seed])

  useFrame((state) => {
    const t = state.clock.elapsedTime + seed
    if (body.current) body.current.position.y = Math.sin(t * 1.5) * 0.006
    if (head.current) {
      head.current.rotation.y = Math.sin(t * 0.4) * 0.12
      head.current.rotation.x = -0.01 + Math.sin(t * 0.6) * 0.015
    }
    if (variant === 'greeter') {
      // A small hand-to-chest welcome once in a while; the rest is a relaxed host idle.
      const phase = t % 12
      const gesture = phase < 1.4 ? Math.sin(phase / 1.4 * Math.PI) : 0
      if (armR.current) {
        armR.current.rotation.x = -0.08 - gesture * 0.55
        armR.current.rotation.z = -0.04 - gesture * 0.1
      }
      if (foreR.current) {
        foreR.current.rotation.x = -0.28 - gesture * 0.35
        foreR.current.rotation.z = Math.sin(t * 3) * 0.04 * gesture
      }
      // Left forearm rests forward as if holding a welcome tablet.
      if (armL.current) armL.current.rotation.x = -0.16
      if (foreL.current) foreL.current.rotation.x = -0.7
    } else {
      // Teller stands at the counter with both hands resting over the worktop.
      if (armR.current) { armR.current.rotation.x = -0.35; armR.current.rotation.z = -0.05 }
      if (foreR.current) foreR.current.rotation.x = -0.45
      if (armL.current) { armL.current.rotation.x = -0.35; armL.current.rotation.z = 0.05 }
      if (foreL.current) { foreL.current.rotation.x = -0.45 }
    }
  })

  return (
    <group
      position={position}
      rotation={[0, rotationY, 0]}
      onClick={(e) => { e.stopPropagation(); onTalk?.(variant) }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = '' }}
    >
      <mesh geometry={capGeo(0.32, 1.2)} position={[0, 0.95, 0]} material={pickMat} />
      <Humanoid status="working" seed={seed} sk={sk} role="Front Desk" roomId="lobby" opts={{ service: variant }} />
      {ambient && !hovered && <SocialBubble text={ambient} y={2.44} />}
      {/* The old permanent greeting board crowded the lobby; a small prompt appears only on hover. */}
      {hovered && (
        <Billboard position={[0, 1.98, 0]}>
          <mesh position={[0, 0, -0.006]}>
            <planeGeometry args={[0.86, 0.2]} />
            <meshBasicMaterial color="#18343f" transparent opacity={0.9} depthWrite={false} />
          </mesh>
          <Text fontSize={0.075} color="#e8f3f4" anchorX="center" anchorY="middle" maxWidth={0.8} textAlign="center">
            {variant === 'greeter' ? 'Tanya resepsionis' : 'Tanya teller'}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

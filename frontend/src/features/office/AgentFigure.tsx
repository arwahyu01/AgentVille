import { useEffect, useMemo, useState, useRef } from 'react'
import { MeshBasicMaterial } from 'three'
import type { Group, Material, Mesh, MeshBasicMaterial as MBM } from 'three'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import { activityLine, poseFor, pulseAge, routeTo } from '../../lib/activity'
import { OPERATIONAL_ROLES, figureAt, roomAt, roomById, seatAt, stationInRoom } from '../../lib/officeLayout'
import { C, EARRING, HAIR, LASH, ROLE_SHIRT, SERVICE, SHIRT, SKIN, STATUS_DOT, TELLER_VEST, TROUSERS, UNIFORM } from './palette'
import { boxGeo, capGeo, cylGeo, mat, sphGeo } from './primitives'
import { SocialBubble } from './SocialBubble'
import {
  activeSocialLine, prefersReducedMotion, socialRoute,
  type CueMap, type SocialCue, type SocialLine,
} from './socialScript'
import type { Agent, AgentStatus } from '../../types'
import type { StreamEvent } from '../../types'

/** Mutable ref slot, written structurally so it matches `useRef` across React type versions. */
type Sink<T> = { current: T | null }

export interface Skeleton {
  body: Sink<Group>
  head: Sink<Group>
  armL: Sink<Group>
  armR: Sink<Group>
  foreL: Sink<Group>
  foreR: Sink<Group>
  thighL: Sink<Group>
  thighR: Sink<Group>
  shinL: Sink<Group>
  shinR: Sink<Group>
}

const SHOULDER = 1.36
const HIP = 0.9
const SIT_DROP = 0.4
const SEAT_BEND = 1.52

const shoeMat = mat('#2e333a', { rough: 0.7 })
const sockMat = mat('#e7e4dc', { rough: 0.9 })
const beltMat = mat('#4a4038', { rough: 0.6 })
const eyeMat = mat('#2b3038', { rough: 0.35 })
const eyeWhiteMat = mat('#f6f3ec', { rough: 0.3 })
const browMat = mat('#3a2f28', { rough: 0.85 })
const blushMat = mat('#d99b86', { rough: 0.8, opacity: 0.5 })
const lensMat = mat('#cfe3e8', { rough: 0.06, metal: 0.05, opacity: 0.4 })
const frameMat = mat('#39424b', { rough: 0.4, metal: 0.35 })
const badgeMat = mat('#f0e6cf', { rough: 0.55 })
const mopHandleMat = mat(C.oakDark, { rough: 0.7 })
const mopHeadMat = mat(C.fabricDark, { rough: 0.9 })

/** Invisible-but-pickable shell: as the fitout grows, an agent must stay a comfortable click
 * target without thin limbs having to win the raycast. */
const pickMat: Material = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })

/** How one person looks: skin, hair, clothes and small identity details, all derived from the
 * agent's own id, role and the room the backend actually stationed it in. Nothing here is random
 * per frame — a figure keeps the same face, hair and shirt for the whole session. */
interface Look {
  skin: Material
  hair: Material
  shirt: Material
  trousers: Material
  vest: Material | null
  vestTrim: Material | null
  blazer: Material | null
  blazerTrim: Material | null
  skirt: Material | null
  tights: Material | null
  heels: Material | null
  cap: Material | null
  hairStyle: number
  longHair: boolean
  glasses: boolean
  beard: boolean
  tie: Material | null
  feminine: boolean
  earrings: boolean
  lashes: boolean
  lip: Material
  height: number
}

/** Extra looks for fit-out staff (greeter/teller) that are not backend agents. */
export interface LookOpts {
  feminine?: boolean
  service?: 'greeter' | 'teller'
}

export function lookFor(
  status: AgentStatus, seed: number, role: string, roomId: string, opts: LookOpts = {},
): Look {
  const uniform = UNIFORM[role as keyof typeof UNIFORM]
  const svc = opts.service ? SERVICE[opts.service] : null
  const feminine = !!opts.feminine || !!svc
  const shirt = svc ? svc.blouse : uniform ? uniform.shirt : (ROLE_SHIRT[role] ?? SHIRT[status])
  // A vest is worn by whoever the backend put behind a service desk, never by a fixed id.
  const teller = !uniform && roomId === 'cs'
  return {
    skin: mat(SKIN[seed % SKIN.length], { rough: 0.78 }),
    hair: mat(HAIR[(seed * 2 + role.length) % HAIR.length], { rough: 0.9 }),
    shirt: mat(shirt, { rough: 0.78 }),
    trousers: mat(svc ? svc.skirt : TROUSERS[seed % TROUSERS.length], { rough: 0.85 }),
    vest: teller ? mat(TELLER_VEST.body, { rough: 0.7 }) : null,
    vestTrim: teller ? mat(TELLER_VEST.trim, { rough: 0.6 }) : null,
    blazer: svc ? mat(svc.blazer, { rough: 0.66 }) : null,
    blazerTrim: svc ? mat(svc.trim, { rough: 0.6 }) : null,
    skirt: svc ? mat(svc.skirt, { rough: 0.8 }) : null,
    tights: svc ? mat(svc.tights, { rough: 0.7 }) : null,
    heels: svc ? mat(svc.heels, { rough: 0.5 }) : null,
    cap: uniform ? mat(uniform.cap, { rough: 0.85 }) : null,
    hairStyle: feminine ? 5 : (seed + role.length) % 5,
    longHair: feminine,
    glasses: !feminine && (seed + role.length) % 3 === 0,
    beard: !feminine && seed % 4 === 1,
    tie: !uniform && !feminine && (seed + role.length) % 4 === 2 ? mat('#8a3f4a', { rough: 0.6 }) : null,
    feminine,
    earrings: feminine,
    lashes: feminine,
    lip: mat(feminine ? '#b25a63' : '#bd7f6c', { rough: 0.7 }),
    height: feminine ? 0 : ((seed % 3) - 1) * 0.04,
  }
}

/** Local darkening for a paired garment colour (the lower trouser leg), kept deterministic. */
function shadeDown(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => {
    const v = (n >> shift) & 255
    return Math.max(0, Math.round(v * (1 - amount)))
  }
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

const trouserDark = (seed: number) => mat(shadeDown(TROUSERS[seed % TROUSERS.length], 0.16), { rough: 0.85 })

/** Cartoon office worker, ~1.72 m, built facing +z: shaped torso, tapered limbs, jointed hands
 * and a real face. Every part is shared cached geometry, so a dozen figures stay cheap, and the
 * joints are real pivot groups, which means a seated pose is a few rotations instead of a second
 * model. `opts.feminine`/`service` give the front-of-house staff a tailored blazer, skirt and
 * heels; backend agents keep their own deterministic look. */
export function Humanoid({ status, seed, sk, role, roomId, opts }: {
  status: AgentStatus; seed: number; sk: Skeleton; role: string; roomId: string; opts?: LookOpts
}) {
  const look = lookFor(status, seed, role, roomId, opts)
  const {
    skin: flesh, hair, shirt, trousers, vest, vestTrim, blazer, blazerTrim,
    skirt, tights, heels, cap: capMat, tie, feminine: fem, lip,
  } = look
  const headY = 1.5 + look.height
  const chestR = fem ? 0.166 : 0.19
  const waistR = fem ? 0.12 : 0.15
  const hipR = fem ? 0.172 : 0.163
  const white = mat('#f6f3ec', { rough: 0.8 })
  const gold = mat(EARRING, { rough: 0.3, metal: 0.8 })

  return (
    <group ref={sk.body}>
      {/* Hips, waist and chest: an hourglass taper rather than a stack of cubes. */}
      <mesh geometry={cylGeo(waistR, hipR, 0.2, 16)} position={[0, 0.99, 0]} scale={[1, 1, 0.82]} material={skirt ?? trousers} castShadow />
      <mesh geometry={boxGeo(waistR * 1.9, 0.045, waistR * 1.35)} position={[0, 1.1, 0]} material={beltMat} />
      <mesh geometry={cylGeo(chestR, waistR, 0.24, 16)} position={[0, 1.22, 0]} scale={[1, 1, 0.78]} material={shirt} castShadow />
      {fem && (
        <>
          <mesh geometry={sphGeo(0.07, 12)} position={[-0.062, 1.27, 0.055]} scale={[1, 0.78, 0.62]} material={shirt} />
          <mesh geometry={sphGeo(0.07, 12)} position={[0.062, 1.27, 0.055]} scale={[1, 0.78, 0.62]} material={shirt} />
        </>
      )}
      {/* Shoulders as rounded caps, so the arms grow out of the body instead of a flat box. */}
      <mesh geometry={sphGeo(0.086, 14)} position={[-0.15, 1.345, 0]} scale={[1, 0.8, 0.92]} material={shirt} castShadow />
      <mesh geometry={sphGeo(0.086, 14)} position={[0.15, 1.345, 0]} scale={[1, 0.8, 0.92]} material={shirt} castShadow />

      {/* Collar: folded points + placket for a shirt; a soft V-neck + necklace for a blouse. */}
      {fem ? (
        <>
          <mesh geometry={cylGeo(0.066, 0.072, 0.03, 16)} position={[0, 1.385, 0.008]} scale={[1, 1, 0.9]} material={white} />
          {([-0.026, 0, 0.026] as const).map((x) => (
            <mesh key={`chain${x}`} geometry={sphGeo(x === 0 ? 0.009 : 0.007, 8)} position={[x, 1.334 - Math.abs(x) * 0.22, 0.093]} material={gold} />
          ))}
        </>
      ) : (
        <>
          <mesh geometry={boxGeo(0.055, 0.075, 0.02)} position={[-0.05, 1.38, 0.098]} rotation={[0.25, 0, 0.5]} material={white} />
          <mesh geometry={boxGeo(0.055, 0.075, 0.02)} position={[0.05, 1.38, 0.098]} rotation={[0.25, 0, -0.5]} material={white} />
          <mesh geometry={boxGeo(0.02, 0.22, 0.012)} position={[0, 1.27, 0.132]} material={mat('#eae6dd', { rough: 0.85 })} />
          {tie && <mesh geometry={boxGeo(0.045, 0.2, 0.016)} position={[0, 1.2, 0.14]} rotation={[0.06, 0, 0]} material={tie} />}
        </>
      )}

      {/* Teller vest for backend-stationed CS, or a tailored front-of-house blazer. */}
      {vest && vestTrim && (
        <>
          <mesh geometry={boxGeo(0.12, 0.34, 0.17)} position={[-0.09, 1.24, 0]} material={vest} castShadow />
          <mesh geometry={boxGeo(0.12, 0.34, 0.17)} position={[0.09, 1.24, 0]} material={vest} castShadow />
          <mesh geometry={boxGeo(0.02, 0.34, 0.03)} position={[0, 1.24, 0.105]} material={vestTrim} />
          <mesh geometry={boxGeo(0.07, 0.045, 0.012)} position={[-0.09, 1.33, 0.093]} material={badgeMat} />
        </>
      )}
      {blazer && blazerTrim && (
        <>
          <mesh geometry={boxGeo(0.11, 0.4, 0.19)} position={[-0.098, 1.21, 0.005]} rotation={[0, 0, 0.03]} material={blazer} castShadow />
          <mesh geometry={boxGeo(0.11, 0.4, 0.19)} position={[0.098, 1.21, 0.005]} rotation={[0, 0, -0.03]} material={blazer} castShadow />
          {/* Tailored lapels in the blazer cloth, edged with a narrow cream piping. */}
          <mesh geometry={boxGeo(0.05, 0.2, 0.016)} position={[-0.06, 1.3, 0.101]} rotation={[0.04, 0.1, 0.28]} material={blazer} castShadow />
          <mesh geometry={boxGeo(0.05, 0.2, 0.016)} position={[0.06, 1.3, 0.101]} rotation={[0.04, -0.1, -0.28]} material={blazer} castShadow />
          <mesh geometry={boxGeo(0.012, 0.2, 0.012)} position={[-0.044, 1.3, 0.11]} rotation={[0.04, 0.1, 0.28]} material={blazerTrim} />
          <mesh geometry={boxGeo(0.012, 0.2, 0.012)} position={[0.044, 1.3, 0.11]} rotation={[0.04, -0.1, -0.28]} material={blazerTrim} />
          <mesh geometry={cylGeo(0.011, 0.011, 0.006, 8)} position={[0, 1.15, 0.118]} rotation={[Math.PI / 2, 0, 0]} material={gold} />
          <mesh geometry={boxGeo(0.05, 0.028, 0.012)} position={[0.1, 1.35, 0.1]} material={badgeMat} />
        </>
      )}
      <mesh geometry={cylGeo(0.043, 0.05, 0.1, 12)} position={[0, 1.45, 0]} material={flesh} />

      <group ref={sk.head} position={[0, headY, 0]}>
        <mesh geometry={sphGeo(0.114, 18)} position={[0, 0.11, 0]} scale={[1, 1.04, 0.97]} material={flesh} castShadow />
        {/* Jaw and chin round off the skull so the head is not a ball on a stick. */}
        <mesh geometry={sphGeo(0.016, 10)} position={[0, 0.05, 0.045]} scale={[2.9, 1.9, 2.4]} material={flesh} />
        <mesh geometry={sphGeo(0.021, 10)} position={[0.112, 0.1, 0.004]} scale={[0.62, 1, 0.7]} material={flesh} />
        <mesh geometry={sphGeo(0.021, 10)} position={[-0.112, 0.1, 0.004]} scale={[0.62, 1, 0.7]} material={flesh} />
        {look.earrings && ([-1, 1] as const).map((s) => (
          <mesh key={s} geometry={sphGeo(0.012, 8)} position={[s * 0.122, 0.06, 0.006]} material={gold} />
        ))}
        {/* Eyes: white, iris, pupil, and a lash line for the front-of-house look. */}
        {([-0.046, 0.046] as const).map((x) => (
          <group key={x}>
            <mesh geometry={sphGeo(0.027, 12)} position={[x, 0.128, 0.096]} scale={[1, 0.92, 0.7]} material={eyeWhiteMat} />
            <mesh geometry={sphGeo(0.0135, 10)} position={[x, 0.128, 0.113]} material={eyeMat} />
            <mesh geometry={sphGeo(0.006, 8)} position={[x, 0.129, 0.124]} material={mat('#0d0f12', { rough: 0.2 })} />
            {look.lashes && (
              <>
                <mesh geometry={boxGeo(0.05, 0.006, 0.009)} position={[x, 0.148, 0.106]} rotation={[0, 0, x > 0 ? -0.16 : 0.16]} material={mat(LASH, { rough: 0.5 })} />
                <mesh geometry={boxGeo(0.017, 0.005, 0.008)} position={[x + 0.028, 0.144, 0.104]} rotation={[0, 0, x > 0 ? -0.55 : 0.4]} material={mat(LASH, { rough: 0.5 })} />
                <mesh geometry={boxGeo(0.017, 0.005, 0.008)} position={[x - 0.028, 0.144, 0.104]} rotation={[0, 0, x > 0 ? -0.4 : 0.55]} material={mat(LASH, { rough: 0.5 })} />
              </>
            )}
          </group>
        ))}
        {([-0.046, 0.046] as const).map((x) => (
          <mesh key={`brow${x}`} geometry={boxGeo(0.05, 0.012, 0.014)} position={[x, 0.164, 0.1]} rotation={[0, 0, x > 0 ? -0.12 : 0.12]} material={browMat} />
        ))}
        {/* Nose: bridge, tip and two nostril shadows. */}
        <mesh geometry={sphGeo(0.03, 10)} position={[0, 0.118, 0.098]} scale={[0.55, 0.9, 0.7]} material={flesh} />
        <mesh geometry={sphGeo(0.028, 10)} position={[0, 0.104, 0.108]} scale={[0.85, 0.7, 0.9]} material={flesh} />
        {([-0.012, 0.012] as const).map((x) => (
          <mesh key={`nost${x}`} geometry={sphGeo(0.006, 6)} position={[x, 0.096, 0.112]} material={mat('#8f6752', { rough: 0.8 })} />
        ))}
        {/* Upper and lower lip, so the mouth reads as a mouth, not a slot. */}
        <mesh geometry={sphGeo(0.03, 10)} position={[0, 0.05, 0.104]} scale={[1.05, 0.4, 0.6]} material={lip} />
        <mesh geometry={sphGeo(0.026, 10)} position={[0, 0.038, 0.103]} scale={[0.95, 0.34, 0.55]} material={lip} />
        {([-0.082, 0.082] as const).map((x) => (
          <mesh key={`blush${x}`} geometry={sphGeo(0.022, 8)} position={[x, 0.076, 0.086]} scale={[1, 0.62, 0.4]} material={blushMat} />
        ))}
        <Hair style={look.hairStyle} material={hair} beard={look.beard} long={look.longHair} />
        {look.glasses && (
          <>
            <mesh geometry={boxGeo(0.062, 0.05, 0.012)} position={[-0.046, 0.128, 0.116]} material={lensMat} />
            <mesh geometry={boxGeo(0.062, 0.05, 0.012)} position={[0.046, 0.128, 0.116]} material={lensMat} />
            <mesh geometry={boxGeo(0.03, 0.008, 0.01)} position={[0, 0.128, 0.118]} material={frameMat} />
            {([-0.094, 0.094] as const).map((x) => (
              <mesh key={`arm${x}`} geometry={boxGeo(0.062, 0.009, 0.01)} position={[x, 0.132, 0.086]} rotation={[0, x > 0 ? -0.5 : 0.5, 0]} material={frameMat} />
            ))}
          </>
        )}
        {capMat && (
          <>
            <mesh geometry={sphGeo(0.128, 14)} position={[0, 0.118, -0.012]} scale={[1, 0.62, 1]} material={capMat} />
            <mesh geometry={boxGeo(0.17, 0.018, 0.075)} position={[0, 0.168, 0.105]} material={capMat} />
          </>
        )}
      </group>

      {/* Arms: a tapered upper arm, a rounded deltoid and a slim forearm. */}
      {([[-1, sk.armL, sk.foreL], [1, sk.armR, sk.foreR]] as const).map(([side, arm, fore]) => (
        <group key={side} ref={arm} position={[side * 0.195, SHOULDER, 0]}>
          <mesh geometry={sphGeo(0.056, 12)} position={[0, -0.01, 0]} material={shirt} castShadow />
          <mesh geometry={cylGeo(0.055, 0.042, 0.25, 12)} position={[0, -0.135, 0]} material={shirt} castShadow />
          {/* Rolled cuff marks the sleeve end, so the forearm reads as skin, not a bare tube. */}
          <mesh geometry={boxGeo(0.112, 0.03, 0.108)} position={[0, -0.247, 0]} material={mat('#eceae3', { rough: 0.85 })} />
          <group ref={fore} position={[0, -0.26, 0]}>
            <mesh geometry={cylGeo(0.042, 0.031, 0.2, 12)} position={[0, -0.105, 0]} material={flesh} castShadow />
            {/* Hand: palm plus a thumb and a finger split, so a hand on a keyboard is legible. */}
            <mesh geometry={boxGeo(0.058, 0.072, 0.046)} position={[0, -0.218, 0.01]} material={flesh} />
            <mesh geometry={boxGeo(0.018, 0.03, 0.02)} position={[side * -0.036, -0.208, 0.028]} material={flesh} />
            <mesh geometry={boxGeo(0.052, 0.03, 0.038)} position={[0, -0.255, 0.014]} material={flesh} />
          </group>
        </group>
      ))}

      {/* Legs: tapered thigh and calf; tights + heels for the service staff, slacks otherwise. */}
      {([[-1, sk.thighL, sk.shinL], [1, sk.thighR, sk.shinR]] as const).map(([side, thigh, shin]) => (
        <group key={side} ref={thigh} position={[side * 0.088, HIP, 0]}>
          <mesh geometry={cylGeo(0.076, 0.054, 0.4, 12)} position={[0, -0.2, 0]} material={fem && tights ? tights : trousers} castShadow />
          <group ref={shin} position={[0, -0.42, 0]}>
            <mesh geometry={cylGeo(0.054, 0.036, 0.34, 12)} position={[0, -0.18, 0]} material={fem && tights ? tights : trouserDark(seed)} castShadow />
            {fem && heels ? (
              <>
                <mesh geometry={boxGeo(0.088, 0.05, 0.21)} position={[0, -0.385, 0.045]} material={heels} castShadow />
                <mesh geometry={boxGeo(0.03, 0.075, 0.032)} position={[0, -0.415, -0.045]} material={heels} castShadow />
                <mesh geometry={boxGeo(0.09, 0.012, 0.14)} position={[0, -0.36, 0.06]} material={mat('#8f6a4e', { rough: 0.6 })} />
              </>
            ) : (
              <>
                <mesh geometry={cylGeo(0.055, 0.056, 0.06, 10)} position={[0, -0.32, 0]} material={sockMat} />
                <mesh geometry={boxGeo(0.105, 0.058, 0.23)} position={[0, -0.4, 0.055]} material={shoeMat} castShadow />
                <mesh geometry={boxGeo(0.108, 0.016, 0.05)} position={[0, -0.404, -0.05]} material={mat('#1f242a', { rough: 0.8 })} />
              </>
            )}
          </group>
        </group>
      ))}

      {/* Pencil skirt: a slight taper from the hips to the hem, so the lower legs show below. */}
      {skirt && (
        <mesh geometry={cylGeo(0.176, 0.152, 0.44, 18)} position={[0, 0.81, 0]} scale={[1, 1, 0.88]} material={skirt} castShadow />
      )}
    </group>
  )
}

/** Five short hairstyles plus a long style for front-of-house staff, enough that a team never
 *  looks cloned. All shells sit slightly proud of the skull and are pushed back so the eyes stay
 *  readable from the isometric camera. */
function Hair({ style, material, beard, long }: { style: number; material: Material; beard: boolean; long?: boolean }) {
  if (long) {
    return (
      <group>
        {/* Crown, a back panel that reaches the shoulders and locks framing the face. */}
        <mesh geometry={sphGeo(0.121, 16)} position={[0, 0.133, -0.026]} scale={[1, 0.94, 1]} material={material} castShadow />
        <mesh geometry={sphGeo(0.11, 14)} position={[0, 0.0, -0.082]} scale={[1.02, 1.55, 0.62]} material={material} castShadow />
        <mesh geometry={cylGeo(0.052, 0.032, 0.3, 8)} position={[-0.107, -0.012, 0.004]} rotation={[0, 0, 0.07]} scale={[0.8, 1, 1.6]} material={material} />
        <mesh geometry={cylGeo(0.052, 0.032, 0.3, 8)} position={[0.107, -0.012, 0.004]} rotation={[0, 0, -0.07]} scale={[0.8, 1, 1.6]} material={material} />
        <mesh geometry={boxGeo(0.2, 0.05, 0.08)} position={[0, 0.197, 0.05]} rotation={[0, 0.1, 0.05]} material={material} />
      </group>
    )
  }
  return (
    <group>
      {style !== 4 && (
        <mesh geometry={sphGeo(0.121, 16)} position={[0, 0.133, -0.026]} scale={[1, 0.94, 1]} material={material} castShadow />
      )}
      {style === 0 && <mesh geometry={boxGeo(0.19, 0.032, 0.06)} position={[0, 0.198, 0.068]} material={material} />}
      {style === 1 && (
        <>
          <mesh geometry={boxGeo(0.2, 0.045, 0.09)} position={[-0.012, 0.196, 0.05]} rotation={[0, 0.12, 0.06]} material={material} />
          <mesh geometry={boxGeo(0.05, 0.14, 0.05)} position={[0.1, 0.13, -0.05]} material={material} />
        </>
      )}
      {style === 2 && <mesh geometry={sphGeo(0.062, 12)} position={[0, 0.15, -0.13]} scale={[1, 1, 0.8]} material={material} />}
      {style === 3 && (
        <>
          <mesh geometry={boxGeo(0.22, 0.26, 0.1)} position={[0, 0.03, -0.088]} material={material} />
          <mesh geometry={boxGeo(0.185, 0.03, 0.075)} position={[0, 0.196, 0.062]} material={material} />
        </>
      )}
      {style === 4 && <mesh geometry={sphGeo(0.122, 14)} position={[0, 0.128, -0.07]} scale={[0.92, 0.5, 0.7]} material={material} />}
      {beard && <mesh geometry={sphGeo(0.1, 12)} position={[0, 0.036, 0.03]} scale={[0.92, 0.62, 0.92]} material={material} />}
    </group>
  )
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** One agent in the scene. Position comes entirely from backend state projected through
 * `poseFor`: a figure only leaves its station when an assignment/handoff/meeting event set
 * `target_room`, and only idles in place when nothing moved it. */
export function AgentFigure({ agent, slot, selected, onSelect, event, social }: {
  agent: Agent
  slot: number
  selected: boolean
  onSelect: () => void
  event?: StreamEvent
  social?: SocialCue
}) {
  const root = useRef<Group>(null)
  const ring = useRef<Mesh>(null)
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
  const mop = useRef<Group>(null)
  const sk: Skeleton = { body, head, armL, armR, foreL, foreR, thighL, thighR, shinL, shinR }

  const pose = poseFor(agent)
  const baseTarget = pose.targetRoom ?? pose.homeRoom
  const staff = OPERATIONAL_ROLES.has(agent.role)
  // Staff never take over a colleague's chair: they stand at the station anchor and play their
  // own task animation (patrol scan / mopping) instead of typing.
  const baseSeat = staff ? { ...seatAt(baseTarget, slot), seated: false } : seatAt(baseTarget, slot)
  const baseGoal: [number, number] = staff
    ? [figureAt(baseTarget, slot).x, figureAt(baseTarget, slot).z]
    : [baseSeat.x, baseSeat.z]
  const baseKey = `${baseTarget.id}:${stationInRoom(baseTarget, slot).join(',')}:${baseSeat.seated ? 1 : 0}`

  // A social cue overrides only the visual goal. The base pose above still comes from backend
  // state, so dropping the cue sends the figure straight back to its real desk.
  const socialTarget = social ? roomById(social.roomId) : null
  const target = socialTarget ?? baseTarget
  const faceDx = social ? social.faceTarget[0] - social.destination[0] : 0
  const faceDz = social ? social.faceTarget[1] - social.destination[1] : 0
  const socialFacing = social && Math.hypot(faceDx, faceDz) > 0.05
    ? Math.atan2(faceDx, faceDz)
    : baseSeat.facing
  const seat = social
    ? { x: social.destination[0], z: social.destination[1], facing: socialFacing, seated: social.seated }
    : baseSeat
  const goal: [number, number] = social ? [seat.x, seat.z] : baseGoal
  const goalKey = social
    ? `social:${social.id}:${social.role}:${seat.x.toFixed(2)},${seat.z.toFixed(2)}:${seat.seated ? 1 : 0}`
    : baseKey
  const seed = Math.abs(agent.id)
  const reducedMotion = useMemo(prefersReducedMotion, [])
  const [socialLine, setSocialLine] = useState<SocialLine | null>(null)

  useEffect(() => {
    if (!social) { setSocialLine(null); return }
    const update = () => setSocialLine(activeSocialLine(social, agent.id, Date.now()))
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [social, agent.id])

  // Animated state lives in one mutable record so useFrame never allocates per frame.
  const state = useRef({
    x: baseSeat.x,
    z: baseSeat.z,
    facing: baseSeat.facing,
    route: [] as [number, number][],
    key: baseKey,
    phase: seed * 1.7,
    sit: baseSeat.seated && pose.kind !== 'travel' ? 1 : 0,
    arrived: true,
  })

  useFrame((_, delta) => {
    const a = state.current
    // A new route is rebuilt only when a real backend event or a social cue changed the goal.
    if (a.key !== goalKey) {
      a.route = social
        ? socialRoute(roomAt(a.x, a.z), target, goal, [a.x, a.z])
        : routeTo(roomAt(a.x, a.z), target, goal, [a.x, a.z])
      a.key = goalKey
    }
    const dt = Math.min(delta, 0.05)
    let moving = false
    if (a.route.length > 0) {
      const [wx, wz] = a.route[0]
      const dx = wx - a.x
      const dz = wz - a.z
      const dist = Math.hypot(dx, dz)
      moving = true
      if (dist < 0.07) a.route.shift()
      else {
        const step = Math.min(2.0 * dt, dist)
        a.x += (dx / dist) * step
        a.z += (dz / dist) * step
        a.facing = Math.atan2(dx, dz)
      }
    } else {
      const err = Math.hypot(goal[0] - a.x, goal[1] - a.z)
      a.x = lerp(a.x, goal[0], clamp01(dt * 5))
      a.z = lerp(a.z, goal[1], clamp01(dt * 5))
      moving = err > 0.04
    }
    // Sit only once parked at a station that has a chair; mid-trip the figure stays upright.
    a.arrived = !moving
    a.sit = lerp(a.sit, seat.seated && a.arrived ? 1 : 0, clamp01(dt * 4))
    a.phase += (moving ? 8.5 : social ? 1.6 : pose.kind === 'work' ? 4.6 : 1.1) * dt
    if (!moving) a.facing = lerp(a.facing, seat.facing, clamp01(dt * 3))

    if (root.current) {
      root.current.position.set(a.x, 0, a.z)
      root.current.rotation.y = a.facing
    }
    const sit = a.sit
    // Keystrokes are the only fast motion in the scene, and they require a working status.
    const typing = !social && pose.kind === 'work' && sit > 0.6 && agent.status === 'working'
    // Housekeeping reads as mopping only while a real event has it working at a zone; idle staff
    // just stand down at their post.
    const cleaning = !social && staff && agent.role === 'Housekeeping'
      && pose.kind === 'work' && !moving && agent.status === 'working'
    if (body.current) {
      const bob = moving ? Math.abs(Math.sin(a.phase)) * 0.045 : Math.sin(a.phase * 0.5) * 0.008
      body.current.position.y = -SIT_DROP * sit + bob
      // A seated worker leans from the ankles toward the keyboard; the lean is what closes the
      // last few centimetres between the chair and the desk without stretching the arms.
      body.current.rotation.x = sit * (typing ? 0.12 : 0.08)
      body.current.rotation.z = moving ? Math.sin(a.phase) * 0.025 : 0
    }
    const swing = moving ? Math.sin(a.phase) * 0.55 : 0
    const knee = moving ? Math.max(0, -Math.sin(a.phase)) * 0.5 : 0
    if (thighL.current) thighL.current.rotation.x = -SEAT_BEND * sit + swing
    if (thighR.current) thighR.current.rotation.x = -SEAT_BEND * sit - swing
    if (shinL.current) shinL.current.rotation.x = SEAT_BEND * sit + knee
    if (shinR.current) shinR.current.rotation.x = SEAT_BEND * sit + knee
    // Hands rest on the keyboard whenever the figure is seated: the old -0.58/-0.2 pose left
    // them ~0.35 m short of the keys and ~0.18 m below the desk top.
    const upper = lerp(-0.06, typing ? -1.0 : -0.95, sit)
    const elbow = lerp(-0.12, typing ? -0.5 : -0.45, sit)
    const jitter = typing ? Math.sin(a.phase * 3.1) * 0.035 : 0
    if (armL.current) { armL.current.rotation.x = upper - (moving ? swing * 0.8 : 0); armL.current.rotation.z = 0 }
    if (armR.current) { armR.current.rotation.x = upper + (moving ? swing * 0.8 : 0); armR.current.rotation.z = 0 }
    if (foreL.current) foreL.current.rotation.x = elbow + jitter
    if (foreR.current) foreR.current.rotation.x = elbow - jitter
    if (foreL.current) foreL.current.rotation.z = 0
    if (foreR.current) foreR.current.rotation.z = 0
    if (cleaning) {
      // Both hands are brought onto the handle — right high, left a little lower — with a small
      // alternating push, so the mop head is the thing that moves and the grip stays believable.
      const sw = Math.sin(a.phase * 1.1)
      if (armR.current) { armR.current.rotation.x = -0.6 + sw * 0.1; armR.current.rotation.z = -0.42 }
      if (foreR.current) foreR.current.rotation.x = -0.18
      if (armL.current) { armL.current.rotation.x = -0.46 - sw * 0.08; armL.current.rotation.z = 0.45 }
      if (foreL.current) foreL.current.rotation.x = -0.16
    }
    if (mop.current) {
      mop.current.visible = cleaning
      if (cleaning) mop.current.rotation.y = Math.sin(a.phase * 1.1) * 0.06
    }
    if (head.current) {
      // Resting figures glance around; working ones hold their gaze on the screen; a standing
      // worker is staff on duty, so they scan the room instead.
      head.current.rotation.y = sit > 0.5
        ? (typing ? Math.sin(a.phase * 0.6) * 0.05 : Math.sin(a.phase * 0.22) * 0.3)
        : pose.kind === 'work' ? Math.sin(a.phase * 0.25) * 0.5 : 0
      head.current.rotation.x = sit * (typing ? 0.12 : -0.04)
    }
    if (social && !moving) {
      const socialNow = Date.now()
      const speaking = socialLine?.speakerId === agent.id
      if (social.kind === 'greet') {
        if (head.current) head.current.rotation.y = Math.sin(a.phase * 0.3) * 0.12
        if (!reducedMotion) {
          const waving = socialNow < social.talkStart + 1800
          if (waving) {
            if (armR.current) { armR.current.rotation.x = -1.15; armR.current.rotation.z = -0.4 }
            if (foreR.current) {
              foreR.current.rotation.x = -0.25
              foreR.current.rotation.z = Math.sin(a.phase * 6) * 0.28
            }
          } else if (sit > 0.4) {
            if (armL.current) { armL.current.rotation.x = -0.55; armL.current.rotation.z = 0.06 }
            if (foreL.current) foreL.current.rotation.x = -0.45
          }
        }
      } else if (social.kind !== 'wander' && !reducedMotion) {
        if (speaking) {
          if (body.current) body.current.rotation.x = 0.035
          if (armR.current) {
            armR.current.rotation.x = -0.42 + Math.sin(a.phase * 2.2) * 0.12
            armR.current.rotation.z = -0.16
          }
          if (foreR.current) foreR.current.rotation.x = -0.55 + Math.sin(a.phase * 3.1) * 0.16
          if (armL.current) armL.current.rotation.x = -0.2
          if (foreL.current) foreL.current.rotation.x = -0.35
        } else {
          if (armL.current) armL.current.rotation.x = -0.12
          if (armR.current) armR.current.rotation.x = -0.12
          if (foreL.current) foreL.current.rotation.x = -0.3
          if (foreR.current) foreR.current.rotation.x = -0.3
        }
        if (head.current) {
          head.current.rotation.y = Math.sin(a.phase * 0.35) * 0.12
          head.current.rotation.x = socialLine?.tone === 'reply'
            ? 0.04 + Math.sin(a.phase * 3) * 0.05
            : 0
        }
      }
    }
    if (ring.current) {
      // The pulse comes from a real journal event's timestamp — never from random motion, and
      // never while the figure is away from its desk for a local social cue.
      const age = pulseAge(event)
      const fresh = !social && age >= 0 && age < 2.2
      ring.current.visible = fresh
      if (fresh) {
        const p = age / 2.2
        ring.current.scale.setScalar(1 + p * 1.4)
        ;(ring.current.material as MBM).opacity = 0.8 * (1 - p)
      }
    }
  })

  const dot = STATUS_DOT[agent.status]
  const showLine = !social && (selected || (event ? pulseAge(event) < 14 : false))

  return (
    <group ref={root} onClick={(e) => { e.stopPropagation(); onSelect() }}>
      <mesh geometry={capGeo(0.34, 1.15)} position={[0, 0.95, 0]} material={pickMat} />
      <mesh ref={ring} position={[0, 0.022, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.44, 0.54, 28]} />
        <meshBasicMaterial color={dot} transparent opacity={0} />
      </mesh>
      {selected && (
        <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.6, 0.7, 32]} />
          <meshBasicMaterial color={dot} transparent opacity={0.85} />
        </mesh>
      )}
      <Humanoid status={agent.status} seed={seed} sk={sk} role={agent.role} roomId={baseTarget.id} />
      {staff && agent.role === 'Housekeeping' && (
        <group ref={mop} visible={false}>
          {/* The handle runs from the floor head up through both hands (right hand high, left
           * lower), so the grip reads as a real two-handed hold instead of a shaft stuck to a hip. */}
          <mesh geometry={cylGeo(0.016, 0.02, 1.02, 8)} position={[0.02, 0.53, 0.43]} rotation={[-0.25, 0, 0]} material={mopHandleMat} castShadow />
          <mesh geometry={cylGeo(0.03, 0.032, 0.07, 10)} position={[0.02, 0.16, 0.54]} rotation={[-0.25, 0, 0]} material={mopHeadMat} />
          <mesh geometry={boxGeo(0.32, 0.055, 0.16)} position={[0.02, 0.03, 0.56]} material={mopHeadMat} castShadow />
          <mesh geometry={boxGeo(0.3, 0.02, 0.13)} position={[0.02, 0.09, 0.56]} material={mat('#e9e4d9', { rough: 0.9 })} />
        </group>
      )}
      <Billboard position={[0, 1.95, 0]}>
        <Text fontSize={0.17} color="#2f3945" anchorX="center" anchorY="middle" outlineWidth={0.02} outlineColor="#ffffff">
          {agent.name}
        </Text>
        <mesh position={[0, -0.21, 0]}>
          <circleGeometry args={[0.055, 16]} />
          <meshBasicMaterial color={dot} />
        </mesh>
        {showLine && (
          <Text position={[0, -0.4, 0]} fontSize={0.105} color="#4d5865" anchorX="center" anchorY="middle" outlineWidth={0.014} outlineColor="#ffffff" maxWidth={2.8}>
            {activityLine(agent, event)}
          </Text>
        )}
      </Billboard>
      {socialLine && <SocialBubble text={socialLine.text} />}
    </group>
  )
}

/** Glowing puck on the desk of an agent whose last real event parked it at a workstation. An idle
 * agent has no beacon, which is what separates "resting at my desk" from "actually working". */
export function DeskBeacons({ agents, slots, social }: {
  agents: Agent[]
  slots: Record<number, number>
  social?: CueMap
}) {
  const seated = agents.filter((a) => {
    if (social?.[a.id]) return false
    const p = poseFor(a)
    return !OPERATIONAL_ROLES.has(a.role) && !p.targetRoom && p.kind !== 'ambient' && p.homeRoom.kind === 'dept'
  })
  return (
    <>
      {seated.map((a) => {
        const [x, z] = stationInRoom(poseFor(a).homeRoom, slots[a.id] ?? 0)
        const color = STATUS_DOT[a.status]
        // On the desk's corner rather than its centre, so it never hides behind the monitor.
        return (
          <group key={a.id} position={[x + 0.55, 0.755, z]}>
            <mesh geometry={cylGeo(0.07, 0.08, 0.03, 14)} position={[0, 0.015, 0]} material={mat('#c9cdd1', { rough: 0.5, metal: 0.4 })} raycast={() => null} />
            <mesh geometry={sphGeo(0.045, 12)} position={[0, 0.05, 0]} material={mat(color, { rough: 0.4, emissive: color, glow: 0.9 })} raycast={() => null} />
          </group>
        )
      })}
    </>
  )
}

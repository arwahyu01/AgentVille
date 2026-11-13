import type { ReactElement } from 'react'
import { Text } from '@react-three/drei'
import { C } from './palette'
import { CeilingFan } from './Ambience'
import { StaffNpc } from './StaffNpc'
import type { StaffVariant } from './staffScript'
import { Box, Cyl, mat } from './primitives'
import { FLOOR, ROOMS, type Room } from '../../lib/officeLayout'
import {
  AcousticPanel, AreaRug, Armchair, Bench, BistroTable, CoffeeTable, CctvWall, ConferenceChair,
  ConferenceTable, CoolingUnit, CounterRun, Credenza, Desk, DeskProps, Dispenser, FilingCabinet,
  FloorLamp, Fridge, Headset, Keyboard, Microwave, Monitor, OfficeChair, PendantLamp, Plant, Poster, Printer,
  QueueBoard, ReceptionDesk, ServerRack, Shelf, Sofa, StickyBoard, Stool, TableLamp, TrashBin,
  TreePlant, UpperCabinets, WallClock, WallDisplay, WallSign, Whiteboard, Workstation,
} from './Furniture'

type P3 = [number, number, number]

const HALF_PI = Math.PI / 2

/** One rig for every band: chair on +z, monitor on -z, screen toward +z. That is the only
 * orientation where the isometric camera sees both the seated figure and the lit screen. */
const deskRot = () => 0

/**
 * Desk rig contract for rooms whose furniture is placed in world coordinates. The figure's seat
 * anchor comes from officeLayout (`seatOffset` = station + 0.78, facing the desk), so monitor,
 * keyboard and chair are derived from the same numbers. `OfficeChair`'s sitter faces local +z, so
 * the chair is turned to put the backrest behind the figure (toward the camera).
 */
function deskRig() {
  return {
    rot: 0,
    chairZ: (z: number) => z + 0.78,
    chairRot: Math.PI,
    monitorZ: (z: number) => z - 0.2,
    monitorRot: 0,
    keyboardZ: (z: number) => z + 0.2,
    inward: 1,
  }
}

/** z of the exterior wall, and the sign pointing from it into the room. */
const backZ = (r: Room) => (r.band === 'north' ? r.box[1] : r.box[3])
const backIn = (r: Room) => (r.band === 'north' ? 1 : -1)

/**
 * The wall a zone's headline feature (screen, board, signage) hangs on. North-band rooms use their
 * exterior wall; south-band rooms use the side wall furthest from the corridor axis. Both choices
 * face into the room *and* toward the isometric camera — mounting a screen on the south facade
 * would leave it facing away from the default view.
 */
function featureWall(r: Room) {
  if (r.band === 'north') {
    const z = r.box[1] + 0.2
    return { mount: (offset: number, y: number): P3 => [r.center[0] + offset, y, z], rotY: 0 }
  }
  const east = r.center[0] > 0
  const x = east ? r.box[2] - 0.2 : r.box[0] + 0.2
  return {
    mount: (offset: number, y: number): P3 => [x, y, r.center[1] + offset * (east ? 1 : -1)],
    rotY: east ? -HALF_PI : HALF_PI,
  }
}

/** South-band departments label the corridor-facing glass: their exterior wall faces away from
 * the camera, and a side-wall label is too foreshortened to read from the default view. */
function labelMount(room: Room, offset: number, y: number): { position: P3; rotY: number } {
  if (room.band === 'south' && room.kind === 'dept') {
    // Corridor face of the glazing, not behind it: a label 10 cm inside the room is washed out
    // by the glass and sliced by the mullions from the default camera.
    return { position: [room.center[0] + offset, y, room.box[1] - 0.15], rotY: 0 }
  }
  const fw = featureWall(room)
  return { position: fw.mount(offset, y), rotY: fw.rotY }
}

function WallLabel({ room, offset, y, text, size, color = '#2f3945' }: {
  room: Room; offset: number; y: number; text: string; size?: number; color?: string
}) {
  const southGlass = room.band === 'south' && room.kind === 'dept'
  const mount = labelMount(room, offset, southGlass ? 2.36 : y)
  if (southGlass) {
    // A frosted plate on the corridor face: the room behind is too bright for bare text to hold
    // contrast at 25 m, and a plate also stops the mullions from slicing the words. It stands
    // 12 cm proud of the glazing so the door frame cannot z-fight with it.
    return (
      <group position={mount.position} rotation={[0, mount.rotY, 0]}>
        <Box size={[1.7, 0.32, 0.03]} at={[0, 0, -0.02]} m={mat('#f7f4ee', { rough: 0.62 })} cast />
        <Box size={[1.7, 0.035, 0.032]} at={[0, -0.16, -0.02]} m={mat(room.accent, { rough: 0.6 })} />
        <Text
          position={[0, 0.01, 0.002]}
          fontSize={size ?? 0.2}
          color={color}
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.12}
        >
          {text}
        </Text>
      </group>
    )
  }
  return (
    <Text
      position={mount.position}
      rotation={[0, mount.rotY, 0]}
      fontSize={size ?? 0.18}
      color={color}
      anchorX="center"
      anchorY="middle"
      letterSpacing={0.1}
      outlineWidth={0.01}
      outlineColor="#f7f3ea"
    >
      {text}
    </Text>
  )
}

/** ── Development floor ──────────────────────────────────────────────────────── */
function DevFloor({ room, active }: { room: Room; active: boolean }) {
  const fw = featureWall(room)
  const bz = backZ(room) + backIn(room) * 0.14
  const rot = deskRot()
  return (
    <group>
      {room.stations.map(([x, z], i) => (
        <Workstation key={i} position={[x, 0, z]} rotationY={rot} dual={i < 3} accent={i % 2 ? C.oak : C.oakPale} variant={i} />
      ))}
      <Whiteboard position={fw.mount(0.4, 1.55)} rotationY={fw.rotY} w={2.4} />
      <WallLabel room={room} offset={0.4} y={2.4} text="SYSTEM ARCHITECTURE" />
      <Credenza position={[-7.8, 0, bz + 0.2]} w={1.4} />
      <Credenza position={[-2.2, 0, bz + 0.2]} w={1.4} />
      <TableLamp position={[-7.8, 0.7, bz + 0.2]} />
      <Shelf position={[-8.42, 0, -4.2]} rotationY={HALF_PI} w={1.1} h={1.9} levels={4} />
      <Poster position={[-1.52, 1.55, -5.6]} rotationY={-HALF_PI} art={0} accent="#58a89c" />
      <AreaRug position={[-5.0, 0.02, -2.7]} size={[3.6, 1.4]} color="#dfe6e4" />
      <TreePlant position={[-8.05, 0, -2.35]} />
      <Plant position={[-1.85, 0, -2.3]} kind={1} />
      <FloorLamp position={[-8.15, 0, -8.4]} />
      <TrashBin position={[-6.4, 0.17, bz + 0.6]} />
      {active && <AcousticPanel position={[-1.5, 1.4, -4.6]} rotationY={-HALF_PI} w={1.6} h={1.4} color="#dfe7e6" />}
    </group>
  )
}

/** ── Customer service / teller hall (zone 2) ──────────────────────────────────
 * A bank-style counter runs the length of the north wall: three glazed teller windows with a
 * document slot, a teller worktop and stool behind each, and a now-serving board above. The desk
 * stations are the customer-service consultations in the open floor, so a routed agent always has
 * a real seat instead of standing in the queue. */
const TELLER_WINDOWS = [0.5, 2.0, 3.5]

function TellerWindow({ x, index, staffed = false }: { x: number; index: number; staffed?: boolean }) {
  return (
    <group position={[x, 0, 0]}>
      {/* Glazing sits from 1.2 m up so the counter lip stays open as the document slot. */}
      <Box size={[1.15, 0.6, 0.03]} at={[0, 1.5, -7.9]} m={mat('#cfe3e8', { rough: 0.08, opacity: 0.4 })} />
      <Box size={[0.05, 0.92, 0.07]} at={[-0.6, 1.46, -7.9]} m={mat('#59636a', { rough: 0.4, metal: 0.5 })} cast />
      <Box size={[0.05, 0.92, 0.07]} at={[0.6, 1.46, -7.9]} m={mat('#59636a', { rough: 0.4, metal: 0.5 })} cast />
      <Box size={[1.35, 0.07, 0.07]} at={[0, 1.88, -7.9]} m={mat('#59636a', { rough: 0.4, metal: 0.5 })} cast />
      <Box size={[0.22, 0.1, 0.02]} at={[0.44, 0.9, -7.57]} m={mat('#2e4c58', { rough: 0.5 })} />
      <Text position={[0.44, 0.9, -7.555]} fontSize={0.075} color="#eaf6f4" anchorX="center" anchorY="middle">{index + 1}</Text>
      {/* Teller side: worktop, terminal, keyboard and a stool to work the window from.
       * The staffed window keeps the stool out so the teller stands at the counter. The
       * terminal sits off-centre so it never hides the teller from the customer side. */}
      <Box size={[1.05, 0.045, 0.36]} at={[0, 0.72, -8.24]} m={mat('#d9d2c4', { rough: 0.7 })} />
      <Monitor position={[0.32, 0, -8.05]} rotationY={Math.PI} w={0.42} h={0.3} mount={1.05} />
      <Keyboard position={[0.12, 0.745, -8.26]} rotationY={0} />
      {!staffed && <Stool position={[x, 0, -8.62]} color="#9fb3bd" />}
    </group>
  )
}

function ServiceFloor({ room, onStaffTalk }: { room: Room; onStaffTalk?: (variant: StaffVariant) => void }) {
  const fw = featureWall(room)
  const rig = deskRig()
  const counter = mat('#ded6c6', { rough: 0.85 })
  const counterTop = mat('#ece7dc', { rough: 0.55 })
  const steel = mat('#8b9298', { rough: 0.4, metal: 0.55 })
  return (
    <group>
      {/* Counter run: body, overhanging top, kick and a teal front band. */}
      <Box size={[6.1, 0.9, 0.6]} at={[2.0, 0.45, -7.9]} m={counter} cast />
      <Box size={[6.3, 0.06, 0.72]} at={[2.0, 1.02, -7.9]} m={counterTop} cast />
      <Box size={[6.1, 0.1, 0.52]} at={[2.0, 0.05, -7.9]} m={mat('#c9c2b2', { rough: 0.9 })} />
      <Box size={[6.1, 0.11, 0.02]} at={[2.0, 0.86, -7.59]} m={mat(room.accent, { rough: 0.6 })} />
      {TELLER_WINDOWS.map((x, i) => <TellerWindow key={x} x={x} index={i} staffed={i === 0} />)}
      <StaffNpc variant="teller" position={[0.5, 0, -8.55]} seed={1} onTalk={onStaffTalk} />

      {/* Queue lane: stanchions and tape down either side, with floor markers at the head. */}
      {[-0.6, 4.6].map((x) => [-7.0, -5.8, -4.6].map((z) => (
        <group key={`${x}:${z}`} position={[x, 0, z]}>
          <Cyl at={[0, 0.01, 0]} m={steel} rt={0.14} rb={0.15} h={0.02} />
          <Cyl at={[0, 0.48, 0]} m={steel} rt={0.035} rb={0.035} h={0.95} cast />
          <Box size={[0.075, 0.06, 0.075]} at={[0, 0.975, 0]} m={steel} />
        </group>
      )))}
      {[-0.6, 4.6].map((x) => (
        <Box key={x} size={[0.015, 0.03, 2.55]} at={[x, 0.9, -5.8]} m={mat('#c58ba0', { rough: 0.7 })} />
      ))}
      <AreaRug position={[2.0, 0.02, -5.4]} size={[4.6, 4.4]} color="#e2e7ea" />

      {/* Customer-service consultations: the zone's real stations, in the open floor. */}
      {room.stations.map(([x, z], i) => (
        <group key={i}>
          <Desk position={[x, 0, z]} rotationY={rig.rot} w={1.4} top={i % 2 ? '#e8e3d9' : C.oakPale} />
          <Monitor position={[x, 0, rig.monitorZ(z)]} rotationY={rig.monitorRot} mount={1.06} w={0.5} h={0.32} />
          <Keyboard position={[x, 0.755, rig.keyboardZ(z)]} rotationY={rig.rot} />
          <Headset position={[x + 0.42, 0.8, rig.keyboardZ(z)]} />
          <DeskProps position={[x - 0.5, 0.755, rig.keyboardZ(z)]} mug="#7fb0c9" />
          <OfficeChair position={[x, 0, rig.chairZ(z)]} rotationY={rig.chairRot} color="#9fb3bd" />
          {/* Visitor chair on the far side of each consultation desk. */}
          <OfficeChair position={[x, 0, z - 0.72]} rotationY={0} color="#c9cfd4" />
        </group>
      ))}

      <QueueBoard position={fw.mount(0, 1.95)} rotationY={fw.rotY} />
      <WallLabel room={room} offset={0} y={2.52} text="CUSTOMER SERVICE" />
      <Bench position={[4.95, 0, -3.6]} rotationY={HALF_PI} w={1.6} />
      <Dispenser position={[4.9, 0, -2.4]} />
      <Plant position={[-1.0, 0, -2.35]} kind={0} scale={1.1} />
      <TreePlant position={[4.6, 0, -7.4]} />
      <TrashBin position={[-0.9, 0.17, -7.4]} />
    </group>
  )
}

/** ── Server and database room ───────────────────────────────────────────────── */
function ServerRoom({ room, active }: { room: Room; active: boolean }) {
  const bz = backZ(room) + backIn(room) * 0.35
  return (
    <group>
      {[-12.3, -11.5, -10.7].map((x, i) => (
        <ServerRack key={i} position={[x, 0, bz]} active={active} seed={i} />
      ))}
      <ServerRack position={[-12.6, 0, -6.2]} rotationY={-HALF_PI} active={active} seed={2} />
      <ServerRack position={[-12.6, 0, -5.3]} rotationY={-HALF_PI} active={active} seed={3} />
      <CoolingUnit position={[-9.15, 0, -6.6]} />
      <CoolingUnit position={[-9.15, 0, -7.7]} />
      <WallDisplay position={[-9.4, 1.75, bz]} w={1.4} h={0.8} tint="#87a7b4" label="status" />
      {/* Raised floor with a service aisle, plus the overhead cable tray. */}
      {[-8.2, -7.2, -6.2, -5.2, -4.2, -3.2, -2.2].map((z) => (
        <Box key={z} size={[4.2, 0.008, 0.02]} at={[-10.8, 0.024, z]} m={mat('#c8cdd0', { rough: 0.7 })} />
      ))}
      <Box size={[1.0, 0.006, 6.2]} at={[-10.8, 0.026, -5.3]} m={mat('#d3dadb', { rough: 0.8 })} />
      <Box size={[4.0, 0.09, 0.16]} at={[-10.8, 2.55, -5.0]} m={mat('#b3babf', { rough: 0.5, metal: 0.4 })} />
      <Box size={[3.4, 0.05, 0.08]} at={[-10.8, 2.49, -5.0]} m={mat('#4d555c', { rough: 0.8 })} />
      <WallSign position={[-9.5, 1.62, -1.82]} w={1.0} h={0.26} color="#5c6b74" />
      <Text position={[-9.5, 1.62, -1.76]} fontSize={0.1} color="#eef3f4" anchorX="center" anchorY="middle" letterSpacing={0.08}>
        RESTRICTED ACCESS
      </Text>
      <Box size={[0.16, 0.24, 0.03]} at={[-8.5, 1.35, -1.82]} m={mat(active ? '#63cfc0' : '#cfd4d8', { rough: 0.5, emissive: active ? '#63cfc0' : '#000000', glow: active ? 1.2 : 0 })} />
      <Shelf position={[-12.72, 0, -2.8]} rotationY={HALF_PI} w={0.9} h={1.5} levels={3} />
      {active && <pointLight position={[-10.8, 2.1, -4.0]} color="#a8dfe2" intensity={2.4} distance={5.5} decay={2} />}
    </group>
  )
}

/** ── Analyst and research ───────────────────────────────────────────────────── */
function AnalystFloor({ room }: { room: Room }) {
  const fw = featureWall(room)
  const rig = deskRig()
  return (
    <group>
      {room.stations.map(([x, z], i) => (
        <group key={i}>
          <Desk position={[x, 0, z]} rotationY={rig.rot} top={i % 2 ? C.oakPale : '#e7e2d8'} />
          <Monitor position={[x - 0.16, 0, rig.monitorZ(z)]} rotationY={rig.monitorRot} w={0.5} h={0.3} mount={1.06} />
          <Monitor position={[x + 0.32, 0, rig.monitorZ(z) + rig.inward * 0.02]} rotationY={rig.monitorRot - 0.3 * rig.inward} w={0.36} h={0.26} mount={1.0} />
          <Keyboard position={[x, 0.755, rig.keyboardZ(z)]} rotationY={rig.rot} />
          <DeskProps position={[x - 0.52, 0.755, rig.keyboardZ(z)]} mug="#8fae8c" />
          <OfficeChair position={[x, 0, rig.chairZ(z)]} rotationY={rig.chairRot} color="#a9bda8" />
        </group>
      ))}
      <Whiteboard position={fw.mount(0, 1.6)} rotationY={fw.rotY} w={2.0} />
      <WallLabel room={room} offset={0} y={2.35} text="DATA REVIEW" />
      {[0.16, 0.3, 0.22, 0.4, 0.28, 0.36].map((h, i) => (
        <Box
          key={i}
          size={[0.12, h, 0.012]}
          at={fw.mount(-0.5 + i * 0.2, 1.28 + h / 2)}
          m={mat('#7f9f86', { rough: 0.7 })}
          rot={[0, fw.rotY, 0]}
        />
      ))}
      <Shelf position={[-2.62, 0, 3.4]} rotationY={-HALF_PI} w={1.2} h={1.9} levels={4} />
      <Credenza position={[-6.5, 0, 2.4]} w={1.1} />
      <Printer position={[-6.5, 0.7, 2.4]} />
      <Plant position={[-2.8, 0, 8.2]} kind={1} />
      <FloorLamp position={[-7.0, 0, 1.9]} />
      <AreaRug position={[-4.9, 0.02, 2.9]} size={[3.4, 1.5]} color="#e4e8e2" />
    </group>
  )
}

/** ── Design studio ──────────────────────────────────────────────────────────── */
function DesignFloor({ room }: { room: Room }) {
  const fw = featureWall(room)
  const rig = deskRig()
  return (
    <group>
      {room.stations.map(([x, z], i) => (
        <group key={i}>
          <Desk position={[x, 0, z]} rotationY={rig.rot} top={i % 3 === 0 ? '#e9dfd2' : C.oakPale} />
          <Monitor position={[x, 0, rig.monitorZ(z)]} rotationY={rig.monitorRot} w={0.62} h={0.36} mount={1.12} />
          <Box size={[0.34, 0.014, 0.24]} at={[x - 0.02, 0.762, rig.keyboardZ(z) - rig.inward * 0.12]} m={mat('#3d454d', { rough: 0.4 })} rot={[0, 0.12 * rig.inward, 0]} />
          <Keyboard position={[x + 0.02, 0.755, rig.keyboardZ(z)]} rotationY={rig.rot} />
          <DeskProps position={[x - 0.52, 0.755, rig.keyboardZ(z)]} mug="#c58ba0" />
          <OfficeChair position={[x, 0, rig.chairZ(z)]} rotationY={rig.chairRot} color="#c3aab6" />
        </group>
      ))}
      <StickyBoard position={fw.mount(0.3, 1.65)} rotationY={fw.rotY} w={2.0} accent="#c58ba0" />
      <WallLabel room={room} offset={0.3} y={2.45} text="IDEA WALL" />
      <Poster position={[3.22, 1.6, 2.7]} rotationY={-HALF_PI} art={1} accent="#c58ba0" />
      <Poster position={[3.22, 1.6, 8.1]} rotationY={-HALF_PI} art={2} accent="#d8b98c" />
      {/* Material library: low shelf holding colour and finish samples. */}
      <group position={[-2.2, 0, 3.1]} rotation={[0, HALF_PI, 0]}>
        <Shelf position={[0, 0, 0]} w={1.4} h={1.0} levels={2} />
        {[0.3, 0.62].map((y, r) => (
          <group key={r}>
            {['#c58ba0', '#d8b98c', '#8fae8c', '#7f9bb5', '#e0d5c8'].map((c, i) => (
              <Box key={i} size={[0.2, 0.14, 0.03]} at={[-0.5 + i * 0.25, y + 0.08, 0.14]} m={mat(c, { rough: 0.8 })} rot={[-0.5, 0, 0]} />
            ))}
          </group>
        ))}
      </group>
      <TreePlant position={[-2.15, 0, 8.2]} />
      <Plant position={[3.05, 0, 2.4]} kind={1} scale={1.1} />
      <TableLamp position={[-1.5, 0.76, 6.9]} shade="#f4e2cd" />
      <AreaRug position={[0.5, 0.02, 3.0]} size={[4.2, 1.4]} color="#ece3e6" />
    </group>
  )
}

/** ── Administration and operations ──────────────────────────────────────────── */
function AdminFloor({ room }: { room: Room }) {
  const fw = featureWall(room)
  const bz = backZ(room) + backIn(room) * 0.14
  const rot = deskRot()
  return (
    <group>
      {room.stations.map(([x, z], i) => (
        <Workstation key={i} position={[x, 0, z]} rotationY={rot} accent={i % 2 ? '#e7e1d6' : C.oakPale} variant={i} />
      ))}
      <FilingCabinet position={[12.6, 0, -8.4]} rotationY={-HALF_PI} />
      <FilingCabinet position={[12.6, 0, -7.75]} rotationY={-HALF_PI} />
      <Credenza position={[9.75, 0, bz + 0.2]} w={1.2} />
      <Printer position={[9.75, 0.7, bz + 0.2]} />
      <Shelf position={fw.mount(-0.9, 0)} rotationY={fw.rotY} w={1.3} h={1.7} levels={3} />
      <WallClock position={fw.mount(1.1, 2.0)} rotationY={fw.rotY} />
      <WallLabel room={room} offset={0.1} y={2.42} text="OPERATIONS" />
      <Plant position={[9.4, 0, -2.4]} kind={0} />
      <TrashBin position={[10.9, 0.17, -3.0]} />
      <AreaRug position={[11.0, 0.02, -2.8]} size={[3.2, 1.3]} color="#e8e5db" />
    </group>
  )
}

/** ── Security control ───────────────────────────────────────────────────────── */
function SecurityRoom({ room }: { room: Room }) {
  const fw = featureWall(room)
  const rot = deskRot()
  return (
    <group>
      <Desk position={[6.35, 0, -7.0]} rotationY={rot} w={1.4} top="#e6e3dc" />
      <Desk position={[8.25, 0, -7.0]} rotationY={rot} w={1.4} top="#e6e3dc" />
      <Monitor position={[6.35, 0, -7.2]} w={0.44} h={0.28} mount={1.04} />
      <Monitor position={[8.25, 0, -7.2]} w={0.44} h={0.28} mount={1.04} />
      <Keyboard position={[6.35, 0.755, -6.8]} rotationY={rot} />
      <Keyboard position={[8.25, 0.755, -6.8]} rotationY={rot} />
      <OfficeChair position={[6.35, 0, -6.15]} rotationY={Math.PI} color="#8fa2ab" />
      <OfficeChair position={[8.25, 0, -6.15]} rotationY={Math.PI} color="#8fa2ab" />
      <CctvWall position={fw.mount(0, 1.75)} rotationY={fw.rotY} />
      <WallLabel room={room} offset={0} y={2.62} text="LIVE FEEDS" size={0.12} />
      {/* Access-control panel beside the doorway. */}
      <Box size={[0.26, 0.36, 0.05]} at={[8.55, 1.3, -1.82]} m={mat('#3f4a52', { rough: 0.5 })} cast />
      <Box size={[0.18, 0.1, 0.014]} at={[8.55, 1.38, -1.78]} m={mat('#7fd6c6', { rough: 0.3, emissive: '#5fbfae', glow: 0.8 })} />
      <Box size={[0.18, 0.02, 0.014]} at={[8.55, 1.24, -1.78]} m={mat('#cfd6da', { rough: 0.4 })} />
      <Dispenser position={[5.75, 0, -2.6]} />
      <Shelf position={[5.58, 0, -8.3]} rotationY={HALF_PI} w={0.9} h={1.5} levels={3} />
      <Plant position={[8.6, 0, -3.2]} kind={1} scale={0.9} />
      <FloorLamp position={[5.75, 0, -4.6]} />
    </group>
  )
}

/** ── Lobby, reception and visitor lounge ────────────────────────────────────── */
function Lobby({ room, onStaffTalk }: { room: Room; onStaffTalk?: (variant: StaffVariant) => void }) {
  return (
    <group>
      {/* Reception stands against the west wall facing east. That keeps the straight line from the
       *  main door to the corridor doorway empty — the old desk straddled both — while the desk and
       *  its lit backdrop still sit in view as you come through the entrance. The waiting nook
       *  stays on the east flank, off the walking line. */}
      <ReceptionDesk position={[-12.15, 0, 4.6]} rotationY={HALF_PI} />
      <StaffNpc variant="greeter" position={[-11.35, 0, 6.95]} rotationY={0.5} seed={3} onTalk={onStaffTalk} />
      <group position={[-12.88, 0, 4.6]} rotation={[0, HALF_PI, 0]}>
        {/* Slatted oak screen, open between the fins so the lobby reads deep from the door, with
         * a pale plaque carrying the campus mark at standing eye height. */}
        {Array.from({ length: 13 }, (_, i) => (
          <Box key={i} size={[0.07, 2.46, 0.14]} at={[-0.96 + i * 0.16, 1.23, 0]} m={mat(C.oakPale, { rough: 0.7 })} cast />
        ))}
        {[-1.03, 1.03].map((x) => (
          <Box key={x} size={[0.1, 2.52, 0.18]} at={[x, 1.26, 0]} m={mat(C.oakDark, { rough: 0.65 })} cast />
        ))}
        <Box size={[2.16, 0.09, 0.2]} at={[0, 2.51, 0]} m={mat(C.oakDark, { rough: 0.65 })} cast />
        <Box size={[2.16, 0.05, 0.2]} at={[0, 0.03, 0]} m={mat(C.trim, { rough: 0.75 })} />
        <Box size={[1.38, 0.5, 0.05]} at={[0, 1.78, 0.11]} m={mat(C.wall, { rough: 0.85 })} cast />
        <Text position={[0, 1.85, 0.145]} fontSize={0.19} color="#4d5560" anchorX="center" anchorY="middle" letterSpacing={0.14}>
          AGENTVILLE
        </Text>
        <Text position={[0, 1.67, 0.145]} fontSize={0.065} color="#8792a0" anchorX="center" anchorY="middle" letterSpacing={0.26}>
          GREEN TECH CAMPUS
        </Text>
        <Box size={[0.7, 0.022, 0.02]} at={[0, 1.585, 0.145]} m={mat(room.accent, { rough: 0.6 })} />
      </group>
      <AreaRug position={[-11.2, 0.02, 4.6]} size={[1.7, 2.9]} color="#e6ded1" />
      <AreaRug position={[-8.9, 0.02, 7.0]} size={[2.4, 2.9]} color="#e6ded1" />
      <Sofa position={[-8.15, 0, 6.0]} rotationY={-HALF_PI} seats={2} />
      <CoffeeTable position={[-9.2, 0, 7.0]} rotationY={HALF_PI} />
      <Armchair position={[-8.15, 0, 8.2]} rotationY={-HALF_PI} />
      <Dispenser position={[-12.75, 0, 2.35]} />
      <TreePlant position={[-12.55, 0, 8.4]} />
      <Plant position={[-12.6, 0, 6.6]} kind={1} scale={0.9} />
      <PendantLamp position={[-11.6, FLOOR.height, 4.6]} drop={0.72} radius={0.2} />
      <PendantLamp position={[-8.7, FLOOR.height, 7.0]} drop={0.8} radius={0.24} shade="#e8dcc8" />
      <WallClock position={[-12.8, 2.1, 7.4]} rotationY={HALF_PI} />
      <Poster position={[-7.46, 1.55, 4.0]} rotationY={-HALF_PI} art={2} accent={room.accent} />
      <TrashBin position={[-12.35, 0.17, 6.5]} />
    </group>
  )
}

/** ── Pantry ─────────────────────────────────────────────────────────────────── */
function Pantry({ room }: { room: Room }) {
  const fw = featureWall(room)
  return (
    <group>
      {/* Wet run down the east flank: counter, sink, coffee machine and tall appliances. */}
      <CounterRun position={[12.62, 0, 6.2]} rotationY={-HALF_PI} length={4.0} />
      <UpperCabinets position={[12.8, 1.78, 6.2]} rotationY={-HALF_PI} length={3.0} />
      <Fridge position={[12.6, 0, 2.7]} rotationY={-HALF_PI} />
      <Microwave position={[12.55, 1.07, 7.9]} rotationY={-HALF_PI} />
      <Dispenser position={[9.45, 0, 2.4]} />
      <BistroTable position={[10.3, 0, 4.2]} />
      <BistroTable position={[10.6, 0, 7.2]} />
      <Stool position={[9.7, 0, 3.7]} />
      <Stool position={[10.9, 0, 4.7]} />
      <Stool position={[10.0, 0, 6.7]} />
      <Stool position={[11.2, 0, 7.7]} color="#d5c8b6" />
      <StickyBoard position={fw.mount(-0.9, 1.7)} rotationY={fw.rotY} w={0.9} h={0.7} accent="#d1975f" />
      <WallLabel room={room} offset={-0.9} y={2.3} text="MENU" size={0.12} />
      <Plant position={[9.45, 0, 8.3]} kind={0} scale={0.95} />
      <PendantLamp position={[10.3, FLOOR.height, 4.2]} drop={0.8} radius={0.16} />
      <PendantLamp position={[10.6, FLOOR.height, 7.2]} drop={0.8} radius={0.16} />
      <CeilingFan position={[10.45, 0, 5.6]} />
      <AreaRug position={[10.6, 0.02, 5.6]} size={[2.8, 4.6]} color="#e9e0d2" />
      <TrashBin position={[9.4, 0.17, 5.4]} />
    </group>
  )
}

/** ── Meeting room ───────────────────────────────────────────────────────────── */
function MeetingRoom({ room, topic }: { room: Room; topic?: string }) {
  const fw = featureWall(room)
  return (
    <group>
      <ConferenceTable position={[6.2, 0, 5.6]} length={2.6} />
      {[[5.3, 4.6, 0], [6.2, 4.6, 0], [7.1, 4.6, 0],
        [5.3, 6.6, Math.PI], [6.2, 6.6, Math.PI], [7.1, 6.6, Math.PI],
        [4.5, 5.6, HALF_PI], [7.9, 5.6, -HALF_PI]].map(([x, z, ry], i) => (
        <ConferenceChair key={i} position={[x, 0, z]} rotationY={ry} />
      ))}
      <WallDisplay position={fw.mount(0, 1.55)} rotationY={fw.rotY} w={2.4} h={1.3} label={topic} tint="#8fb6bd" />
      <WallLabel room={room} offset={0} y={2.5} text="BRIEFING SCREEN" size={0.115} />
      <Whiteboard position={[3.52, 1.5, 7.4]} rotationY={HALF_PI} w={1.5} />
      <Credenza position={[8.72, 0, 3.0]} rotationY={-HALF_PI} w={1.1} />
      <TableLamp position={[8.72, 0.71, 3.0]} shade="#efe2cd" />
      <Plant position={[4.0, 0, 2.4]} kind={1} scale={1.05} />
      <Sofa position={[6.2, 0, 8.4]} rotationY={Math.PI} seats={2} color="#dcd6ca" />
      <PendantLamp position={[6.2, FLOOR.height, 5.6]} drop={0.85} radius={0.26} shade="#e9e0cf" />
      <CeilingFan position={[6.2, 0, 4.3]} speed={2.2} />
      <AreaRug position={[6.2, 0.02, 5.6]} size={[4.8, 3.6]} color="#e6e4ee" />
      <TrashBin position={[8.6, 0.17, 2.3]} />
    </group>
  )
}

const FITTINGS: Record<string, (room: Room, ctx: { active: boolean; topic?: string; onStaffTalk?: (variant: StaffVariant) => void }) => ReactElement> = {
  dev: (room, ctx) => <DevFloor room={room} active={ctx.active} />,
  cs: (room, ctx) => <ServiceFloor room={room} onStaffTalk={ctx.onStaffTalk} />,
  server: (room, ctx) => <ServerRoom room={room} active={ctx.active} />,
  analyst: (room) => <AnalystFloor room={room} />,
  design: (room) => <DesignFloor room={room} />,
  admin: (room) => <AdminFloor room={room} />,
  security: (room) => <SecurityRoom room={room} />,
  lobby: (room, ctx) => <Lobby room={room} onStaffTalk={ctx.onStaffTalk} />,
  pantry: (room) => <Pantry room={room} />,
  meeting: (room, ctx) => <MeetingRoom room={room} topic={ctx.topic} />,
}

export function RoomFitout({ id, active, topic, onStaffTalk }: {
  id: string; active: boolean; topic?: string; onStaffTalk?: (variant: StaffVariant) => void
}) {
  const room = ROOMS[id]
  const fitting = FITTINGS[id]
  if (!room || !fitting) return null
  return <>{fitting(room, { active, topic, onStaffTalk })}</>
}

/** Corridor dressing: the circulation spine should look designed, not left over. Props hug the
 *  partitions so the centre line stays walkable. */
export function CorridorProps() {
  return (
    <group>
      <Box size={[25, 0.006, 1.9]} at={[0, 0.022, 0]} m={mat('#d6d0c5', { rough: 0.85 })} receive />
      {[-10.2, -5, 0.5, 5.6, 10.6].map((x) => (
        <Box key={x} size={[0.06, 0.006, 1.7]} at={[x, 0.026, 0]} m={mat('#c6bfb3', { rough: 0.85 })} />
      ))}
      <Plant position={[-3.2, 0, 1.46]} kind={1} scale={1.05} />
      <Plant position={[3.4, 0, -1.46]} kind={0} scale={0.95} />
      <TreePlant position={[-6.6, 0, -1.48]} />
      <TreePlant position={[7.6, 0, 1.48]} />
      <Bench position={[-1.2, 0, -1.3]} w={1.5} />
      <Dispenser position={[1.9, 0, 1.36]} />
      <WallSign position={[0.4, 2.4, -1.62]} w={1.7} h={0.3} color="#6b7580" />
      <Text position={[0.4, 2.4, -1.56]} fontSize={0.12} color="#eef2f3" anchorX="center" anchorY="middle" letterSpacing={0.16}>
        MAIN CORRIDOR
      </Text>
      {[-8.6, 8.6].map((x) => (
        <Box key={x} size={[0.42, 1.15, 0.05]} at={[x, 0.95, x > 0 ? 1.62 : -1.62]} m={mat('#dfe4e6', { rough: 0.7 })} cast />
      ))}
    </group>
  )
}

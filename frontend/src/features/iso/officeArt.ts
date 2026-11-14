/** The painted office for the 2D view: floor plate, floors, walls and furniture, all generated
 *  from `officeLayout.ts` so desks, chairs and doors sit exactly where the 3D scene and the
 *  backend expect people to be. Nothing here is driven by state except the handles it returns
 *  (desk screens, server LEDs, the meeting-room screen), which the renderer tints from real data. */
import { Container, Graphics, Text } from 'pixi.js'
import { iso, zIndexOf } from '../../lib/iso'
import { DOOR_H, FLOOR, ROOMS, WALLS, type Room } from '../../lib/officeLayout'
import type { StaffVariant } from '../office/staffScript'
import { box, face, floorEllipse, floorRect, glow, hex, line, mix, rng, shade, shadow, wallText, wallX, wallZ } from './draw'

export interface StaffSpot { variant: StaffVariant; x: number; z: number; facing: number }

export interface OfficeArt {
  /** Slab, floors and rugs: static, always under everything else. */
  under: Container
  /** North and west window walls: static, behind everything else. */
  back: Container
  /** Depth-sorted pieces (each has its zIndex set). */
  props: Container[]
  /** Desk screens per `${roomId}:${stationIndex}`, drawn white so they can be tinted. */
  screens: Map<string, Graphics[]>
  /** Blinking server LEDs. */
  leds: Graphics[]
  /** Text on the meeting-room screen. */
  meetingText: Text
  staff: StaffSpot[]
}

const K = {
  wood: 0xc48a52, woodLine: 0x9f6a3c, woodDark: 0x92603a,
  marble: 0xebe4d7, marbleLine: 0xd5cab8, gold: 0xc9a25a,
  navy: 0x2d406b, walnut: 0xa66d41, walnutTop: 0xb98252, frame: 0x2e2a27,
  chair: 0x2b2f36, monitor: 0x1a1e24, steel: 0x8b9298,
  leaf: 0x4f8f4c, leafDark: 0x356b3a, leafLight: 0x79b866, pot: 0xece6dc, terracotta: 0xb8734a,
  sofa: 0xe2dbcd, glass: 0xcde7f3, mullion: 0x8a949e, white: 0xf7f5f0,
}

const TAU = Math.PI * 2
/** Pendant lamps (world x, z): reception, meeting table, the two pantry tables. */
const PENDANTS: [number, number][] = [[-11.4, 4.6], [6.2, 5.6], [10.3, 4.2], [10.6, 7.2]]

export function buildOffice(): OfficeArt {
  const under = new Container()
  const back = new Container()
  const props: Container[] = []
  const screens = new Map<string, Graphics[]>()
  const leds: Graphics[] = []
  const staff: StaffSpot[] = []

  /** A new sorted piece at (x, z). */
  const piece = (x: number, z: number, bias = 0): Graphics => {
    const g = new Graphics()
    g.zIndex = zIndexOf(x, z, bias)
    props.push(g)
    return g
  }
  const group = (x: number, z: number, bias = 0): Container => {
    const c = new Container()
    c.zIndex = zIndexOf(x, z, bias)
    props.push(c)
    return c
  }

  // ── Floor plate ──────────────────────────────────────────────────────────────
  const { halfX: HX, halfZ: HZ, height: H } = FLOOR
  const slab = new Graphics()
  wallZ(slab, HZ, -HX, HX, -0.9, 0, 0x2a2e39)
  wallX(slab, HX, -HZ, HZ, -0.9, 0, 0x1f222b)
  line(slab, [-HX, HZ, 0], [HX, HZ, 0], K.gold, 1.4, 0.9)
  line(slab, [HX, -HZ, 0], [HX, HZ, 0], K.gold, 1.4, 0.9)
  // Warm string lights along the slab edge, as on a terrace.
  for (let x = -HX + 0.6; x < HX; x += 1.1) lamp(slab, x, HZ, -0.32)
  for (let z = -HZ + 0.6; z < HZ; z += 1.1) lamp(slab, HX, z, -0.32)
  under.addChild(slab)

  const floors = new Graphics()
  // Corridor first, then every room on top of it.
  marbleFloor(floors, [-HX, -1.7, HX, 1.7])
  for (const z of [-1.45, 1.45]) line(floors, [-HX + 0.3, z, 0], [HX - 0.3, z, 0], K.gold, 1, 0.75)
  for (const r of Object.values(ROOMS)) roomFloor(floors, r)
  rugs(floors)
  decals(floors)
  under.addChild(floors)
  const light = new Graphics()
  ambient(light)
  under.addChild(light)

  // ── Back walls: glazing with a painted skyline ───────────────────────────────
  const windows = new Graphics()
  windowWall(windows, 'z', -HZ, -HX, HX, H, 11)
  windowWall(windows, 'x', -HX, -HZ, HZ, H, 29)
  back.addChild(windows)

  // ── Partitions, doors and the front railing ──────────────────────────────────
  for (const w of WALLS) {
    if (w.key === 'perim-n' || w.key === 'perim-w') continue
    const front = w.key === 'perim-s' || w.key === 'perim-e'
    const horizontal = w.a[1] === w.b[1]
    const len = horizontal ? w.b[0] - w.a[0] : w.b[1] - w.a[1]
    const gap = w.door ? [w.door.at - w.door.width / 2, w.door.at + w.door.width / 2] : null
    const chunk = front ? 1.1 : w.kind === 'solid' ? 0.45 : 0.9
    const spans: [number, number][] = gap ? [[0, gap[0]], [gap[1], len]] : [[0, len]]
    for (const [s0, s1] of spans) {
      for (let u = s0; u < s1 - 0.01; u += chunk) {
        const u1 = Math.min(s1, u + chunk)
        const mid = (u + u1) / 2
        const [mx, mz] = horizontal ? [w.a[0] + mid, w.a[1]] : [w.a[0], w.a[1] + mid]
        const g = piece(mx, mz, front ? 0.35 : -0.03)
        const span = (a: number, b: number): [number, number] => horizontal
          ? [w.a[0] + a, w.a[0] + b] : [w.a[1] + a, w.a[1] + b]
        const quad = (a: number, b: number, y0: number, y1: number, color: number, alpha = 1) => {
          const [p, q] = span(a, b)
          if (horizontal) wallZ(g, w.a[1], p, q, y0, y1, color, alpha)
          else wallX(g, w.a[0], p, q, y0, y1, color, alpha)
        }
        if (front) {
          quad(u, u1, 0, 0.92, K.glass, 0.2)
          quad(u, u1, 0.9, 0.98, 0xb8915a)
          quad(u, Math.min(u1, u + 0.06), 0, 0.98, 0x3b3f48)
        } else if (w.kind === 'solid') {
          const [p, q] = span(u, u1)
          const thick = 0.12
          const base = 0xb9a98f
          const trim = 0xf7f1e4
          if (horizontal) {
            const m = (p + q) / 2
            box(g, m, w.a[1], q - p, thick, 0, 1.15, 0xe6dccb, { outline: null })
            box(g, m, w.a[1], q - p, thick + 0.02, 0, 0.1, base, { outline: null, flat: true })
            box(g, m, w.a[1], q - p + 0.01, thick + 0.04, 1.15, 0.05, trim, { outline: null, flat: true })
            line(g, [p, w.a[1] + thick / 2, 0.1], [p, w.a[1] + thick / 2, 1.15], 0x9c8d76, 0.7, 0.5)
          } else {
            const m = (p + q) / 2
            box(g, w.a[0], m, thick, q - p, 0, 1.15, 0xe6dccb, { outline: null })
            box(g, w.a[0], m, thick + 0.02, q - p, 0, 0.1, base, { outline: null, flat: true })
            box(g, w.a[0], m, thick + 0.04, q - p + 0.01, 1.15, 0.05, trim, { outline: null, flat: true })
            line(g, [w.a[0] + thick / 2, p, 0.1], [w.a[0] + thick / 2, p, 1.15], 0x9c8d76, 0.7, 0.5)
          }
        } else {
          quad(u, u1, 0, w.height, K.glass, 0.13)
          // Diagonal reflection, so a pane reads as glass instead of a tinted sheet.
          if (u1 - u > 0.6) {
            const [p, q] = span(u + 0.12, u + 0.42)
            const streak = (a: number, b: number, alpha: number) => face(g, horizontal
              ? [[p + a, w.a[1], 0.5], [p + b, w.a[1], 0.5], [q + b, w.a[1], 1.9], [q + a, w.a[1], 1.9]]
              : [[w.a[0], p + a, 0.5], [w.a[0], p + b, 0.5], [w.a[0], q + b, 1.9], [w.a[0], q + a, 1.9]], 0xffffff, alpha)
            streak(0, 0.1, 0.16)
            streak(0.16, 0.2, 0.1)
          }
          quad(u, u1, 0, 0.08, K.mullion)
          quad(u, u1, w.height - 0.06, w.height, K.mullion)
          quad(u, Math.min(u1, u + 0.045), 0, w.height, K.mullion, 0.9)
        }
      }
    }
    if (gap && !front) {
      // Door posts, header and the glazed transom over the opening.
      const [g0, g1] = gap
      const at = (u: number): [number, number] => horizontal ? [w.a[0] + u, w.a[1]] : [w.a[0], w.a[1] + u]
      const [cx, cz] = at((g0 + g1) / 2)
      const g = piece(cx, cz, -0.03)
      const top = w.kind === 'solid' ? 2.25 : w.height
      for (const u of [g0, g1]) {
        const [px, pz] = at(u)
        box(g, px, pz, 0.08, 0.08, 0, DOOR_H, 0x5d6672, { outline: null })
      }
      const [hx0, hz0] = at(g0)
      const [hx1, hz1] = at(g1)
      if (horizontal) {
        wallZ(g, hz0, hx0, hx1, DOOR_H, top, K.glass, 0.18)
        wallZ(g, hz0, hx0, hx1, DOOR_H, DOOR_H + 0.07, 0x5d6672)
      } else {
        wallX(g, hx0, hz0, hz1, DOOR_H, top, K.glass, 0.18)
        wallX(g, hx0, hz0, hz1, DOOR_H, DOOR_H + 0.07, 0x5d6672)
      }
    }
  }
  // Lamp posts on the front railing, like the deck in a resort.
  for (let x = -HX + 0.05; x <= HX; x += 2.6) {
    if (x > -11.6 && x < -8.8) continue
    lampPost(piece(x, HZ, 0.4), x, HZ)
  }
  for (let z = -HZ + 0.05; z <= HZ; z += 2.6) lampPost(piece(HX, z, 0.4), HX, z)

  // Room name plates over the corridor doors.
  for (const r of Object.values(ROOMS)) {
    const c = group(r.door[0], r.door[1], -0.06)
    const g = new Graphics()
    wallZ(g, r.door[1] + 0.01, r.door[0] - 0.85, r.door[0] + 0.85, 2.2, 2.42, 0x263043)
    wallZ(g, r.door[1] + 0.012, r.door[0] - 0.85, r.door[0] + 0.85, 2.2, 2.225, hex(r.accent))
    c.addChild(g)
    c.addChild(wallText(r.label.toUpperCase(), [r.door[0], r.door[1] + 0.02, 2.315], 'z', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: 4.6, fontWeight: '700', fill: 0xf2ede2, letterSpacing: 0.6,
    }))
  }

  // ── Furniture per room ───────────────────────────────────────────────────────
  const deskRoom = (r: Room, opts: { top?: number; visitor?: boolean; chairColor?: number } = {}) => {
    r.stations.forEach(([x, z], i) => {
      screens.set(`${r.id}:${i}`, desk(x, z, i * 7 + r.id.length, opts.top))
      chair(x, z + (r.seatOffset?.[1] ?? 0.78), Math.PI, opts.chairColor ?? K.chair)
      if (opts.visitor) chair(x, z - 0.72, 0, 0x8fa3ad)
    })
  }

  // Lobby & reception: desk faces the entrance aisle, greeter stands behind it.
  {
    const g = piece(-12.95, 4.6)
    wallX(g, -12.95, 3.4, 5.8, 0.85, 2.45, 0x232b39)
    wallX(g, -12.94, 3.4, 5.8, 0.85, 0.9, K.gold)
    wallX(g, -12.94, 3.4, 5.8, 2.4, 2.45, K.gold)
    const logo = group(-12.95, 4.6, 0.01)
    logo.addChild(wallText('AgentVille', [-12.93, 4.6, 1.78], 'x', {
      fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: '700', fill: 0xf1cf86, letterSpacing: 0.5,
    }))
    logo.addChild(wallText('VIRTUAL AI OFFICE', [-12.93, 4.6, 1.33], 'x', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: 4.4, fill: 0xd8dde6, letterSpacing: 2,
    }))
    const d = piece(-11.95, 4.6)
    box(d, -11.95, 4.6, 0.6, 2.2, 0, 1.0, K.walnut)
    box(d, -11.95, 4.6, 0.72, 2.32, 1.0, 0.06, 0xe9e1d2)
    wallX(d, -11.649, 3.5, 5.7, 0.5, 0.58, K.gold)
    box(d, -12.0, 4.3, 0.06, 0.42, 1.06, 0.28, K.monitor)
    staff.push({ variant: 'greeter', x: -12.62, z: 4.75, facing: Math.PI / 2 })
    sofa(-8.15, 6.0, 1.6, 'z', -Math.PI / 2, 0xd9cfbd)
    roundTable(-9.0, 6.0, 0.32, 0x8e5c37, 0.42)
    dispenser(-12.72, 2.35)
    plant(-12.55, 8.45, 1.45, 'tree')
    plant(-12.6, 6.6, 0.95)
    plant(-7.8, 2.15, 1.0)
    const mat = new Graphics()
    floorRect(mat, -11.3, 8.25, -9.1, 8.95, 0x5a3f2e, 1, 0.005)
    under.addChild(mat)
  }

  // Analyst / Research
  {
    const r = ROOMS.analyst
    deskRoom(r)
    bookshelf(-6.3, 1.95, 1.2)
    board(-3.35, 1.95, 1.1, 'chart')
    plant(-2.75, 2.2, 1.0)
    plant(-7.05, 8.6, 1.2, 'tree')
  }

  // Design studio
  {
    const r = ROOMS.design
    deskRoom(r, { top: 0xd6b88d })
    board(-1.55, 1.95, 1.3, 'sticky')
    plant(2.95, 2.2, 1.0)
    plant(2.95, 8.6, 1.3, 'tree')
    easel(-2.0, 8.5)
  }

  // Meeting room: the long table, a chair on every real seat and the big screen.
  let meetingText: Text
  {
    const r = ROOMS.meeting
    const t = piece(6.2, 5.6)
    box(t, 5.4, 5.6, 0.2, 0.5, 0, 0.7, K.frame)
    box(t, 7.0, 5.6, 0.2, 0.5, 0, 0.7, K.frame)
    box(t, 6.2, 5.6, 2.7, 1.15, 0.7, 0.07, 0x6f4429)
    floorRect(t, 5.1, 5.35, 7.3, 5.85, 0x8a5a38, 0.5, 0.772)
    for (const x of [5.3, 6.2, 7.1]) floorRect(t, x - 0.17, 5.05, x + 0.17, 5.25, 0x2c3038, 1, 0.772)
    r.stations.forEach(([x, z], i) => chair(x, z, r.seatFaces?.[i] ?? 0, 0x2f3540))
    const s = piece(3.62, 5.6)
    box(s, 3.55, 4.6, 0.08, 0.08, 0, 0.8, K.frame, { outline: null })
    box(s, 3.55, 6.6, 0.08, 0.08, 0, 0.8, K.frame, { outline: null })
    wallX(s, 3.6, 4.05, 7.15, 0.78, 2.22, 0x0f1624)
    wallX(s, 3.61, 4.12, 7.08, 0.85, 2.15, 0x162238)
    const c = group(3.62, 5.6, 0.01)
    const holder = wallText('Ruang rapat', [3.62, 5.6, 1.5], 'x', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: 7.5, fontWeight: '700', fill: 0xf4d27a,
      align: 'center', wordWrap: true, wordWrapWidth: 78, lineHeight: 9,
    })
    meetingText = holder.children[0] as Text
    c.addChild(holder)
    sofa(6.2, 8.45, 1.8, 'x', Math.PI, 0xd9d2c4)
    plant(8.6, 2.15, 1.0)
    plant(8.62, 8.6, 1.2, 'tree')
  }

  // Pantry: wet run on the east side, bistro tables, menu board.
  {
    const c = piece(12.62, 6.2)
    box(c, 12.62, 6.2, 0.6, 4.0, 0, 0.9, 0xe6ddcf)
    box(c, 12.62, 6.2, 0.66, 4.06, 0.9, 0.05, 0x3a3f47)
    box(c, 12.6, 5.0, 0.32, 0.3, 0.95, 0.38, 0x2a2d33)
    box(c, 12.6, 7.85, 0.4, 0.5, 0.95, 0.28, 0xd7dadd)
    floorRect(c, 12.4, 6.0, 12.82, 6.6, 0x9aa3ab, 1, 0.952)
    const f = piece(12.6, 2.7)
    box(f, 12.6, 2.7, 0.72, 0.72, 0, 1.85, 0xe2e6e9)
    wallX(f, 12.961, 2.45, 2.95, 1.05, 1.08, 0x9aa1a7)
    for (const [x, z] of [[10.3, 4.2], [10.6, 7.2]]) {
      roundTable(x, z, 0.38, 0xe9e2d4, 0.74)
      for (let k = 0; k < 3; k++) {
        const a = k / 3 * TAU + 0.6
        stool(x + Math.cos(a) * 0.62, z + Math.sin(a) * 0.62)
      }
    }
    dispenser(9.45, 2.4)
    plant(9.45, 8.4, 1.0)
    const m = piece(9.02, 6.1)
    wallX(m, 9.03, 5.5, 6.7, 1.05, 1.95, 0x2b3a2f)
    wallX(m, 9.035, 5.55, 6.65, 1.1, 1.9, 0x34503d)
    const t = group(9.03, 6.1, 0.01)
    t.addChild(wallText('MENU\nkopi · teh · roti', [9.04, 6.1, 1.5], 'x', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: 5, fill: 0xf3ead2, align: 'center', lineHeight: 7,
    }))
  }

  // Server / Database: rack rows with blinking LEDs, cooling units.
  {
    for (const x of [-12.3, -11.5, -10.7]) rack(x, -8.5, 'z')
    for (const z of [-6.2, -5.3]) rack(-12.6, z, 'x')
    for (const z of [-6.6, -7.7]) {
      const g = piece(-9.15, z)
      box(g, -9.15, z, 0.6, 0.8, 0, 1.6, 0xdfe3e6)
      for (let y = 0.3; y < 1.5; y += 0.12) line(g, [-8.85, z - 0.35, y], [-8.85, z + 0.35, y], 0x9aa2a9, 0.6, 0.8)
    }
  }

  // Development: desks plus the big code wall.
  {
    deskRoom(ROOMS.dev)
    screenWall(-5.0, -8.82, 2.8, 'code')
    plant(-8.2, -8.55, 1.25, 'tree')
    plant(-1.8, -8.55, 1.0)
    bookshelf(-8.25, -2.3, 0.6, 'x')
  }

  // Customer service: teller counter run, windows and consultation desks.
  {
    const r = ROOMS.cs
    const c = piece(2.0, -7.9)
    box(c, 2.0, -7.9, 6.1, 0.6, 0, 0.9, 0xded6c6)
    box(c, 2.0, -7.9, 6.3, 0.72, 0.9, 0.06, 0xece7dc)
    wallZ(c, -7.539, -1.05, 5.05, 0.72, 0.8, hex(r.accent))
    for (let x = -0.8; x <= 5.0; x += 1.45) {
      wallZ(c, -7.95, x, x + 1.25, 0.96, 1.9, K.glass, 0.25)
      wallZ(c, -7.95, x, x + 1.25, 1.86, 1.92, K.mullion)
    }
    staff.push({ variant: 'teller', x: 0.5, z: -8.55, facing: 0 })
    deskRoom(r, { top: 0xe8e3d9, visitor: true, chairColor: 0x7d93a0 })
    // Queue stanchions with tape down both sides of the lane, as in the 3D fit-out.
    for (const lx of [-0.6, 4.6]) {
      const lane = piece(lx, -5.8, 0.2)
      const poles = [-7.0, -5.8, -4.6]
      for (let i = 0; i < poles.length; i++) {
        const pz = poles[i]
        box(lane, lx, pz, 0.26, 0.26, 0, 0.03, 0x8b9298, { outline: null, flat: true })
        box(lane, lx, pz, 0.05, 0.05, 0.03, 0.92, 0xa9afb5, { outline: null, flat: true })
        const top = iso(lx, pz, 0.98)
        lane.circle(top.x, top.y, 2.1).fill(0x6f777e)
        if (i > 0) line(lane, [lx, poles[i - 1], 0.88], [lx, pz, 0.88], 0xc58ba0, 1.8, 0.95)
      }
    }
    const kiosk = piece(-1.05, -4.0)
    shadow(kiosk, -1.05, -4.0, 0.32, 0.32, 0.3)
    box(kiosk, -1.05, -4.0, 0.3, 0.3, 0, 1.05, 0x39414b)
    wallZ(kiosk, -3.849, -1.18, -0.92, 0.72, 1.0, 0x6fe0d2)
    box(kiosk, -1.05, -4.0, 0.34, 0.34, 1.05, 0.05, 0x4a525c, { outline: null, flat: true })
    const q = piece(2.0, -8.95)
    wallZ(q, -8.94, 1.2, 2.8, 2.05, 2.6, 0x14212b)
    const t = group(2.0, -8.94, 0.01)
    t.addChild(wallText('ANTRIAN  012', [2.0, -8.93, 2.32], 'z', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: 7, fontWeight: '700', fill: 0x6fe0d2, letterSpacing: 1,
    }))
    bench(4.95, -3.6, 1.6, 'z')
    dispenser(4.9, -2.4)
    plant(-1.0, -2.35, 1.05)
    plant(4.75, -7.0, 1.2, 'tree')
  }

  // Security control: CCTV wall and two operator desks.
  {
    const g = piece(7.2, -8.93)
    wallZ(g, -8.93, 5.7, 8.75, 0.95, 2.45, 0x1b222b)
    const rnd = rng(7)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const x0 = 5.82 + col * 0.58
        const y0 = 1.05 + row * 0.46
        wallZ(g, -8.925, x0, x0 + 0.52, y0, y0 + 0.4, mix(0x3c6f86, 0x7fb3c4, rnd()), 1)
      }
    }
    for (const x of [6.35, 8.25]) {
      screens.set(`security:${x === 6.35 ? 0 : 1}`, desk(x, -7.0, 3, 0xe6e3dc, 1))
      chair(x, -6.15, Math.PI, 0x3b4652)
    }
    plant(8.6, -3.2, 1.0)
    floorLamp(5.75, -4.6)
  }

  // Administration
  {
    deskRoom(ROOMS.admin)
    for (const x of [9.45, 10.0]) {
      const g = piece(x, -8.55)
      box(g, x, -8.55, 0.48, 0.55, 0, 1.15, 0xb9bec3)
      for (const y of [0.35, 0.7, 1.0]) line(g, [x - 0.15, -8.27, y], [x + 0.15, -8.27, y], 0x7c838a, 1, 0.9)
    }
    board(11.6, -8.85, 1.4, 'sticky')
    plant(12.6, -8.55, 1.2, 'tree')
    plant(9.35, -2.15, 1.0)
    const p = piece(12.55, -2.3)
    box(p, 12.55, -2.3, 0.55, 0.5, 0, 0.75, 0x3b3f46)
    box(p, 12.55, -2.3, 0.5, 0.45, 0.75, 0.22, 0xe4e6e8)
  }

  // Pendant lamps over the places people gather; their light pools are in `ambient`.
  for (const [x, z] of PENDANTS) pendant(x, z)

  // Corridor
  {
    plant(-3.2, 1.42, 1.0)
    plant(3.4, -1.42, 0.95)
    plant(-6.6, -1.45, 1.3, 'tree')
    plant(7.6, 1.45, 1.3, 'tree')
    bench(-1.2, -1.3, 1.5, 'x')
    dispenser(1.9, 1.36)
  }

  return { under, back, props, screens, leds, meetingText: meetingText!, staff }

  // ── Builders (hoisted) ───────────────────────────────────────────────────────

  /** Static light and shade painted on the floor: wall contact shadows, daylight falling in
   *  through the two window walls, and warm pools under the lamps. */
  function ambient(g: Graphics) {
    // Contact shadow where the floor meets the back walls.
    for (let i = 0; i < 4; i++) {
      const d = 0.16 * (i + 1)
      floorRect(g, -HX, -HZ, HX, -HZ + d, 0x1b1410, 0.045, 0.006)
      floorRect(g, -HX, -HZ, -HX + d, HZ, 0x1b1410, 0.045, 0.006)
    }
    // Daylight: one soft slanted patch per window bay, fading into the room.
    for (let x = -HX + 0.2; x < HX - 1; x += 1.3) {
      for (let k = 0; k < 3; k++) {
        const len = 1.1 + k * 0.75
        face(g, [[x, -HZ, 0.007], [x + 1.05, -HZ, 0.007], [x + 1.05 + len * 0.45, -HZ + len, 0.007], [x + len * 0.45, -HZ + len, 0.007]],
          0xfff3d6, 0.035)
      }
    }
    for (let z = -HZ + 0.2; z < HZ - 1; z += 1.3) {
      for (let k = 0; k < 3; k++) {
        const len = 1.1 + k * 0.75
        face(g, [[-HX, z, 0.007], [-HX, z + 1.05, 0.007], [-HX + len, z + 1.05 + len * 0.45, 0.007], [-HX + len, z + len * 0.45, 0.007]],
          0xfff3d6, 0.035)
      }
    }
    // Warm pools under pendants and floor lamps, cool spill in the server room.
    for (const [x, z] of PENDANTS) glow(g, x, z, 2.1, 0xffc878, 0.2, 0.008)
    glow(g, 5.75, -4.6, 1.3, 0xffc878, 0.2, 0.008)
    glow(g, -10.8, -5.2, 2.4, 0x7fd6e6, 0.12, 0.008)
    glow(g, 7.2, -8.1, 1.8, 0x7fb3d4, 0.12, 0.008)
    glow(g, -5.0, -8.2, 1.6, 0x8fb7ff, 0.1, 0.008)
  }

  function pendant(x: number, z: number) {
    const g = piece(x, z, 0.45)
    line(g, [x, z, 2.95], [x, z, 2.3], 0x8a8f98, 1, 0.9)
    box(g, x, z, 0.3, 0.3, 2.12, 0.18, 0xc79a55, { outline: null })
    box(g, x, z, 0.26, 0.26, 2.06, 0.07, 0xffe2a3, { outline: null, flat: true, left: 1, right: 0.95 })
    const p = iso(x, z, 2.05)
    for (const [r, a] of [[16, 0.07], [10, 0.1], [5, 0.16]]) g.circle(p.x, p.y, r).fill({ color: 0xffd38a, alpha: a })
  }

  function lamp(g: Graphics, x: number, z: number, y: number) {
    const p = iso(x, z, y)
    g.circle(p.x, p.y, 4.2).fill({ color: 0xffc66b, alpha: 0.16 })
    g.circle(p.x, p.y, 1.5).fill({ color: 0xffe2a3, alpha: 0.95 })
  }

  function lampPost(g: Graphics, x: number, z: number) {
    box(g, x, z, 0.12, 0.12, 0, 1.08, 0x2f333b, { outline: null })
    box(g, x, z, 0.18, 0.18, 1.08, 0.16, 0xffd88a, { outline: null, left: 1, right: 0.9 })
    const p = iso(x, z, 1.16)
    g.circle(p.x, p.y, 7).fill({ color: 0xffcf7a, alpha: 0.18 })
  }

  function marbleFloor(g: Graphics, [x0, z0, x1, z1]: [number, number, number, number], base = K.marble, seam = K.marbleLine, step = 1.0) {
    floorRect(g, x0, z0, x1, z1, base)
    const vein = rng(Math.round(x0 * 13 + z0 * 29 + step * 7))
    for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
      for (let z = Math.floor(z0 / step) * step; z < z1; z += step) {
        const k = vein()
        const ax = Math.max(x0, x); const az = Math.max(z0, z)
        const bx = Math.min(x1, x + step); const bz = Math.min(z1, z + step)
        if (bx - ax < 0.05 || bz - az < 0.05) continue
        if (k > 0.6) floorRect(g, ax, az, bx, bz, k > 0.82 ? 0xffffff : 0x000000, k > 0.82 ? 0.16 : 0.035)
        if (k < 0.3) line(g, [ax + (bx - ax) * 0.15, az + (bz - az) * (0.2 + k), 0], [ax + (bx - ax) * 0.85, az + (bz - az) * (0.9 - k), 0], seam, 0.5, 0.45)
      }
    }
    for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) line(g, [x, z0, 0], [x, z1, 0], seam, 0.7, 0.8)
    for (let z = Math.ceil(z0 / step) * step; z < z1; z += step) line(g, [x0, z, 0], [x1, z, 0], seam, 0.7, 0.8)
  }

  function woodFloor(g: Graphics, [x0, z0, x1, z1]: [number, number, number, number], base: number) {
    floorRect(g, x0, z0, x1, z1, base)
    // Individual planks vary a little in tone, which is most of what makes wood read as wood.
    const tone = rng(Math.round(x0 * 31 + z0 * 17))
    let band = 0
    for (let z = z0; z < z1 - 0.01; z += 0.28, band++) {
      for (let x = x0 - 1.8 + (band % 3) * 0.6 + 0.4; x < x1; x += 1.8) {
        const k = tone()
        if (k < 0.55) continue
        floorRect(g, Math.max(x0, x), z, Math.min(x1, x + 1.8), Math.min(z1, z + 0.28),
          k > 0.8 ? shade(base, 1.09) : shade(base, 0.92), 0.55)
      }
    }
    const seam = shade(base, 0.8)
    let row = 0
    for (let z = z0 + 0.28; z < z1; z += 0.28, row++) {
      line(g, [x0, z, 0], [x1, z, 0], seam, 0.6, 0.55)
      for (let x = x0 + (row % 3) * 0.6 + 0.4; x < x1; x += 1.8) {
        line(g, [x, z - 0.28, 0], [x, z, 0], seam, 0.6, 0.45)
      }
    }
  }

  function checkerFloor(g: Graphics, [x0, z0, x1, z1]: [number, number, number, number], a: number, b: number, step = 0.6) {
    floorRect(g, x0, z0, x1, z1, a)
    let i = 0
    for (let x = x0; x < x1 - 0.01; x += step, i++) {
      let j = 0
      for (let z = z0; z < z1 - 0.01; z += step, j++) {
        if ((i + j) % 2) floorRect(g, x, z, Math.min(x1, x + step), Math.min(z1, z + step), b)
      }
    }
  }

  function roomFloor(g: Graphics, r: Room) {
    switch (r.id) {
      case 'lobby': return marbleFloor(g, r.box, 0xeee7da, 0xd8ccb8, 1.2)
      case 'cs': return marbleFloor(g, r.box, 0xe2e7e8, 0xcbd3d6, 0.8)
      case 'server': return marbleFloor(g, r.box, 0x3b4350, 0x2c323c, 0.6)
      case 'security': return marbleFloor(g, r.box, 0x45505e, 0x3a444f, 0.9)
      case 'pantry': return checkerFloor(g, r.box, 0xece3d3, 0xd8c8af)
      case 'meeting': return woodFloor(g, r.box, 0x9a6640)
      default: return woodFloor(g, r.box, K.wood)
    }
  }

  function rugs(g: Graphics) {
    const rug = (x0: number, z0: number, x1: number, z1: number, color: number) => {
      floorRect(g, x0, z0, x1, z1, color, 1, 0.004)
      floorRect(g, x0 + 0.12, z0 + 0.12, x1 - 0.12, z1 - 0.12, shade(color, 1.18), 0.35, 0.005)
      floorRect(g, x0 + 0.26, z0 + 0.26, x1 - 0.26, z1 - 0.26, color, 1, 0.0055)
      // Soft shadow along the two far edges so the rug sits on the floor instead of in it.
      floorRect(g, x0, z1, x1 + 0.07, z1 + 0.07, 0x000000, 0.14, 0.004)
      floorRect(g, x1, z0 + 0.07, x1 + 0.07, z1, 0x000000, 0.14, 0.004)
    }
    rug(-7.1, 3.95, -2.7, 8.55, K.navy)
    rug(-2.25, 3.95, 3.25, 8.55, 0x8b586c)
    rug(-8.1, -7.95, -1.9, -3.3, K.navy)
    rug(9.3, -7.9, 12.75, -3.45, K.navy)
    rug(-0.9, -5.15, 4.9, -2.75, 0xc9d7de)
    rug(4.55, 4.0, 7.85, 7.2, 0x34425a)
    rug(-12.1, 3.3, -10.3, 5.9, 0xd9cdb8)
    floorEllipse(g, -8.9, 6.0, 0.95, 0xcab89c, 0.9, 0.004)
    floorEllipse(g, 10.6, 5.6, 1.6, 0xe2d6c2, 0.7, 0.004)
  }

  /** Painted guides on the customer-service floor: chevrons toward the counter and a stop line. */
  function decals(g: Graphics) {
    for (const z of [-7.0, -6.2, -5.4]) {
      line(g, [1.55, z + 0.22, 0.01], [2.0, z, 0.01], 0x6fa5c0, 2, 0.75)
      line(g, [2.0, z, 0.01], [2.45, z + 0.22, 0.01], 0x6fa5c0, 2, 0.75)
    }
    floorRect(g, -0.55, -4.45, 4.55, -4.38, 0xf0d98a, 0.8, 0.012)
  }

  function windowWall(g: Graphics, plane: 'x' | 'z', fixed: number, from: number, to: number, h: number, seed: number) {
    const quad = (a: number, b: number, y0: number, y1: number, color: number, alpha = 1) => {
      if (plane === 'z') wallZ(g, fixed, a, b, y0, y1, color, alpha)
      else wallX(g, fixed, a, b, y0, y1, color, alpha)
    }
    const bands = 7
    for (let i = 0; i < bands; i++) {
      const y0 = 0.12 + (i / bands) * (h - 0.12)
      const y1 = 0.12 + ((i + 1) / bands) * (h - 0.12)
      quad(from, to, y0, y1, mix(0xd6ebf7, 0x7fb6e3, i / (bands - 1)))
    }
    const rnd = rng(seed)
    for (const layer of [{ color: 0xa6c5df, min: 1.0, span: 1.5, alpha: 0.9 }, { color: 0x7d9fc4, min: 0.5, span: 1.1, alpha: 1 }]) {
      let u = from
      while (u < to) {
        const w = 0.45 + rnd() * 1.05
        const top = 0.12 + layer.min + rnd() * layer.span
        const b = Math.min(to, u + w)
        quad(u, b, 0.12, top, layer.color, layer.alpha)
        if (layer.alpha === 1) {
          for (let wy = 0.3; wy < top - 0.15; wy += 0.22) {
            for (let wu = u + 0.08; wu < b - 0.1; wu += 0.18) {
              if (rnd() < 0.28) quad(wu, wu + 0.07, wy, wy + 0.09, 0xfff0bf, 0.75)
            }
          }
        }
        u = b + rnd() * 0.25
      }
    }
    quad(from, to, 0.12, h, 0xffffff, 0.08)
    // Roller blinds, lowered by different amounts on roughly half of the bays.
    const blind = rng(seed * 7 + 3)
    for (let u = from + 0.07; u < to - 1.2; u += 1.3) {
      if (blind() > 0.5) continue
      const drop = 0.5 + blind() * 1.0
      const b = Math.min(to, u + 1.16)
      quad(u, b, h - drop, h - 0.12, 0xf1e8d6, 0.93)
      for (let y = h - 0.22; y > h - drop; y -= 0.1) quad(u, b, y, y + 0.014, 0xcfc3ad, 0.75)
      quad(u, b, h - drop, h - drop + 0.045, 0xb4a68c)
    }
    for (let u = from; u <= to + 0.001; u += 1.3) quad(u, Math.min(to, u + 0.07), 0, h, 0x3a414b)
    quad(from, to, h - 0.12, h, 0x3a414b)
    quad(from, to, 0, 0.14, 0x4a515c)
  }

  function desk(x: number, z: number, seed: number, top = K.walnutTop, monitors = 2): Graphics[] {
    const c = group(x, z)
    const g = new Graphics()
    shadow(g, x, z, 1.32, 0.68, 0.34)
    box(g, x - 0.6, z, 0.06, 0.58, 0, 0.7, K.frame, { outline: null })
    box(g, x + 0.6, z, 0.06, 0.58, 0, 0.7, K.frame, { outline: null })
    box(g, x, z - 0.26, 1.18, 0.03, 0.3, 0.35, shade(K.frame, 1.2), { outline: null })
    box(g, x, z, 1.32, 0.68, 0.7, 0.05, top)
    for (const dz of [-0.18, 0.02, 0.2]) {
      line(g, [x - 0.62, z + dz, 0.752], [x + 0.62, z + dz, 0.752], shade(top, 0.86), 0.5, 0.45)
    }
    const offsets = monitors === 2 ? [-0.27, 0.27] : [0]
    for (const dx of offsets) {
      box(g, x + dx, z - 0.2, 0.06, 0.06, 0.75, 0.12, 0x2a2d33, { outline: null })
      box(g, x + dx, z - 0.22, 0.5, 0.035, 0.86, 0.33, K.monitor, { outline: 0x0c0e11 })
    }
    floorRect(g, x - 0.22, z + 0.03, x + 0.22, z + 0.17, 0x2a2e35, 1, 0.752)
    floorEllipse(g, x + 0.36, z + 0.1, 0.035, 0x2a2e35, 1, 0.752)
    const pick = seed % 3
    if (pick === 0) {
      box(g, x - 0.5, z - 0.12, 0.13, 0.13, 0.75, 0.12, K.pot)
      leaves(g, x - 0.5, z - 0.12, 0.87, 0.45)
    } else if (pick === 1) {
      box(g, x + 0.52, z + 0.02, 0.08, 0.08, 0.75, 0.1, [0xd9604f, 0x4f8fc0, 0xe0b04a][seed % 3])
    } else {
      floorRect(g, x - 0.58, z - 0.05, x - 0.36, z + 0.2, 0xf4f1ea, 1, 0.753)
    }
    c.addChild(g)
    const out: Graphics[] = []
    for (const dx of offsets) {
      const s = new Graphics()
      wallZ(s, z - 0.22 + 0.0185, x + dx - 0.225, x + dx + 0.225, 0.885, 1.165, 0xffffff)
      s.tint = 0x2b3a48
      c.addChild(s)
      out.push(s)
      const ui = new Graphics()
      const zf = z - 0.22 + 0.019
      for (let k = 0; k < 3; k++) {
        const y = 1.12 - k * 0.07
        line(ui, [x + dx - 0.18, zf, y], [x + dx - 0.18 + 0.12 + ((seed + k * 5) % 4) * 0.06, zf, y], 0x0b1a24, 1.1, 0.35)
      }
      c.addChild(ui)
    }
    return out
  }

  function chair(x: number, z: number, facing: number, color: number) {
    const sx = Math.sin(facing)
    const sz = Math.cos(facing)
    const g = piece(x, z, -0.22 * (sx + sz))
    floorEllipse(g, x, z, 0.26, 0x000000, 0.16, 0.002)
    box(g, x, z, 0.05, 0.05, 0.05, 0.34, 0x1d2025, { outline: null })
    const bx = x - sx * 0.21
    const bz = z - sz * 0.21
    const side = Math.abs(sx) > Math.abs(sz)
    // Low backrest: from behind it hides the seated body, never the (big chibi) head.
    const backPiece = () => box(g, bx, bz, side ? 0.08 : 0.46, side ? 0.46 : 0.08, 0.44, 0.3, shade(color, 1.08))
    const seat = () => box(g, x, z, 0.48, 0.48, 0.38, 0.09, color)
    if (bx + bz < x + z) { backPiece(); seat() } else { seat(); backPiece() }
  }

  function leaves(g: Graphics, x: number, z: number, y: number, s: number) {
    const p = iso(x, z, y)
    const blobs: [number, number, number, number][] = [
      [0, -10, 9, K.leafDark], [-7, -7, 7, K.leaf], [7, -7, 7, K.leaf],
      [-4, -16, 7, K.leaf], [5, -15, 7, K.leafLight], [0, -21, 6, K.leafLight],
    ]
    for (const [dx, dy, r, c] of blobs) g.circle(p.x + dx * s, p.y + dy * s, r * s).fill(c)
    g.circle(p.x + 2 * s, p.y - 19 * s, 2.4 * s).fill({ color: 0xffffff, alpha: 0.18 })
  }

  function plant(x: number, z: number, s = 1, kind: 'bush' | 'tree' = 'bush') {
    const g = piece(x, z)
    floorEllipse(g, x, z, 0.24 * s, 0x000000, 0.16, 0.002)
    const potH = kind === 'tree' ? 0.42 * s : 0.34 * s
    box(g, x, z, 0.32 * s, 0.32 * s, 0, potH, kind === 'tree' ? K.terracotta : K.pot)
    if (kind === 'tree') {
      line(g, [x, z, potH], [x, z, potH + 0.7 * s], 0x6b4a30, 2.2 * s)
      leaves(g, x, z, potH + 0.55 * s, 1.35 * s)
    } else {
      leaves(g, x, z, potH - 0.04, 0.95 * s)
    }
  }

  function sofa(x: number, z: number, len: number, along: 'x' | 'z', facing: number, color: number) {
    const g = piece(x, z)
    const w = along === 'x' ? len : 0.82
    const d = along === 'x' ? 0.82 : len
    shadow(g, x, z, w, d, 0.3)
    const sx = Math.round(Math.sin(facing))
    const sz = Math.round(Math.cos(facing))
    const bx = x - sx * 0.31
    const bz = z - sz * 0.31
    const backW = along === 'x' ? len : 0.2
    const backD = along === 'x' ? 0.2 : len
    const backFirst = bx + bz < x + z
    const backrest = () => box(g, bx, bz, backW, backD, 0.4, 0.42, shade(color, 0.95))
    if (backFirst) backrest()
    box(g, x, z, w, d, 0.08, 0.34, color)
    const cushions = Math.max(2, Math.round(len / 0.75))
    for (let k = 1; k < cushions; k++) {
      const t = -len / 2 + (len / cushions) * k
      if (along === 'x') line(g, [x + t, z - 0.38, 0.42], [x + t, z + 0.38, 0.42], shade(color, 0.8), 0.8)
      else line(g, [x - 0.38, z + t, 0.42], [x + 0.38, z + t, 0.42], shade(color, 0.8), 0.8)
    }
    if (!backFirst) backrest()
    for (const e of [-1, 1]) {
      if (along === 'x') box(g, x + e * (len / 2 - 0.09), z, 0.18, 0.82, 0.08, 0.52, shade(color, 0.92))
      else box(g, x, z + e * (len / 2 - 0.09), 0.82, 0.18, 0.08, 0.52, shade(color, 0.92))
    }
    box(g, x, z, w * 0.96, d * 0.96, 0, 0.08, 0x3b3530, { outline: null })
    floorRect(g, x + sx * 0.1 - 0.12, z + sz * 0.1 - 0.12, x + sx * 0.1 + 0.12, z + sz * 0.1 + 0.12, 0x4f78a8, 0.85, 0.47)
  }

  function roundTable(x: number, z: number, r: number, color: number, h: number) {
    const g = piece(x, z)
    floorEllipse(g, x, z, r * 0.8, 0x000000, 0.15, 0.002)
    box(g, x, z, 0.08, 0.08, 0, h, 0x2e2a27, { outline: null })
    floorEllipse(g, x, z, r, shade(color, 0.75), 1, h - 0.03)
    floorEllipse(g, x, z, r, color, 1, h)
  }

  function stool(x: number, z: number) {
    const g = piece(x, z)
    box(g, x, z, 0.05, 0.05, 0, 0.6, 0x2e2a27, { outline: null })
    floorEllipse(g, x, z, 0.17, 0x7c5636, 1, 0.6)
    floorEllipse(g, x, z, 0.17, 0x9a6b44, 1, 0.64)
  }

  function bench(x: number, z: number, len: number, along: 'x' | 'z') {
    const g = piece(x, z)
    const w = along === 'x' ? len : 0.42
    const d = along === 'x' ? 0.42 : len
    shadow(g, x, z, w, d, 0.26)
    box(g, x, z, w * 0.9, d * 0.9, 0, 0.38, 0x3b3f46, { outline: null })
    box(g, x, z, w, d, 0.38, 0.07, K.walnutTop)
  }

  function dispenser(x: number, z: number) {
    const g = piece(x, z)
    shadow(g, x, z, 0.32, 0.32, 0.28)
    box(g, x, z, 0.32, 0.32, 0, 0.95, 0xe8ecef)
    box(g, x, z, 0.24, 0.24, 0.95, 0.36, 0x8fc9ef, { alpha: 0.75 })
  }

  function floorLamp(x: number, z: number) {
    const g = piece(x, z)
    box(g, x, z, 0.04, 0.04, 0, 1.45, 0x2f333b, { outline: null })
    box(g, x, z, 0.3, 0.3, 1.45, 0.24, 0xf4dfb4, { left: 1, right: 0.92 })
    const p = iso(x, z, 1.55)
    g.circle(p.x, p.y, 12).fill({ color: 0xffd38a, alpha: 0.14 })
  }

  function bookshelf(x: number, z: number, w: number, plane: 'x' | 'z' = 'z') {
    const g = piece(x, z)
    shadow(g, x, z, plane === 'z' ? w : 0.3, plane === 'z' ? 0.3 : w, 0.4, 0.12)
    const rnd = rng(Math.round(x * 13 + z * 7))
    if (plane === 'z') {
      box(g, x, z, w, 0.3, 0, 1.8, K.walnut)
      for (let s = 0; s < 4; s++) {
        const y0 = 0.12 + s * 0.42
        let u = x - w / 2 + 0.06
        while (u < x + w / 2 - 0.1) {
          const bw = 0.05 + rnd() * 0.06
          wallZ(g, z + 0.151, u, u + bw, y0, y0 + 0.26 + rnd() * 0.08, [0xc0504d, 0x4f81bd, 0xe6b450, 0x6aa36b, 0xe9e2d0][Math.floor(rnd() * 5)])
          u += bw + 0.01
        }
      }
    } else {
      box(g, x, z, 0.3, w, 0, 1.8, K.walnut)
      for (let s = 0; s < 4; s++) {
        const y0 = 0.12 + s * 0.42
        let u = z - w / 2 + 0.06
        while (u < z + w / 2 - 0.1) {
          const bw = 0.05 + rnd() * 0.06
          wallX(g, x + 0.151, u, u + bw, y0, y0 + 0.26 + rnd() * 0.08, [0xc0504d, 0x4f81bd, 0xe6b450, 0x6aa36b, 0xe9e2d0][Math.floor(rnd() * 5)])
          u += bw + 0.01
        }
      }
    }
  }

  /** Free-standing board facing +z: a sticky-note kanban or a chart. */
  function board(x: number, z: number, w: number, kind: 'sticky' | 'chart') {
    const g = piece(x, z)
    shadow(g, x, z, w, 0.08, 0.3, 0.1)
    for (const e of [-1, 1]) box(g, x + e * (w / 2 - 0.04), z, 0.05, 0.05, 0, 0.85, 0x5f6670, { outline: null })
    wallZ(g, z, x - w / 2, x + w / 2, 0.8, 1.85, 0xd3d8dd)
    wallZ(g, z + 0.005, x - w / 2 + 0.05, x + w / 2 - 0.05, 0.85, 1.8, 0xfbfbf8)
    const rnd = rng(Math.round(x * 31))
    if (kind === 'sticky') {
      for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 3; row++) {
          if (rnd() < 0.25) continue
          const u = x - w / 2 + 0.12 + col * ((w - 0.2) / 4)
          const y = 1.55 - row * 0.26
          wallZ(g, z + 0.01, u, u + 0.16, y, y + 0.17, [0xf7d65c, 0xf59ab0, 0x8fd1f0, 0xa7e08b][Math.floor(rnd() * 4)])
        }
      }
    } else {
      for (let k = 0; k < 6; k++) {
        const u = x - w / 2 + 0.14 + k * ((w - 0.26) / 6)
        const top = 0.95 + 0.15 + rnd() * 0.6
        wallZ(g, z + 0.01, u, u + 0.09, 0.95, top, [0x4f81bd, 0xe0655f, 0x6aa36b][k % 3])
      }
    }
  }

  /** Wall-mounted dark screen on a north wall: scrolling code or a dashboard. */
  function screenWall(x: number, z: number, w: number, kind: 'code' | 'chart') {
    const g = piece(x, z)
    wallZ(g, z, x - w / 2, x + w / 2, 0.95, 2.35, 0x0e1522)
    wallZ(g, z + 0.004, x - w / 2 + 0.06, x + w / 2 - 0.06, 1.01, 2.29, 0x15213a)
    const rnd = rng(Math.round(x * 17))
    if (kind === 'code') {
      for (let y = 2.18; y > 1.1; y -= 0.09) {
        const indent = Math.floor(rnd() * 3) * 0.12
        const len = 0.3 + rnd() * (w - 0.9)
        line(g, [x - w / 2 + 0.18 + indent, z + 0.01, y], [x - w / 2 + 0.18 + indent + len, z + 0.01, y],
          [0x7fd6c6, 0xf2c46b, 0xa9b8ff, 0xd3dae6][Math.floor(rnd() * 4)], 1.3, 0.85)
      }
    } else {
      for (let k = 0; k < 7; k++) {
        const u = x - w / 2 + 0.2 + k * 0.28
        wallZ(g, z + 0.01, u, u + 0.16, 1.1, 1.3 + rnd() * 0.8, [0x8b6cf0, 0xe05fa8, 0x58c7f0][k % 3])
      }
    }
  }

  function easel(x: number, z: number) {
    const g = piece(x, z)
    line(g, [x - 0.25, z, 0], [x, z - 0.1, 1.6], 0x7a5a3c, 1.6)
    line(g, [x + 0.25, z, 0], [x, z - 0.1, 1.6], 0x7a5a3c, 1.6)
    wallZ(g, z + 0.02, x - 0.32, x + 0.32, 0.8, 1.45, 0xfaf7f0)
    wallZ(g, z + 0.025, x - 0.26, x + 0.05, 0.9, 1.2, 0xe58fa0, 0.9)
    wallZ(g, z + 0.025, x - 0.05, x + 0.25, 1.05, 1.38, 0x7fc0e0, 0.9)
  }

  function rack(x: number, z: number, plane: 'x' | 'z') {
    const g = piece(x, z)
    const a = new Graphics()
    const b = new Graphics()
    const rnd = rng(Math.round(x * 11 + z * 5))
    shadow(g, x, z, plane === 'z' ? 0.62 : 0.9, plane === 'z' ? 0.9 : 0.62, 0.5, 0.2)
    if (plane === 'z') {
      box(g, x, z, 0.62, 0.9, 0, 2.05, 0x232830)
      for (let y = 0.25; y < 1.95; y += 0.21) {
        wallZ(g, z + 0.451, x - 0.26, x + 0.26, y, y + 0.15, 0x313844)
        const t = rnd() < 0.5 ? a : b
        wallZ(t, z + 0.452, x - 0.22, x - 0.17, y + 0.05, y + 0.1, rnd() < 0.7 ? 0x55e39a : 0x5ab8ff)
        wallZ(t, z + 0.452, x + 0.12, x + 0.16, y + 0.05, y + 0.1, 0xf3c45a)
      }
    } else {
      box(g, x, z, 0.9, 0.62, 0, 2.05, 0x232830)
      for (let y = 0.25; y < 1.95; y += 0.21) {
        wallX(g, x + 0.451, z - 0.26, z + 0.26, y, y + 0.15, 0x313844)
        const t = rnd() < 0.5 ? a : b
        wallX(t, x + 0.452, z - 0.22, z - 0.17, y + 0.05, y + 0.1, rnd() < 0.7 ? 0x55e39a : 0x5ab8ff)
        wallX(t, x + 0.452, z + 0.12, z + 0.16, y + 0.05, y + 0.1, 0xf3c45a)
      }
    }
    const c = group(x, z, 0.01)
    c.addChild(a, b)
    leds.push(a, b)
  }
}

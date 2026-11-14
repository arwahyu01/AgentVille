/** Chibi figure for the 2D office: big head, small body, a name plate at the feet and a speech
 *  bubble above the head. Look is deterministic per agent (id + role), never random per frame. */
import { Container, Graphics, Rectangle, Text } from 'pixi.js'
import { HAIR, ROLE_SHIRT, SKIN, STATUS_DOT, TROUSERS, UNIFORM } from '../office/palette'
import type { Agent } from '../../types'
import type { ActionKind } from './actions'
import { hex, shade } from './draw'

export interface AvatarLook {
  skin: number
  hair: number
  shirt: number
  trousers: number
  shoes: number
  /** 0 short · 1 long · 2 bun · 3 side part · 4 bald. */
  hairStyle: number
  cap: number | null
  glasses: boolean
}

export function lookForAgent(agent: Pick<Agent, 'id' | 'role'>): AvatarLook {
  const seed = Math.abs(agent.id)
  const uniform = (UNIFORM as Record<string, { shirt: string; cap: string } | undefined>)[agent.role]
  return {
    skin: hex(SKIN[(seed * 7) % SKIN.length]),
    hair: hex(HAIR[(seed * 3) % HAIR.length]),
    shirt: hex(uniform?.shirt ?? ROLE_SHIRT[agent.role] ?? '#5b7fa6'),
    trousers: hex(TROUSERS[seed % TROUSERS.length]),
    shoes: 0x2b2f36,
    hairStyle: uniform ? 0 : (seed * 5 + 1) % 5,
    cap: uniform ? hex(uniform.cap) : null,
    glasses: seed % 4 === 1,
  }
}

/** Claude Code sessions wear Claude's coral, with a face picked from the session id. */
export const CLAUDE_CORAL = 0xd97757

export function lookForClaude(sessionId: string): AvatarLook {
  let h = 0
  for (const ch of sessionId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return {
    skin: hex(SKIN[h % SKIN.length]),
    hair: hex(HAIR[(h >>> 3) % HAIR.length]),
    shirt: CLAUDE_CORAL,
    trousers: 0x3a3330,
    shoes: 0x2b2f36,
    hairStyle: (h >>> 5) % 5,
    cap: null,
    glasses: (h >>> 7) % 3 === 0,
  }
}

export type BubbleStyle = 'event' | 'social'
export type AlertKind = 'waiting' | 'failed' | null

const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif'
const TEXT_RES = 4

/** Height of the figure in local pixels at scale 1 (feet at 0, crown at -FIGURE_H). */
export const FIGURE_H = 46

export interface PoseInput {
  front: boolean
  flip: boolean
  /** 0 standing … 1 seated. */
  sit: number
  moving: boolean
  phase: number
  typing: boolean
  talking: boolean
}

export class Avatar {
  readonly root = new Container()
  private readonly figure = new Container()
  private readonly shadow = new Graphics()
  private readonly ring = new Graphics()
  private readonly legL = new Graphics()
  private readonly legR = new Graphics()
  private readonly torso = new Container()
  private readonly armL = new Graphics()
  private readonly armR = new Graphics()
  private readonly body = new Graphics()
  private readonly headFront = new Container()
  private readonly headBack = new Container()
  private readonly label = new Container()
  private readonly labelBg = new Graphics()
  private readonly dot = new Graphics()
  private readonly nameText: Text
  private readonly tagText: Text
  private readonly bubble = new Container()
  private readonly bubbleBg = new Graphics()
  private readonly bubbleText: Text
  private readonly alert = new Container()
  private readonly alertBg = new Graphics()
  private readonly alertText: Text
  private size = 1
  private lastLabel = ''
  private lastBubble = ''
  private lastAlert: AlertKind = null
  private lastRing = ''

  constructor(look: AvatarLook, onTap?: () => void) {
    this.root.addChild(this.ring, this.shadow, this.figure, this.label, this.alert, this.bubble)
    this.shadow.ellipse(0, 0, 10, 3.8).fill({ color: 0x000000, alpha: 0.24 })

    for (const [leg, x] of [[this.legL, -3.2], [this.legR, 3.2]] as const) {
      leg.roundRect(x - 2.4, -10, 4.8, 9, 1.6).fill(look.trousers)
      leg.roundRect(x - 2.7, -2.4, 5.4, 2.6, 1.2).fill(look.shoes)
    }
    this.body.roundRect(-7.5, -24, 15, 15.5, 5).fill(look.shirt)
    this.body.roundRect(-7.5, -11.5, 15, 3, 1.5).fill(shade(look.trousers, 0.9))
    this.body.moveTo(-3, -23.5).lineTo(0, -20).lineTo(3, -23.5).stroke({ color: shade(look.shirt, 0.72), width: 1.1 })
    for (const [arm, x] of [[this.armL, -8.6], [this.armR, 8.6]] as const) {
      arm.roundRect(-2, 0, 4, 10.5, 2).fill(shade(look.shirt, 0.88))
      arm.circle(0, 11.2, 2.1).fill(look.skin)
      arm.position.set(x, -22.5)
    }
    this.torso.addChild(this.armL, this.body, this.armR)

    this.buildHead(this.headFront, look, true)
    this.buildHead(this.headBack, look, false)
    this.figure.addChild(this.legL, this.legR, this.torso, this.headFront, this.headBack)

    this.nameText = new Text({ text: '', resolution: TEXT_RES, style: { fontFamily: FONT, fontSize: 7, fontWeight: '700', fill: 0xffffff } })
    this.tagText = new Text({ text: '', resolution: TEXT_RES, style: { fontFamily: FONT, fontSize: 6, fontWeight: '600', fill: 0xaab6c4 } })
    this.nameText.anchor.set(0, 0.5)
    this.tagText.anchor.set(0, 0.5)
    this.label.addChild(this.labelBg, this.dot, this.nameText, this.tagText)
    this.label.y = 9

    this.bubbleText = new Text({ text: '', resolution: TEXT_RES, style: { fontFamily: FONT, fontSize: 7, fontWeight: '600', fill: 0x1f2a36 } })
    this.bubbleText.anchor.set(0, 0.5)
    this.bubble.addChild(this.bubbleBg, this.bubbleText)
    this.bubble.visible = false

    this.alertText = new Text({ text: '!', resolution: TEXT_RES, style: { fontFamily: FONT, fontSize: 9, fontWeight: '800', fill: 0xffffff } })
    this.alertText.anchor.set(0.5)
    this.alert.addChild(this.alertBg, this.alertText)
    this.alert.visible = false

    if (onTap) {
      this.root.eventMode = 'static'
      this.root.cursor = 'pointer'
      this.root.hitArea = new Rectangle(-13, -FIGURE_H - 4, 26, FIGURE_H + 22)
      this.root.on('pointertap', onTap)
    }
  }

  private buildHead(c: Container, look: AvatarLook, front: boolean) {
    const g = new Graphics()
    const cy = -33
    if (look.hairStyle === 1) g.roundRect(-10.5, cy - 7, 21, front ? 16 : 19, 7).fill(look.hair)
    g.rect(-2.2, -25, 4.4, 3).fill(shade(look.skin, 0.9))
    g.circle(0, cy, 10).fill(look.skin)
    if (front) {
      g.circle(-9.8, cy + 1, 2).fill(shade(look.skin, 0.92))
      g.circle(9.8, cy + 1, 2).fill(shade(look.skin, 0.92))
    }
    const hair = look.cap ?? look.hair
    if (look.hairStyle !== 4 || look.cap) {
      if (front) {
        g.ellipse(0, cy - 5.2, 10.6, 6.6).fill(hair)
        if (!look.cap) {
          g.ellipse(-8.2, cy - 1, 2.8, 4.8).fill(hair)
          g.ellipse(8.2, cy - 1, 2.8, 4.8).fill(hair)
          if (look.hairStyle === 3) g.ellipse(3.5, cy - 4.5, 5.5, 3).fill(hair)
        }
      } else {
        g.ellipse(0, cy - 0.5, 10.5, 9.8).fill(hair)
        if (look.hairStyle === 1) g.roundRect(-9.5, cy, 19, 10, 5).fill(hair)
      }
      if (look.hairStyle === 2 && !look.cap) g.circle(0, cy - 10.5, 4.6).fill(hair)
    }
    if (look.cap) {
      g.ellipse(0, cy - 6, 10.8, 5.4).fill(look.cap)
      if (front) g.ellipse(0, cy - 2.6, 9.5, 2.4).fill(shade(look.cap, 0.75))
    }
    if (front) {
      g.ellipse(-3.5, cy + 1.6, 1.35, 1.8).fill(0x22262c)
      g.ellipse(3.5, cy + 1.6, 1.35, 1.8).fill(0x22262c)
      g.circle(-3.1, cy + 1.0, 0.45).fill(0xffffff)
      g.circle(3.9, cy + 1.0, 0.45).fill(0xffffff)
      g.circle(-6, cy + 4.6, 1.8).fill({ color: 0xe88a7d, alpha: 0.38 })
      g.circle(6, cy + 4.6, 1.8).fill({ color: 0xe88a7d, alpha: 0.38 })
      g.moveTo(-1.8, cy + 5.4).quadraticCurveTo(0, cy + 6.8, 1.8, cy + 5.4).stroke({ color: 0x9c5a4a, width: 0.9 })
      if (look.glasses) {
        g.circle(-3.5, cy + 1.6, 2.8).stroke({ color: 0x2b3038, width: 0.8 })
        g.circle(3.5, cy + 1.6, 2.8).stroke({ color: 0x2b3038, width: 0.8 })
        g.moveTo(-0.7, cy + 1.4).lineTo(0.7, cy + 1.4).stroke({ color: 0x2b3038, width: 0.8 })
      }
    }
    c.addChild(g)
  }

  /** Figure size multiplier from the "Agen" slider; labels stay readable at every size. */
  setSize(k: number) {
    this.size = k
    this.figure.scale.y = k
    this.shadow.scale.set(k)
    this.ring.scale.set(k)
    this.alert.position.set(10 * k, -(FIGURE_H + 4) * k)
    this.bubble.y = -(FIGURE_H + 10) * k
    if (this.root.hitArea instanceof Rectangle) {
      this.root.hitArea = new Rectangle(-13 * k, -(FIGURE_H + 4) * k, 26 * k, (FIGURE_H + 4) * k + 22)
    }
  }

  setPose(p: PoseInput) {
    const k = this.size
    this.figure.scale.x = (p.flip ? -1 : 1) * k
    this.headFront.visible = p.front
    this.headBack.visible = !p.front
    // Arms sit behind the body when seen from the back so the shirt reads as the back.
    this.torso.setChildIndex(this.body, p.front ? 0 : 2)
    const walk = p.moving ? Math.sin(p.phase) : 0
    const bob = p.moving ? Math.abs(Math.sin(p.phase)) * 1.3 : Math.sin(p.phase * 0.5) * 0.35
    const drop = p.sit * 3.5
    this.legL.y = walk * 1.6
    this.legR.y = -walk * 1.6
    // Seen from behind a seated worker's legs are under the desk; from the front they fold forward.
    const legsShown = p.sit < 0.55 || p.front
    this.legL.visible = legsShown
    this.legR.visible = legsShown
    this.legL.scale.y = 1 - p.sit * 0.55
    this.legR.scale.y = 1 - p.sit * 0.55
    this.torso.y = drop - bob
    this.headFront.y = drop - bob
    this.headBack.y = drop - bob
    let swingL = walk * 0.45
    let swingR = -walk * 0.45
    let liftL = 0
    let liftR = 0
    if (p.typing) {
      const j = Math.sin(p.phase * 3.1) * 0.9
      liftL = -2.5 + j
      liftR = -2.5 - j
      swingL = 0.5
      swingR = -0.5
    } else if (p.talking && !p.moving) {
      swingR = -0.6 + Math.sin(p.phase * 2.2) * 0.25
    }
    this.armL.rotation = swingL
    this.armR.rotation = swingR
    this.armL.y = -22.5 + liftL
    this.armR.y = -22.5 + liftR
  }

  setLabel(name: string, tag: string, status: Agent['status'] | 'staff') {
    const key = `${name}|${tag}|${status}`
    if (key === this.lastLabel) return
    this.lastLabel = key
    this.nameText.text = name
    this.tagText.text = tag
    const pad = 4
    const dotW = 7
    const w = pad + dotW + this.nameText.width + 3 + this.tagText.width + pad
    const x0 = -w / 2
    this.labelBg.clear().roundRect(x0, -5.5, w, 11, 5.5).fill({ color: 0x141c27, alpha: 0.86 })
      .stroke({ color: 0xffffff, alpha: 0.12, width: 0.6 })
    const color = status === 'staff' ? 0xc9d2dc : hex(STATUS_DOT[status])
    this.dot.clear().circle(x0 + pad + 2.5, 0, 2.5).fill(color)
    this.nameText.position.set(x0 + pad + dotW, 0)
    this.tagText.position.set(x0 + pad + dotW + this.nameText.width + 3, 0.3)
  }

  setBubble(text: string | null, style: BubbleStyle = 'event', icon: ActionKind | null = null) {
    const key = text ? `${style}|${icon ?? ''}|${text}` : ''
    if (key === this.lastBubble) return
    this.lastBubble = key
    if (!text) { this.bubble.visible = false; return }
    this.bubble.visible = true
    this.bubbleText.text = text
    this.bubbleText.style.fill = style === 'social' ? 0xf0f8f5 : 0x1f2a36
    const glyph = 7
    const kind = icon
    const w = 5 + glyph + 3 + this.bubbleText.width + 6
    const h = 13
    const x0 = -w / 2
    const bg = style === 'social' ? 0x2f6f6a : 0xffffff
    this.bubbleBg.clear()
      .roundRect(x0, -h, w, h, 5).fill({ color: bg, alpha: 0.96 })
      .stroke({ color: style === 'social' ? 0x9bd8cd : 0xc9d2dc, width: 0.7 })
    this.bubbleBg.poly([-3, -0.5, 3, -0.5, 0, 4]).fill({ color: bg, alpha: 0.96 })
    // A glyph for what the agent is doing (per-tool frames), a chart for other journal lines,
    // a quote bar for local chatter.
    if (style === 'event') {
      const gx = x0 + 5
      if (kind) drawActionGlyph(this.bubbleBg, kind, gx, -h + 3.5, glyph)
      else {
        this.bubbleBg.rect(gx, -h + 3.5, glyph, glyph - 1).fill(0xe8edf5)
        this.bubbleBg.rect(gx + 1, -4.5, 1.4, -2.5).fill(0x4f81bd)
        this.bubbleBg.rect(gx + 3, -4.5, 1.4, -4.5).fill(0xe0655f)
        this.bubbleBg.rect(gx + 5, -4.5, 1.2, -3.5).fill(0x6aa36b)
      }
    } else {
      this.bubbleBg.rect(x0 + 5, -h + 3, 1.6, h - 6).fill(0x9bd8cd)
    }
    this.bubbleText.position.set(x0 + 5 + glyph + 3, -h / 2)
  }

  setAlert(kind: AlertKind) {
    if (kind === this.lastAlert) return
    this.lastAlert = kind
    this.alert.visible = kind !== null
    if (!kind) return
    const color = kind === 'waiting' ? 0xe5534b : 0x8f2f2a
    this.alertBg.clear().circle(0, 0, 5.6).fill(color).stroke({ color: 0xffffff, width: 1 })
    this.alertText.text = kind === 'waiting' ? '!' : '×'
  }

  setSelected(selected: boolean, status: Agent['status'] | 'staff', pulse = 0) {
    const key = `${selected}|${status}|${pulse.toFixed(2)}`
    if (key === this.lastRing) return
    this.lastRing = key
    this.ring.clear()
    const color = status === 'staff' ? 0xc9d2dc : hex(STATUS_DOT[status])
    if (pulse > 0) {
      const r = 12 + (1 - pulse) * 10
      this.ring.ellipse(0, 0, r, r * 0.5).stroke({ color, width: 1.4, alpha: pulse * 0.9 })
    }
    if (selected) {
      this.ring.ellipse(0, 0, 13, 6.5).fill({ color, alpha: 0.22 }).stroke({ color, width: 1.6, alpha: 0.95 })
    }
  }

  destroy() {
    this.root.destroy({ children: true })
  }
}

/** 7×6 px pictogram for a tool kind, drawn at the bubble's top-left (gx, gy). */
function drawActionGlyph(g: Graphics, kind: ActionKind, gx: number, gy: number, size: number) {
  g.roundRect(gx, gy, size, size - 1, 1.2).fill(0xe8edf5)
  const cx = gx + size / 2
  const cy = gy + (size - 1) / 2
  switch (kind) {
    case 'write':
      g.moveTo(gx + 1.4, gy + size - 2).lineTo(gx + size - 1.6, gy + 1.4).stroke({ color: 0xe0a53b, width: 1.7 })
      g.circle(gx + 1.5, gy + size - 1.9, 0.7).fill(0x3b3f46)
      break
    case 'read':
      g.rect(gx + 0.9, gy + 1.3, 2.4, 3.6).fill(0x4f81bd)
      g.rect(gx + 3.7, gy + 1.3, 2.4, 3.6).fill(0x6a9bd1)
      break
    case 'run':
      g.roundRect(gx + 0.4, gy + 0.6, size - 0.8, size - 2.2, 0.8).fill(0x1b2430)
      g.moveTo(gx + 1.6, gy + 1.7).lineTo(gx + 3, gy + 2.9).lineTo(gx + 1.6, gy + 4).stroke({ color: 0x6fe0a0, width: 0.8 })
      g.rect(gx + 3.6, gy + 4, 2, 0.7).fill(0x6fe0a0)
      break
    case 'search':
      g.circle(cx - 0.6, cy - 0.5, 1.9).stroke({ color: 0xe0a53b, width: 1 })
      g.moveTo(cx + 0.9, cy + 1.1).lineTo(gx + size - 0.9, gy + size - 1.9).stroke({ color: 0xe0a53b, width: 1.2 })
      break
    default:
      for (const dx of [-2, 0, 2]) g.circle(cx + dx, cy, 0.7).fill(0x7d6ea8)
  }
}

/** Trim a journal line to one bubble row. */
export function bubbleLine(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

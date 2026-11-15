/** Shared interior palette. The office reads as white/off-white with pale oak and soft
 * accents, so components take their colours from here instead of inventing new hexes. */
export const C = {
  wall: '#f3efe7',
  wallShade: '#e6e0d5',
  trim: '#d6cfc2',
  ceiling: '#faf7f1',
  floor: '#e3dccd',
  floorSeam: '#d5cdbb',
  corridor: '#d6d0c3',
  rug: '#e3ddd1',
  oak: '#cbab7c',
  oakPale: '#dcc294',
  oakDark: '#a8875c',
  white: '#fbf9f5',
  fabric: '#cfd4d8',
  fabricDark: '#a8b2ba',
  seat: '#b9c3c9',
  metal: '#c3c8cc',
  metalDark: '#8b9298',
  plastic: '#e2e0db',
  screenOff: '#243038',
  screenOn: '#dfeef0',
  screenUi: '#7fb7bd',
  leafDark: '#4f7f5c',
  leafLight: '#6fa27a',
  pot: '#d8cbb8',
  soil: '#6b5a48',
  glass: '#cfe3e8',
  sky: '#dbeaf5',
  paper: '#f7f4ee',
  accentWarm: '#d9b38c',
}

/** Screen glow per agent status — the beacon colour, kept muted so it never reads as neon. */
export const STATUS_GLOW = {
  idle: '#8fa0ad',
  working: '#4fa08c',
  waiting: '#c0a068',
  reviewing: '#9b8fc0',
  completed: '#6fae94',
  failed: '#c0706c',
} as const

export const STATUS_DOT = {
  idle: '#a7b4c0',
  working: '#49c08f',
  waiting: '#e0ac5c',
  reviewing: '#b3a2e0',
  completed: '#63cfc0',
  failed: '#e5726c',
} as const

/** Garments stay mid-tone so figures keep contrast against the white interior. */
export const SHIRT = {
  idle: '#7b8ba0',
  working: '#3f8f9c',
  waiting: '#9a8352',
  reviewing: '#7d6ea8',
  completed: '#4f9a7c',
  failed: '#b05550',
} as const

/** Simulation staff wear distinct uniforms so they never read as project team members. */
export const UNIFORM = {
  Housekeeping: { shirt: '#4e9a6f', cap: '#397553' },
  Security: { shirt: '#3f5578', cap: '#2e405e' },
} as const

/** Everyday clothing is keyed to the role, not the status: a person keeps the same shirt all day,
 *  and the live status stays on the dot, the desk beacon and the floor ring. This is what makes a
 *  figure recognisable across a mode switch instead of a walking traffic light. */
export const ROLE_SHIRT: Record<string, string> = {
  'AI Coordinator': '#3c6b87',
  'Frontend Developer': '#2f8f9c',
  'Backend Developer': '#31767f',
  Developer: '#2f8f9c',
  'QA Engineer': '#4b7f69',
  'Data Analyst': '#5b7fa6',
  Researcher: '#6b8f74',
  'Product Analyst': '#6d7fa0',
  'UI/UX Designer': '#a06b8a',
  'Content Creator': '#b07f5f',
  Administrator: '#9a8a5c',
  Reviewer: '#7f6ea8',
  'Marketing Strategist': '#c0764f',
  Copywriter: '#b8946a',
  'Fact-Checker': '#5f8f9a',
  'Tech Lead': '#5a7aa6',
}

/** A service-desk vest, worn by whoever the backend actually stationed in Customer Service. */
export const TELLER_VEST = { body: '#2f4f66', trim: '#e8ddc6' }

/** Front-of-house staff who greet guests. These are scene extras (not backend agents), so their
 *  look is fixed fit-out rather than derived from agent rows. */
export const SERVICE = {
  greeter: { blazer: '#2f4f66', blouse: '#f4f0e8', skirt: '#39485a', trim: '#e8ddc6', heels: '#2b3036', tights: '#d9b79a' },
  teller: { blazer: '#31525f', blouse: '#eef1ec', skirt: '#333f4c', trim: '#d8cdb4', heels: '#262b31', tights: '#d8b699' },
} as const

export const EARRING = '#d9b56a'
export const LASH = '#2a2320'

export const TROUSERS = ['#4a5462', '#5b5a55', '#43505c', '#574f4a'] as const
export const SKIN = ['#d8a97f', '#c08e63', '#a2734c', '#e8c39c'] as const
export const HAIR = ['#2f2a28', '#4a3524', '#1f2229', '#6b4a2f', '#8b8378'] as const

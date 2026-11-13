// Headless render verifier for the AgentVille office scene.
// Usage: node scripts/shot.mjs <out.png> [--url=...] [--w=1600] [--h=900] [--wait=25]
//        [--click="text1,text2"]  click buttons (in order) after initial wait, by trimmed text
//        [--eval="js expression"] run after wait, logs result
//        [--probe]                log canvas non-blank ratio + console errors
// Requires Chrome/Edge; uses SwiftShader so WebGL works without a GPU.
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : def
}
const out = process.argv[2]
if (!out || out.startsWith('--')) { console.error('missing output png path'); process.exit(1) }
const url = arg('url', 'http://127.0.0.1:5173/')
const w = Number(arg('w', 1600)); const h = Number(arg('h', 900))
const waitS = Number(arg('wait', 25))
const clicks = arg('click', '').split(',').map((s) => s.trim()).filter(Boolean)
const evalExpr = arg('eval', '')
const probe = process.argv.includes('--probe')
const port = 9333

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const exe = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!exe) { console.error('no chrome/edge found'); process.exit(1) }

const profile = mkdtempSync(join(tmpdir(), 'avshot-'))
const chrome = spawn(exe, [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill() } catch {} })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
for (let i = 0; i < 60; i++) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break }
  } catch {}
}
if (!ws) { console.error('chrome devtools never came up'); process.exit(1) }
await new Promise((r) => { ws.onopen = r })

let idc = 0
const pending = new Map()
const consoleErrors = []
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text)
}
const send = (method, params = {}) => new Promise((r) => { const id = ++idc; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  const res = r.result?.result ?? r.result
  if (res?.exceptionDetails) return { error: JSON.stringify(res.exceptionDetails).slice(0, 300) }
  return res?.value
}

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable')
await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(waitS * 1000)

for (const text of clicks) {
  const ok = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)})
    if (b) b.click(); return !!b
  })()`)
  console.log(`click ${JSON.stringify(text)}:`, ok ? 'ok' : 'NOT FOUND')
  await sleep(4000)
}
if (evalExpr) console.log('eval:', JSON.stringify(await evaluate(evalExpr)))

if (probe) {
  const info = await evaluate(`(() => {
    const c = document.querySelector('.office-canvas canvas')
    if (!c) return 'no canvas'
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    if (!gl) return 'no gl ctx'
    const px = new Uint8Array(c.width * c.height * 4)
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
    let distinct = new Set(); let colored = 0
    for (let i = 0; i < px.length; i += 4 * 997) {
      const k = (px[i] >> 3 << 10) | (px[i+1] >> 3 << 5) | (px[i+2] >> 3)
      distinct.add(k)
      if (Math.abs(px[i] - px[i+1]) > 6 || Math.abs(px[i+1] - px[i+2]) > 6) colored++
    }
    return JSON.stringify({ size: [c.width, c.height], distinctColors: distinct.size, coloredSamples: colored,
      debug: gl.getParameter(gl.debugRendererInfo?.UNMASKED_RENDERER_WEBGL ?? 0x1F01) ? 'ok' : '' })
  })()`)
  console.log('probe:', info)
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log('wrote', out)
if (consoleErrors.length) console.log('console errors:\n' + consoleErrors.slice(0, 10).join('\n'))
process.exit(0)

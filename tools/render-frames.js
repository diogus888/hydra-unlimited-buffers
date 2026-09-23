// renders the typewriter performance to a PNG sequence in a headless
// browser, at an exact fps, by driving the page with VIRTUAL time: every
// captured frame advances the page clock by exactly 1/fps, so nothing is
// dropped and the result is fully deterministic. captures the entire
// composited page (visuals + difference boxes + code text), then keeps
// going for a tail of extra seconds after the typewriter finishes.
//
// usage (dev server must be running):
//   node tools/render-frames.js sketch-814b-no-arrows.js
//   node tools/render-frames.js sketch-814b-no-arrows.js --out renders/take2 \
//        --fps 60 --tail 10 --w 1080 --h 1920 --res 1920x1080 \
//        --ms 45 --hold 1500 --holdmid 600 --port 5173
//
// output: <out>/frame_000000.png ... , then e.g.
//   ffmpeg -framerate 60 -i frame_%06d.png -c:v libx264 -pix_fmt yuv420p -crf 16 out.mp4

const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer-core')

/* ----------------------------- config ----------------------------- */

const argv = process.argv.slice(2)
const sketch = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'sketch-814b-no-arrows.js'
const opt = (name, def) => {
  const i = argv.indexOf('--' + name)
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : def
}

const FPS = parseFloat(opt('fps', '60'))
const TAIL_SECONDS = parseFloat(opt('tail', '10'))
// timelapse factor: each output frame advances SPEEDUP/fps of page time,
// so typing, holds AND the visuals all play SPEEDUP times faster
const SPEEDUP = parseFloat(opt('speedup', '1'))
const HIDE_CODE_AT_TAIL = !argv.includes('--keep-code')
const VIEW_W = parseInt(opt('w', '1080'), 10)
const VIEW_H = parseInt(opt('h', '1920'), 10)
const RES = opt('res', '1920x1080')
const PORT = opt('port', '5173')
const MS = opt('ms', '')
const HOLD = opt('hold', '')
const HOLDMID = opt('holdmid', '')
const OUT_DIR = path.resolve(__dirname, '..', opt('out', 'renders/' + sketch.replace(/\.js$/, '') + '-' + Date.now()))
const MAX_VIRTUAL_MINUTES = parseFloat(opt('max-minutes', '15'))

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
]
const chromePath = CHROME_PATHS.find((p) => p && fs.existsSync(p))
if (!chromePath) {
  console.error('could not find chrome.exe — edit CHROME_PATHS in this script')
  process.exit(1)
}

let url = `http://localhost:${PORT}/?typewrite=${encodeURIComponent(sketch)}&res=${RES}`
if (MS) url += `&ms=${MS}`
if (HOLD) url += `&hold=${HOLD}`
if (HOLDMID) url += `&holdmid=${HOLDMID}`

/* ------------------------- virtual time shim ------------------------- */
// installed before any page script runs: all timers, rAF and clocks in the
// page follow a clock that only moves when __vtAdvance(ms) is called

const VT_SHIM = `(() => {
  if (window.__vtInstalled) return
  window.__vtInstalled = true
  let vt = 0
  const epoch = 1700000000000
  const timers = new Map()
  let nextTimerId = 1
  let rafCbs = new Map()
  let nextRafId = 1

  performance.now = () => vt
  Date.now = () => epoch + vt
  const RealDate = Date
  window.Date = class extends RealDate {
    constructor(...a) { a.length ? super(...a) : super(epoch + vt) }
    static now() { return epoch + vt }
  }

  window.setTimeout = (fn, delay = 0, ...args) => {
    const id = nextTimerId++
    if (typeof fn !== 'function') { const c = String(fn); fn = () => eval(c) }
    timers.set(id, { due: vt + Math.max(0, +delay || 0), fn, args, interval: null })
    return id
  }
  window.setInterval = (fn, delay = 16, ...args) => {
    const id = nextTimerId++
    const iv = Math.max(1, +delay || 1)
    timers.set(id, { due: vt + iv, fn, args, interval: iv })
    return id
  }
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id) }
  window.requestAnimationFrame = (fn) => { const id = nextRafId++; rafCbs.set(id, fn); return id }
  window.cancelAnimationFrame = (id) => { rafCbs.delete(id) }

  window.__vtAdvance = (ms) => {
    const target = vt + ms
    let guard = 0
    while (guard++ < 100000) {
      let next = null
      for (const [id, t] of timers) {
        if (t.due <= target && (!next || t.due < next.t.due)) next = { id, t }
      }
      if (!next) break
      vt = Math.max(vt, next.t.due)
      if (next.t.interval) next.t.due = vt + next.t.interval
      else timers.delete(next.id)
      try { next.t.fn(...next.t.args) } catch (e) {}
    }
    vt = target
    const cbs = rafCbs
    rafCbs = new Map()
    for (const [, fn] of cbs) { try { fn(vt) } catch (e) {} }
    return vt
  }
})()`

/* ----------------------------- capture ----------------------------- */

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  console.log('sketch   :', sketch)
  console.log('url      :', url)
  console.log('viewport :', VIEW_W + 'x' + VIEW_H, '  fps:', FPS, '  tail:', TAIL_SECONDS + 's')
  console.log('output   :', OUT_DIR)

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: !argv.includes('--headed'),
    args: [
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--enable-unsafe-swiftshader',
      '--disable-lcd-text',
      `--window-size=${VIEW_W},${VIEW_H}`,
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(VT_SHIM)
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)

  const frameMs = (1000 / FPS) * SPEEDUP
  const SUBSTEPS = Math.max(4, Math.ceil(4 * SPEEDUP)) // chained timeouts still fire in order within a frame

  // warm up (not captured) until the typewriter has cleared the editor:
  // skips page init, the random startup sketch and extension preloading
  console.log('waiting for the typewriter to start...')
  for (let i = 0; i < 3000; i++) {
    await page.evaluate((ms) => window.__vtAdvance(ms), frameMs)
    if (await page.evaluate(() => window.__typewriterStarted === true)) break
    await realSleep(5) // give real network (sketch fetch, extensions) room
  }
  if (!(await page.evaluate(() => window.__typewriterStarted === true))) {
    console.error('typewriter never started — is the dev server running and the sketch in public/?')
    await browser.close()
    process.exit(1)
  }

  console.log('capturing...')
  const maxFrames = Math.ceil(MAX_VIRTUAL_MINUTES * 60 * FPS)
  const tailFrames = Math.ceil(TAIL_SECONDS * FPS)
  let doneAtFrame = -1
  let frame = 0
  const t0 = Date.now()

  while (true) {
    for (let s = 0; s < SUBSTEPS; s++) {
      await page.evaluate((ms) => window.__vtAdvance(ms), frameMs / SUBSTEPS)
    }
    const jpeg = argv.includes('--jpeg')
    const buf = await page.screenshot(jpeg ? { type: 'jpeg', quality: parseInt(opt('quality', '95'), 10) } : { type: 'png' })
    fs.writeFileSync(path.join(OUT_DIR, `frame_${String(frame).padStart(6, '0')}.${jpeg ? 'jpg' : 'png'}`), buf)

    if (doneAtFrame === -1 && (await page.evaluate(() => window.__typewriterDone === true))) {
      doneAtFrame = frame
      console.log(`typewriter finished at frame ${frame} (${(frame / FPS).toFixed(1)}s) — capturing ${TAIL_SECONDS}s tail`)
      if (HIDE_CODE_AT_TAIL) {
        // same effect as ctrl+shift+h: fade out the code + console
        await page.evaluate(() => {
          const cmEl = document.querySelector('.CodeMirror')
          const con = document.querySelector('.console')
          if (cmEl) cmEl.style.opacity = 0
          if (con) con.style.opacity = 0
        })
      }
    }
    if (doneAtFrame !== -1 && frame >= doneAtFrame + tailFrames) break
    if (frame >= maxFrames) {
      console.warn('hit --max-minutes safety limit, stopping')
      break
    }

    frame++
    if (frame % 300 === 0) {
      const real = (Date.now() - t0) / 1000
      console.log(`  frame ${frame}  (virtual ${(frame / FPS).toFixed(1)}s, real ${real.toFixed(0)}s, ${(frame / real).toFixed(1)} fps capture)`)
    }
  }

  await browser.close()
  const total = frame + 1
  console.log(`done: ${total} frames (${(total / FPS).toFixed(1)}s at ${FPS}fps)`)
  console.log('to encode:')
  console.log(`  ffmpeg -framerate ${FPS} -i "${path.join(OUT_DIR, 'frame_%06d.png')}" -c:v libx264 -pix_fmt yuv420p -crf 16 "${path.join(OUT_DIR, 'out.mp4')}"`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

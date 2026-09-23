// typewriter: performs a sketch into the editor like a live coder.
//
// choreography:
//  - `await loadScript(...)` lines are pasted instantly (and preloaded, so
//    stages render without waiting on the network)
//  - the sketch's final speed (window.baseSpeed / speed = ...) is applied
//    silently up front, so visuals run at their intended pace while typing
//  - chains are built skeleton-first: the generator line (osc/src/solid...)
//    is typed, then its .out(oN) right below, evaluated (temporary
//    render(oN)), and then the cursor goes back up and fills in the
//    transform lines between them one by one, re-evaluating as it grows
//  - consts are NOT typed up front: the first time a chain uses one, the
//    cursor jumps to the const area at the top, types the declaration
//    (dependencies first), and jumps back down
//
// usage (browser console):
//   typewriteFile('sketch-814b-no-arrows.js')   // file from public/
//   typewrite(`osc().out()`)                    // raw string
//   typewriteStop()                             // abort
//
// or auto-start via URL:  http://localhost:5173/?typewrite=preset.js
//   extra params: &ms=45 (per char) &hold=1500 (after each out) &holdmid=600
//
// options: { msPerChar, jitter, linePause, holdAfterOut, holdMid,
//            jumpPause, startDelay }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let running = false

/* ------------------------ human typing rhythm ------------------------ */
// keys that sit close together on a QWERTY keyboard come out in fast
// bursts; far reaches, shifted characters and double-handed jumps take
// longer — plus the occasional small hesitation

const KEY_ROWS = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./']
const SHIFT_MAP = {
  '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6',
  '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=',
  '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
}
const KEY_POS = {}
KEY_ROWS.forEach((row, y) => {
  const stagger = [0, 0.5, 0.75, 1.25][y]
  row.split('').forEach((k, x) => { KEY_POS[k] = { x: x + stagger, y } })
})
KEY_POS[' '] = { x: 5, y: 4 }

function keyInfo(ch) {
  if (ch === '\n' || ch === '\t') return { pos: KEY_POS[' '], shift: false }
  let shift = false
  let base = ch
  if (SHIFT_MAP[ch]) { base = SHIFT_MAP[ch]; shift = true }
  else if (/[A-Z]/.test(ch)) { base = ch.toLowerCase(); shift = true }
  return { pos: KEY_POS[base] || KEY_POS[' '], shift }
}

function humanDelay(prevCh, ch, msPerChar) {
  const a = keyInfo(prevCh || ch)
  const b = keyInfo(ch)
  const dist = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y)
  let d = msPerChar * (0.4 + 0.16 * Math.min(dist, 9))
  if (b.shift) d *= 1.3
  d *= 0.55 + Math.random() * 1.1 // per-key jitter
  if (Math.random() < 0.03) d += 200 + Math.random() * 500 // brief hesitation
  return d
}

/* ----------------------------- eval ----------------------------- */

function evalAsync(code) {
  const wrapped = `(async() => {\n${code}\n})().catch((e) => console.warn('typewriter eval:', e.message))`
  try {
    window.eval(wrapped)
  } catch (e) {
    console.warn('typewriter eval:', e.message)
  }
}

function stripLoadScripts(code) {
  return code
    .split('\n')
    .map((l) => (/^\s*await\s+loadScript\s*\(/.test(l) ? '' : l))
    .join('\n')
}

async function preloadScripts(code) {
  const urls = [...code.matchAll(/loadScript\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1])
  for (const url of urls) {
    try {
      await window.loadScript(url)
    } catch (e) {
      console.warn('typewriter: could not preload', url)
    }
  }
}

/* ----------------------------- parsing ----------------------------- */

// net bracket balance of a line, ignoring strings and line comments
function balance(line) {
  const cleaned = line
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '')
    .replace(/\/\/.*$/, '')
  let n = 0
  for (const c of cleaned) {
    if (c === '(' || c === '{' || c === '[') n++
    if (c === ')' || c === '}' || c === ']') n--
  }
  return n
}

// splits a sketch into loadScript lines, const declarations (kept aside for
// on-demand insertion) and an ordered sequence of chain / plain blocks
function parseSketch(code) {
  const lines = code.split('\n')
  const loadScripts = []
  const consts = new Map() // name -> declaration text
  const sequence = []
  let pendingComments = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()

    // blank lines are kept and typed with the next block
    if (!t) {
      if (sequence.length || pendingComments.length) pendingComments.push('')
      i++
      continue
    }

    if (/^await\s+loadScript\s*\(/.test(t)) { pendingComments = []; loadScripts.push(line); i++; continue }

    if (/^\/\//.test(t)) { pendingComments.push(line); i++; continue }

    const constMatch = t.match(/^const\s+([A-Za-z_$][\w$]*)\s*=/)
    if (constMatch) {
      let text = line
      let bal = balance(line)
      let j = i + 1
      while (j < lines.length && (bal > 0 || /=>\s*$/.test(lines[j - 1].trim()) || /^\s+[.]/.test(lines[j]))) {
        text += '\n' + lines[j]
        bal += balance(lines[j])
        j++
      }
      consts.set(constMatch[1], text)
      // section comments before a const (e.g. "// COLOR LAYER 1") stay
      // pending so they attach to the chain that follows
      i = j
      continue
    }

    if (/^[A-Za-z_$][\w$]*\s*\(/.test(t)) {
      const first = line
      const middles = []
      let out = null
      let j = i + 1
      while (j < lines.length && /^\s*\./.test(lines[j])) {
        if (/^\s*\.out\s*\(/.test(lines[j])) { out = lines[j]; j++; break }
        middles.push(lines[j])
        j++
      }
      if (out) {
        const target = (out.match(/\(\s*(o\d+)?\s*\)/) || [])[1] || 'o0'
        sequence.push({ type: 'chain', comments: pendingComments, first, middles, out, target })
      } else {
        sequence.push({ type: 'plain', lines: [...pendingComments, first, ...middles] })
      }
      pendingComments = []
      i = j
      continue
    }

    sequence.push({ type: 'plain', lines: [...pendingComments, line] })
    pendingComments = []
    i++
  }

  return { loadScripts, consts, sequence }
}

/* ----------------------------- typing ----------------------------- */

// a position in the document that survives edits made elsewhere
class Anchor {
  constructor(cm, pos) {
    this.cm = cm
    this.bm = cm.setBookmark(pos)
  }
  find() {
    return this.bm.find() || { line: this.cm.lastLine(), ch: 0 }
  }
  moveTo(pos) {
    this.bm.clear()
    this.bm = this.cm.setBookmark(pos)
  }
}

export async function typewrite(code, opts = {}) {
  const cm = window.cm
  if (!cm) {
    console.warn('typewriter: editor not ready')
    return
  }
  const msPerChar = opts.msPerChar ?? 45
  const linePause = opts.linePause ?? 220
  const holdAfterOut = opts.holdAfterOut ?? 1500
  const holdMid = opts.holdMid ?? 600
  const jumpPause = opts.jumpPause ?? 450
  const startDelay = opts.startDelay ?? 1200

  code = code.replace(/\r\n/g, '\n').replace(/\s+$/, '')
  running = true
  window.__typewriterDone = false

  const { loadScripts, consts, sequence } = parseSketch(code)
  const declared = new Set()

  await preloadScripts(code)

  // blank slate + intended speed from the start
  try { window.hush() } catch (e) {}
  try { window.render(window.o0) } catch (e) {}
  const speedLines = code
    .split('\n')
    .filter((l) => /^\s*(window\.baseSpeed|speed)\s*=/.test(l))
  if (speedLines.length) evalAsync(speedLines.join('\n'))

  // paste the loadScript block instantly
  cm.setValue(loadScripts.length ? loadScripts.join('\n') + '\n\n\n\n' : '')
  cm.focus()
  window.__typewriterStarted = true
  const constLine = loadScripts.length ? loadScripts.length + 1 : 0
  const constAnchor = new Anchor(cm, { line: constLine, ch: 0 })
  const endAnchor = new Anchor(cm, { line: cm.lastLine(), ch: 0 })
  cm.setCursor(endAnchor.find())
  await sleep(startDelay)

  const typeAt = async (anchor, text) => {
    let prevCh = null
    for (const ch of text) {
      if (!running) return
      const pos = anchor.find()
      cm.replaceRange(ch, pos)
      const next = ch === '\n' ? { line: pos.line + 1, ch: 0 } : { line: pos.line, ch: pos.ch + 1 }
      anchor.moveTo(next)
      cm.setCursor(next)
      cm.scrollIntoView(next, 80)
      let d = humanDelay(prevCh, ch, msPerChar)
      if (ch === '\n') d += linePause * (0.5 + Math.random())
      prevCh = ch
      await sleep(d)
    }
  }

  const jumpTo = async (anchor) => {
    cm.setCursor(anchor.find())
    cm.scrollIntoView(anchor.find(), 80)
    await sleep(jumpPause)
  }

  // lines that are identical except for their numbers form a copy-paste run
  const numTemplate = (l) => l.replace(/-?\d+(?:\.\d+)?/g, '#')

  // select each number that differs and type the new value over it
  const editNumbers = async (lineAnchor, fromText, toText) => {
    const re = /-?\d+(?:\.\d+)?/g
    const from = [...fromText.matchAll(re)]
    const to = [...toText.matchAll(re)]
    let delta = 0
    for (let i = 0; i < Math.min(from.length, to.length); i++) {
      if (!running) return
      if (from[i][0] === to[i][0]) continue
      const line = lineAnchor.find().line
      const start = from[i].index + delta
      const end = start + from[i][0].length
      cm.setSelection({ line, ch: start }, { line, ch: end })
      cm.scrollIntoView({ line, ch: start }, 80)
      await sleep(280)
      cm.replaceSelection('')
      const t = new Anchor(cm, { line, ch: start })
      await typeAt(t, to[i][0])
      delta += to[i][0].length - from[i][0].length
    }
  }

  const flash = () => {
    try {
      const marker = cm.markText({ line: cm.firstLine(), ch: 0 }, { line: cm.lastLine() + 1, ch: 0 }, {
        className: 'styled-background',
      })
      setTimeout(() => marker.clear(), 250)
    } catch (e) {}
  }

  const evalStage = async (target, hold) => {
    if (!running) return
    let stage = stripLoadScripts(cm.getValue())
    if (target) stage += `\nrender(${target})\n`
    flash()
    evalAsync(stage)
    await sleep(hold)
  }

  // jump up, type a const declaration (dependencies first), jump back
  const declareConst = async (name) => {
    if (declared.has(name) || !consts.has(name)) return
    declared.add(name)
    const text = consts.get(name)
    for (const [dep] of consts) {
      if (dep !== name && !declared.has(dep) && new RegExp(`\\b${dep}\\b`).test(text)) {
        await declareConst(dep)
      }
    }
    await jumpTo(constAnchor)
    await typeAt(constAnchor, text + '\n')
    await sleep(150)
  }

  const declareConstsUsedIn = async (text, returnAnchor) => {
    let jumped = false
    for (const [name] of consts) {
      if (!declared.has(name) && new RegExp(`\\b${name}\\b`).test(text)) {
        await declareConst(name)
        jumped = true
      }
    }
    if (jumped && returnAnchor) await jumpTo(returnAnchor)
  }

  for (const block of sequence) {
    if (!running) return

    if (block.type === 'chain') {
      // blank separators first; section comments come at the end, once
      // the chain is fully built
      const comments = block.comments.filter((c) => c.trim())
      for (const b of block.comments) {
        if (!b.trim()) await typeAt(endAnchor, '\n')
      }
      // skeleton: generator line, then .out() right below
      await typeAt(endAnchor, block.first + '\n')
      await typeAt(endAnchor, block.out + '\n')
      const midAnchor = new Anchor(cm, { line: endAnchor.find().line - 1, ch: 0 })
      await declareConstsUsedIn(block.first + block.out, null)
      await evalStage(block.target, holdAfterOut)

      // go back up and grow the chain line by line: open an empty line
      // above .out() first (like pressing enter), then type into it
      let k = 0
      while (k < block.middles.length) {
        if (!running) return
        const mid = block.middles[k]

        // how many consecutive lines share this line's shape?
        let run = 1
        while (
          k + run < block.middles.length &&
          numTemplate(block.middles[k + run]) === numTemplate(mid)
        ) run++

        // type the first one by hand
        await jumpTo(midAnchor)
        const p = midAnchor.find()
        cm.replaceRange('\n', p)
        midAnchor.moveTo({ line: p.line, ch: 0 })
        cm.setCursor(midAnchor.find())
        await sleep(180)
        await typeAt(midAnchor, mid)
        midAnchor.moveTo({ line: midAnchor.find().line + 1, ch: 0 })
        await declareConstsUsedIn(mid, null)
        await evalStage(block.target, holdMid)

        // the rest of the run: paste copies of it below, then go back and
        // edit just the numbers in each copy
        if (run > 1) {
          const pasted = []
          for (let j = 1; j < run; j++) {
            if (!running) return
            const pp = midAnchor.find()
            cm.replaceRange(mid + '\n', pp)
            pasted.push(new Anchor(cm, { line: pp.line, ch: 0 }))
            midAnchor.moveTo({ line: pp.line + 1, ch: 0 })
            cm.setCursor({ line: pp.line, ch: mid.length })
            await sleep(200 + Math.random() * 150)
          }
          await sleep(350)
          for (let j = 1; j < run; j++) {
            if (!running) return
            await editNumbers(pasted[j - 1], mid, block.middles[k + j])
            await declareConstsUsedIn(block.middles[k + j], null)
            await evalStage(block.target, holdMid)
          }
        }
        k += run
      }

      // now that the section works, go up and label it with its comment
      if (comments.length) {
        const outLine = midAnchor.find().line
        const cAnchor = new Anchor(cm, { line: outLine - block.middles.length - 1, ch: 0 })
        await jumpTo(cAnchor)
        const p = cAnchor.find()
        cm.replaceRange('\n', p)
        cAnchor.moveTo({ line: p.line, ch: 0 })
        cm.setCursor(cAnchor.find())
        await sleep(180)
        await typeAt(cAnchor, comments.join('\n'))
      }
      await jumpTo(endAnchor)
    } else {
      const text = block.lines.join('\n')
      await declareConstsUsedIn(text, endAnchor)
      await typeAt(endAnchor, text + '\n')
      const outs = [...text.matchAll(/\.out\s*\(\s*(o\d+)?\s*\)/g)]
      if (/\brender\s*\(/.test(text)) {
        await evalStage(null, holdAfterOut)
      } else if (outs.length) {
        await evalStage(outs[outs.length - 1][1] || 'o0', holdAfterOut)
      }
    }
  }

  // final pass: the document as written (includes its own render/speed)
  await evalStage(null, 0)
  running = false
  window.__typewriterDone = true
  console.log('typewriter: done')
}

export async function typewriteFile(path, opts = {}) {
  const res = await fetch('/' + String(path).replace(/^\//, ''))
  if (!res.ok) {
    console.warn('typewriter: could not fetch', path)
    return
  }
  typewrite(await res.text(), opts)
}

export function typewriteStop() {
  running = false
}

window.typewrite = typewrite
window.typewriteFile = typewriteFile
window.typewriteStop = typewriteStop

// auto-start via ?typewrite=<file in public/>
const params = new URLSearchParams(window.location.search)
const autoFile = params.get('typewrite')
if (autoFile) {
  const opts = {}
  if (params.get('ms')) opts.msPerChar = parseFloat(params.get('ms'))
  if (params.get('hold')) opts.holdAfterOut = parseFloat(params.get('hold'))
  if (params.get('holdmid')) opts.holdMid = parseFloat(params.get('holdmid'))
  const waitForEditor = setInterval(() => {
    if (window.cm && window.loadScript) {
      clearInterval(waitForEditor)
      typewriteFile(autoFile, opts)
    }
  }, 300)
}

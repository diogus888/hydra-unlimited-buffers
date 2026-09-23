// draws the boxes behind each code line onto two separate fullscreen
// canvases sitting between the hydra canvas and the editor text:
//   1. #diff-boxes — white fill, mix-blend-mode: difference (inverts visuals)
//   2. #dim-boxes  — black fill at 50%, normal blending, above the first
// the DOM text above stays plain white. geometry is measured live from the
// editor's line elements every frame, so the layout matches exactly.

function start() {
  const makeLayer = (id) => {
    const canvas = document.createElement('canvas')
    canvas.id = id
    document.body.appendChild(canvas)
    return { canvas, ctx: canvas.getContext('2d') }
  }
  const diff = makeLayer('diff-boxes')
  const dim = makeLayer('dim-boxes')

  const draw = () => {
    // choo re-renders <body> and can remove the canvases — put them back
    if (!diff.canvas.isConnected) document.body.appendChild(diff.canvas)
    if (!dim.canvas.isConnected) document.body.appendChild(dim.canvas)

    const dpr = window.devicePixelRatio || 1
    const w = Math.round(window.innerWidth * dpr)
    const h = Math.round(window.innerHeight * dpr)
    for (const layer of [diff, dim]) {
      if (layer.canvas.width !== w || layer.canvas.height !== h) {
        layer.canvas.width = w
        layer.canvas.height = h
      }
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
      layer.ctx.clearRect(0, 0, w, h)
    }

    const cmEl = document.querySelector('.CodeMirror')
    if (cmEl && cmEl.style.opacity !== '0') {
      // white fill, difference-blended with the visuals: a lower alpha
      // fades to invisible around mid-gray backdrops, so keep it high
      diff.ctx.fillStyle = 'rgba(255, 255, 255, 1)'
      dim.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      document.querySelectorAll('.CodeMirror-line > span').forEach((span) => {
        const r = span.getBoundingClientRect()
        if (r.width > 1 && r.height > 1) {
          // rounded device-pixel coordinates: hard edges, no antialiasing
          const x = Math.round(r.left * dpr)
          const y = Math.round(r.top * dpr)
          const bw = Math.round(r.right * dpr) - x
          const bh = Math.round(r.bottom * dpr) - y
          diff.ctx.fillRect(x, y, bw, bh)
          dim.ctx.fillRect(x, y, bw, bh)
        }
      })
    }
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start)
} else {
  start()
}

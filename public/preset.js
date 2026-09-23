await loadScript("https://metagrowing.org/extra-shaders-for-hydra/lib-noise.js")
await loadScript("https://metagrowing.org/extra-shaders-for-hydra/lib-screen.js")
await loadScript("https://cdn.jsdelivr.net/gh/geikha/hyper-hydra@latest/hydra-blend.js")
await loadScript("https://cdn.jsdelivr.net/gh/geikha/hyper-hydra@latest/hydra-arithmetics.js")

const seed1 = 123
const seed2 = 124

const blendDt    = (amt) => amt
const contrastDt = (amt) => amt
const sortDirX   = () => 1
const sortDirY   = () => 1
const gridScale  = () => 1

const pal = {
  cBlack:  { r: 0.6, g: 0.6, b: 0.6 },
  cMid:    { r: 1, g: 1, b: 1 },
  cWhite:  { r: 1, g: 1, b: 1 },
  cDither: { r: 0.6823529411764706, g: 1, b: 0 },
}

// VISUAL LAYER 1
osc(20, 0.25, 0)
  .rotate(1.57, 2)
  .modulate(noise(1, 0.5).pixelate(50, 1).rotate(seed1, 0.75))
  .modulateRotate(noise(0.1, 0.5).rotate(seed1, 0.75), 1.57)
  .scale(0.3)
  .pixelate(400, 450)
  .out(o4)

// VISUAL LAYER 2
osc(15, 0.25, 0)
  .rotate(1.57, 2)
  .modulate(noise(4, 0.5).pixelate(50, 1).rotate(seed2, 0.75))
  .modulateRotate(noise(1, 0.5).rotate(seed2, 0.75), 1.57)
  .scale(1)
  .pixelate(200, 50)
  .out(o6)

// VISUAL LAYER 3
unoise(5.2, 0.1).pixelate(256, 256)
  .darken(unoise(5.2, 0.1).pixelate(128, 128))
  .darken(unoise(5.2, 0.1).pixelate(64, 64))
  .darken(unoise(5.2, 0.1).pixelate(32, 32))
  .darken(unoise(5.2, 0.1).pixelate(16, 16))
  .darken(unoise(5.2, 0.1).pixelate(8, 8))
  .darken(unoise(5.2, 0.1).pixelate(4, 4))
  .darken(unoise(5.2, 0.1).pixelate(2, 2))
  .amp(20)
  .mod(1.001)
  .out(o0)

// MERGE LAYER 1 & 2
src(o1)
  .pysort(0.001, () => window.frame++, 0, sortDirY())
  .blend(src(o4).blend(o6, 0.01).blend(o0, 0.2), blendDt(0.1))
  .contrast(contrastDt(1.08))
  .out(o1)

// GREEN PIXELS LAYER
src(o5)
  .invert()
  .pxsort(0.01, () => window.frame++, sortDirX(), 0)
  .blend(o1, blendDt(0.05))
  .contrast(contrastDt(1.001))
  .out(o5)

const greenPixels = () =>
  solid(pal.cDither.r, pal.cDither.g, pal.cDither.b)
    .mask(src(o5).diff(src(o1).scrollY(5.0005)).thresh(0.4, 0.4).dither4(gridScale()))

// COLOR LAYER 1
const midMask = () => src(o1).thresh(0.1).mult(src(o1).thresh(0.8).invert())
solid(pal.cBlack.r, pal.cBlack.g, pal.cBlack.b)
  .mult(src(o1).thresh(0.1).invert())
  .add(solid(pal.cMid.r, pal.cMid.g, pal.cMid.b).mult(midMask()))
  .add(solid(pal.cWhite.r, pal.cWhite.g, pal.cWhite.b).mult(src(o1).thresh(0.8)))
  .out(o2)

// POST PROCESSING
const highMask = () => src(o1).thresh(0.8, 0.15)
src(o2)
  .modulate(noise(1000, 5), 0.002)
  .mult(osc(3000).add(solid(0.6, 0.6, 0.6)))
  .add(noise(300, 20).luma(0.6, 0.1), 0.15)
  .modulate(osc(1.5, 0.3, 0), 0.005)
  .scale(1.02, 1.02, 1)
  .brightness(-0.1)
  .mult(highMask().invert())
  .add(src(o2).add(noise(500, 20).luma(0.6, 0.1), 0.15).mult(highMask()))
  .layer(greenPixels())
  .out(o3)

window.baseSpeed = 0.1
speed = window.baseSpeed

render(o3)

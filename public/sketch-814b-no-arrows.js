await loadScript("https://metagrowing.org/extra-shaders-for-hydra/lib-noise.js")
await loadScript("https://metagrowing.org/extra-shaders-for-hydra/lib-screen.js")
await loadScript("https://cdn.jsdelivr.net/gh/geikha/hyper-hydra@latest/hydra-blend.js")
await loadScript("https://cdn.jsdelivr.net/gh/geikha/hyper-hydra@latest/hydra-arithmetics.js")

const seed1 = 814
const seed2 = 815

const blendDt    = (amt) => amt
const contrastDt = (amt) => amt
const sortDirX   = () => 1
const sortDirY   = () => 1
const gridScale  = () => 1

const pal = {
  cBlack:  { r: 0.80, g: 0.98, b: 0.21 },
  cMid:    { r: 0.45, g: 0.45, b: 0.45 },
  cWhite:  { r: 0.86, g: 0.86, b: 0.86 },
  cDither: { r: 1, g: 0.29, b: 0.50 },
}

// VISUAL LAYER 1
osc(30, 0.1, 0)
  .rotate(1.57, 2)
  .modulate(noise(12, 0.1).pixelate(46, 16).rotate(seed1, 1.05))
  .modulateRotate(noise(12, 1.5).rotate(seed1, 0.841183), 0.5)
  .scale(4.77)
  .pixelate(428, 621)
  .out(o4)

// VISUAL LAYER 2
osc(56, 0.8, 0)
  .rotate(1.57, 1.96)
  .modulate(noise(3.59, 0.5).pixelate(46, 1).rotate(seed2, 10.75))
  .modulateRotate(noise(2.8, 0.7).rotate(seed2, 0.75), 1.56)
  .scale(9.1)
  .pixelate(573, 5403)
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
  .pysort(0.495, () => window.frame++, 0, sortDirY())
  .blend(src(o4).blend(o6, 1.239).blend(o0, -1.304), blendDt(1.032))
  .contrast(contrastDt(1.237))
  .out(o1)

// GREEN PIXELS LAYER
src(o5)
  .invert()
  .pxsort(0.01, () => window.frame++, sortDirX(), 0)
  .blend(o1, blendDt(0.081))
  .contrast(contrastDt(1.041))
  .out(o5)

const greenPixels = () =>
  solid(pal.cDither.r, pal.cDither.g, pal.cDither.b)
    .mask(src(o5).diff(src(o1).scrollY(4.96)).thresh(0.406, 0.4).dither4(gridScale()))

// COLOR LAYER 1
const midMask = () => src(o1).thresh(0.1).mult(src(o1).thresh(0.8).invert())
solid(pal.cBlack.r, pal.cBlack.g, pal.cBlack.b)
  .mult(src(o1).thresh(0.11).invert())
  .add(solid(pal.cMid.r, pal.cMid.g, pal.cMid.b).mult(midMask()))
  .add(solid(pal.cWhite.r, pal.cWhite.g, pal.cWhite.b).mult(src(o1).thresh(0.8)))
  .out(o2)

// POST PROCESSING
const highMask = () => src(o1).thresh(0.8, 0.15)
src(o2)
  .modulate(noise(926, 5), 0.002)
  .mult(osc(438000).add(solid(0.6, 0.6, 0.6)))
  .add(noise(524, 20).luma(0.6, 0.1), 0.194)
  .modulate(osc(1.5, 0.348, 0), 0.69)
  .scale(1.02, 1.02, 1)
  .brightness(-0.1)
  .mult(highMask().invert())
  .add(src(o2).add(noise(500, 20).luma(0.6, 0.1), 0.15).mult(highMask()))
  .layer(greenPixels())
  .out(o3)

window.baseSpeed = 0.024
speed = window.baseSpeed

render(o3)

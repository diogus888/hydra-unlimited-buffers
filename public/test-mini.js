osc(10, 0.1, 1.2)
  .rotate(0.5, 0.2)
  .out(o0)

src(o0)
  .mult(osc(20), 0.5)
  .out(o1)

render(o1)

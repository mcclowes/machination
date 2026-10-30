# Gravity prototype

Throwaway sandbox for [#104](https://github.com/mcclowes/machination/issues/104). Delete it, or fold the verdict into the engine, once the question is answered.

Run: `node prototypes/gravity/run.mjs`

## Question

Do curved, gravity-bent hauler courses feel good and stay legible on a real chart? Which tuning gives slingshot tradeoffs rather than a flat speed boost?

## Model under test (`model.ts`)

- A course is plotted once at launch as a polyline (48 segments) with per-point timestamps. Positions in flight interpolate that table.
- Shape: an elastic band between the endpoints, relaxed toward wells (fixed iterations, SOR). Bodies keep 1.3× radius clearance. Canonical direction makes A→B and B→A the same course.
- Speed: base × (1 + Σ gain × |mass| × influence), clamped to 0.25–3×. Giants speed haulers up. Antigravity wells repel courses, speed their owner's haulers, and slow rivals'.
- Influence is compact: full at the centre, zero at the drawn reach circle.
- Uses arithmetic and `sqrt` only, so server, client, and forecasts could reproduce it exactly.

## Findings so far

- Courses are symmetric and converge (3,000 iterations change nothing visible over 500). Plotting costs a few ms per course.
- With a long-tailed falloff, every course got faster everywhere, which is just a higher base speed. The compact falloff fixed this: only routes through the reach circle change.
- Gravity is currently always a net speed-up. There's no real slingshot *tradeoff* yet, because the extra length never outweighs the speed gain at the defaults. Candidates: drag or slowdown on the climb out, or speed gain only on the inbound half.
- Bend above about 10 goes unstable (courses loop and ETAs double). The slider is capped at 8.

## Verdict

_To fill in after Max plays with it._

# Gravity prototype

Throwaway sandbox for [#104](https://github.com/mcclowes/machination/issues/104). Delete it, or fold the verdict into the engine, once the question is answered.

Run: `node prototypes/gravity/run.mjs`

## Question

Do curved, gravity-bent hauler courses feel good and stay legible on a real chart? Which tuning gives slingshot tradeoffs rather than a flat speed boost?

## Model under test (`model.ts`)

- A course is plotted once at launch as a polyline (48 segments) with per-point timestamps. Positions in flight interpolate that table.
- Shape is ballistic. A hauler launches at an aimed heading and gravity turns it toward each well, so the course curves with the mass on the inside. A shooting method (scan 41 headings, bisect each sign change of the miss) picks the shortest course that coasts onto the target without entering a body's 1.3× clearance.
- If no coasting heading exists, the hauler burns once at a waypoint beside the blocking well. This happens when a strong giant would capture the course, or when the target sits in an antigravity well's shadow, where repulsion makes it unreachable by coasting.
- Shape ignores owner speed, so every intelligence flies the same course between two sites. Canonical direction makes A→B and B→A identical.
- Speed: base × (1 + Σ gain × |mass| × influence), clamped to 0.25–3×. Giants speed haulers up. Antigravity wells repel courses, speed their owner's haulers, and slow rivals'.
- Influence is compact: full at the centre, zero at the drawn reach circle.
- Uses arithmetic and `sqrt` only, so server, client, and forecasts could reproduce it exactly.

## Findings so far

- Courses are symmetric and converge (3,000 iterations change nothing visible over 500). Plotting costs a few ms per course.
- With a long-tailed falloff, every course got faster everywhere, which is just a higher base speed. The compact falloff fixed this: only routes through the reach circle change.
- v1 used an elastic band pulled toward wells. Max spotted it hugged the giant in an S-wiggle; a real course aims wide and arcs back. Replaced with the ballistic solver.
- With ballistic arcs, the slingshot is roughly neutral at the defaults (about −1% to −2%), because the wider course offsets the speed gain. That's a tradeoff, not a flat buff.
- Antigravity shadows are a real emergent mechanic: a well can make sites behind it reachable only with a burn detour.

## Verdict

_To fill in after Max plays with it._

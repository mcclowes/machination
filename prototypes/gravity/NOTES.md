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

- Courses are symmetric, and integrating 4× finer changes nothing measurable. Plotting costs about 2ms per course.
- With a long-tailed falloff, every course got faster everywhere, which is just a higher base speed. The compact falloff fixed this: only routes through the reach circle change.
- v1 used an elastic band pulled toward wells. Max spotted it hugged the giant in an S-wiggle; a real course aims wide and arcs back. Replaced with the ballistic solver.
- With ballistic arcs, the slingshot is roughly neutral at the defaults (about −1% to −2%), because the wider course offsets the speed gain. That's a tradeoff, not a flat buff.
- Antigravity shadows are a real emergent mechanic. Repulsion deflects passing courses outward, so the area behind a well that no coasting course can reach fans out with distance. The sandbox shades it. Measured from a site 12u from the well (seed 7): 4% of the chart at mass 0.25, 13% at 1, 21% at 1.5, and 32% at 3. Giants alone shade about 3%, mostly close behind them. Mass 1.5 is too strong for a hero ability; something nearer 0.5 looks right.
- Shading costs about 2s per selection (2,025 cells, each a full course solve). That's fine for the sandbox, but the engine would need a cheaper reachability check or precomputed shadows.

## Verdict

Integrated as the default gameplay variant for new mechanics-revision-19 operations, with an option to disable it. See [gravity rules](../../docs/gravity.md). The engine keeps fixed ballistic courses, neutral giants, and speed-integrated timing, with safe powered detours when no coasting solution exists. Interceptors fly straight under power. Specialist-created antigravity wells and interactive shadow overlays remain separate work. This sandbox remains available for tuning experiments.

## Planetary sites (option B)

Question: can some sites be planets with their own gravity, without turning gravity into a flat speed change?

`model.ts` is now a copy of the engine model with two additions: a per-well `reach`, and a rule that a site's own well never acts on courses that leave or reach it. The sandbox's **Planet** sliders mark every Nth public site as a planet. `npx tsx prototypes/gravity/planets.ts` measures generated charts (2–8 players, seeds 1–5, site pairs within 30u, planets on every fifth site, radius 0.6).

- **Giants don't touch ordinary hops.** `placeGiants` puts them about 20–23u from the nearest site, and their influence ends at 11.5u. No route shorter than about 31u bends; only 6–10% of all site pairs do. On today's charts, gravity mostly affects long strikes.
- **Planets reach the hops that giants miss.** At mass 0.5 and reach 6, planets change 5–10% of short routes. Changed routes move by a median of 3–4% ETA (p90 6–8%). At mass 0.8 that's 4–5% (p90 8–11%), with no extra burns.
- **No flat buff.** With endpoint wells excluded, the mean ETA change across all short routes is between 0 and −0.6%. Passing a planet is slightly faster on average, so sites near planets are slightly better connected.
- **Planets cast shadows too.** A narrow wedge behind each planet, seen from the launching site, can't be reached by coasting, so those routes need a burn. Weak planets (mass 0.3) produce more burns than strong ones (6–13 vs 0–1 per 1,000 routes), because they bend courses too little to clear the 1.3× radius.
- **Reach 6 overlaps.** 17–30% of planets share influence with another planet. At reach 4 that drops to 0–30%, but the effect becomes hard to see.
- **Cost is fine.** 0.3–1.2ms per course, including giants.

Open questions for the engine: assign planets by territory rank (as site types and shields are) so every player gets the same share; choose between mass 0.5 and 0.8; decide whether to keep giants as they are or move them closer, since they currently don't affect ordinary hops.

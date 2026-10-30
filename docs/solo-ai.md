# Solo opponents

New configured operations use strategic rivals. Solo remains a full-information simulation: rivals can inspect the same complete chart as the human player. Multiplayer and practice keep automatic rivals disabled.

Every three game hours, each living rival makes decisions in this order:

1. Reinforce threatened sites, prioritizing the King. Evacuate an outmatched King when a simulated escape survives. Anticipate hostile pulses before their wavefront traps the King on station.
2. Charge or fire King's Pulse using the normal material cost and charging rules.
3. Spend earned recruitment credits on useful specialists and promotions. Favor production, capacity, shields, and combat bonuses, and reserve material when close to a pulse charge or mining victory.
4. Save and consolidate drones for additional mines. Preserve factories, power generation, and garrisons.
5. Commit surplus troops to valuable captures, then move idle rear forces toward the front or the next mining investment.

Conquerors favor hostile territory, expansionists favor neutral sites, and industrialists favor mines. Preferences are fixed by faction identity. The planner uses deterministic ordering and ordinary commands, inventories, travel, and combat. It never grants resources or skips preparation.

Attacks are checked with the authoritative simulation, including shields, production, specialists, route encounters, committed reinforcements, and scheduled actions. Already-secured targets are skipped. Forecasts disable rival decisions to prevent recursion. Each seat gets at most eight speculative forecasts per decision, reduced to four above four players, with a maximum twelve-hour horizon and a decision-local cache. Troop emergencies within six hours receive immediate attention. Each decision can launch up to two attacks and one logistics transfer; defense has separate limits. Exhausted planning budgets leave uncertain actions uncommitted.

The policy is stored as `Game.rivalPolicy: 1`, independently of mechanics revisions. Saved games without that marker retain the original six-hour rival behavior, so their histories reconstruct under the original policy. Unsupported policy versions are rejected at the save boundary. Future behavior changes need a new policy version or an explicit replay migration.

## Verification

`node --import tsx --test src/game/rival-ai.test.ts src/game/rival-ai-acceptance.test.ts` covers tactical decisions, bounded speculation, all supported player counts and victory modes, drifting charts, input immutability, partitioned advancement, saves, and private replays.

`node --import tsx scripts/benchmark-rivals.ts 168 3 42` runs all seats under AI control, including the human seat, across all three victory modes. Optional arguments are hours, player count, map seed, and one mode. It reports elapsed time, terminal state, territories, mines, material, recruitment, and pulse state, and verifies save decoding and nonnegative inventories. This is a deterministic soak tool, not a human difficulty rating.

The current planner evaluates committed orders and immediate outcomes. It doesn't model negotiation, learn opponents' behavior, coordinate timed multi-source attacks, or guarantee survival against later counterorders. Human playtesting is still needed to judge difficulty and faction balance.

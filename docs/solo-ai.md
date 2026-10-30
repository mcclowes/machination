# Solo opponents

New configured operations use strategic rivals. Solo remains a full-information simulation: rivals can inspect the same complete chart as the human player. Multiplayer and practice keep automatic rivals disabled.

Every three game hours, each living rival makes decisions in this order. Under policy 2, every rival plans against the same pre-decision snapshot and the resulting orders are merged afterwards, so no rival reacts to another's same-tick orders. Policy 1 decides in seat order.

1. Reinforce threatened sites, prioritizing the King. Evacuate an outmatched King when a simulated escape survives. Anticipate hostile pulses before their wavefront traps the King on station.
2. Charge or fire King's Pulse using the normal material cost and charging rules.
3. Spend earned recruitment credits on useful specialists and promotions. Favor production, capacity, shields, and combat bonuses, and reserve material when close to a pulse charge or mining victory.
4. Save and consolidate drones for additional mines. Preserve factories, power generation, and garrisons.
5. Commit surplus troops to valuable captures, then move idle rear forces toward the front or the next mining investment.

Policy 2 adds deliberate specialist use:

- **Recruitment** never stalls. Every offer except the meltdown charge has a value, so a poor offer set is spent and redrawn rather than hoarded. A promotion is taken only when it beats the best affordable hire.
- **Task forces** carry only units that change the fight: hijackers, strikers, maulers, thrusters, and reclaimers always; breachers against shields; purgers against defending specialists; an arbiter only to cancel the defender's arbiter or to suppress defending abilities when the attack has none. Couriers and navigators stay home. Sites defended by a purger or meltdown charge get no specialists.
- **King guard** garrisons the King against the two largest hostile stacks that could land within six hours, before the next decision can react. Attacks and logistics leave that garrison behind. Unwinnable garrisons are skipped and evacuation takes over.
- **Positioning** moves one stationed unit per decision, unescorted, when a forecast shows it arriving: fabricators to the site covering the most factories, overseers to the safest factory, capacitors to the highest shield site, custodians and bulwarks to the core, watchdogs and idle strike units to the front.

Conquerors favor hostile territory, expansionists favor neutral sites, and industrialists favor mines. Preferences are fixed by faction identity. The planner uses deterministic ordering and ordinary commands, inventories, travel, and combat. It never grants resources or skips preparation.

Attacks are checked with the authoritative simulation, including shields, production, specialists, route encounters, committed reinforcements, and scheduled actions. Already-secured targets are skipped. Forecasts disable rival decisions to prevent recursion. Each seat gets at most eight speculative forecasts per decision, reduced to four above four players, with a maximum twelve-hour horizon and a decision-local cache. Troop emergencies within six hours receive immediate attention. Each decision can launch up to two attacks and one logistics transfer; defense has separate limits. Exhausted planning budgets leave uncertain actions uncommitted.

The policy is stored as `Game.rivalPolicy` (currently `2`; `1` is still replayed), independently of mechanics revisions. Saved games without that marker retain the original six-hour rival behavior, so their histories reconstruct under the original policy. Unsupported policy versions are rejected at the save boundary. Future behavior changes need a new policy version or an explicit replay migration.

## Verification

`node --import tsx --test src/game/rival-ai.test.ts src/game/rival-ai-acceptance.test.ts` covers tactical decisions, bounded speculation, all supported player counts and victory modes, drifting charts, input immutability, partitioned advancement, saves, and private replays.

`node --import tsx scripts/benchmark-rivals.ts 168 3 42` runs all seats under AI control, including the human seat, across all three victory modes. Optional arguments are hours, player count, map seed, and one mode. It reports elapsed time, terminal state, territories, mines, material, recruitment, and pulse state, and verifies save decoding and nonnegative inventories. This is a deterministic soak tool, not a human difficulty rating.

`node --import tsx scripts/compare-rival-policies.ts 6 240 4 1` plays policy 1 against policy 2 with alternating seats across modes and reports wins, held sites, and surviving specialists per policy.

The current planner evaluates committed orders and immediate outcomes. It doesn't model negotiation, learn opponents' behavior, coordinate timed multi-source attacks, or guarantee survival against later counterorders. Human playtesting is still needed to judge difficulty and faction balance.

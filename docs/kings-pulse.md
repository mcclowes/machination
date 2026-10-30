# King's Pulse

Implementation and gameplay testing reference for [#87](https://github.com/mcclowes/machination/issues/87).

## Rules in this implementation

- New configured operations default to `pulse`, mechanics revision 16. Revision 15 keeps its original rules. Existing operations keep their saved rules; mining and domination remain selectable.
- The movable intelligence core is the King. Mined cargo serves as Pulse Material. Losing the King eliminates its faction without fallback succession.
- Charging commits 100 material without a refund and takes six effective hours. Opening acceleration does not shorten this timer. Firing is manual.
- Executing a King movement order cancels charging, stored readiness, or emission immediately, including launch preparation. Canceling a launch does not restore a lost charge.
- An active pulse grows at eight chart units per hour by default. Its origin stays at the firing position. Every opposing faction is hostile, including factions receiving funding.
- Pulses remain dangerous behind their wavefronts. An emitting King's movement, death, manual termination, or specialist interruption removes its pulse everywhere.
- Each site's existing shield generator gets a separate pulse reserve: 100 energy, 20 energy/hour drain per hostile pulse, and 5 energy/hour recharge outside exposure. Shield controls disable both defenses. Preparing haulers remain stationed; traveling ships receive no nearby shield protection.
- Intersections, modifier expiration, shield collapse, and charge completion introduce exact simulation boundaries. Simultaneous lethal pulse contacts resolve before victory, producing a draw when no King remains. Earlier kills extinguish later retaliation.

All timestamps and durations use the engine's game hours. Propagation speed uses chart units per hour. The server owns progress, damage, and victory; client forecasts remain conditional on incomplete intelligence.

## Configuration and specialist integration

`MACHINATION_PULSE_CONFIG` accepts validated JSON overrides for new server operations. Saved operations retain their original balance. See [the server configuration example](../.env.example) and [the balancing reference](../README.md#pulse-balancing-and-abilities).

`applyPulseSpecialistEffect` supports timed charge rates, uniform pulse speeds, shield drain, charge interruption, and emission termination. Each effect command requires a unique ID and can be retained in private replay history. Ability handlers must validate ownership, range, costs, and cooldowns; the HTTP API does not accept arbitrary specialist multipliers. The [Disruptor](disruptor.md) uses the hook’s pulse-speed modifier for temporary strategic slowdown. Temporal and gravity abilities have not been assigned to the existing specialist roster.

The `miningDamage` option chooses destruction or disabled extraction. Regional wave distortion, alliance immunity, and finite pulse fuel remain outside this version's rules.

## Verification

Run the dedicated engine, service, and control scenarios with:

```sh
node --import tsx --test src/game/pulse.test.ts server/pulse.test.ts src/components/PulseControls.test.ts
```

These cover charging and retries, insufficient material, movement interruption, exact arrivals, five-hour shielding, additive drain, simultaneous draws, canceled retaliation, modifier expiry and stasis, private observations, persistence, private and shared replays, launch exposure, fallback suppression, funding withdrawal after material commitment, server balance snapshots, and control interaction.

The delivery checks are `npm run check` and `npm run build:web`. Browser inspection confirmed the default pulse operation, King state, shield reserves, and unavailable charge controls before material is mined. Pulse-specific native device testing remains outstanding; the separate native combat acceptance does not establish pulse behavior.

Browser QA used the shared working tree's existing SVG layering fix, tracked separately in [#64](https://github.com/mcclowes/machination/issues/64). That edit and the existing dialogue changes remain outside this delivery record.

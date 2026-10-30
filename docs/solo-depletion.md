# Solo planetary depletion

New local solo operations give every planet 120 finite reserves. Existing saves, tactical exercises, and server-created multiplayer operations retain unlimited resources. Reserves belong to the planet, survive capture and mine construction, and never regenerate.

Factories spend one reserve per drone actually produced. Capacity-blocked output costs nothing. Production bonuses consume reserves faster, and the final batch is limited to the remaining reserve. Mines spend one reserve per cargo extracted. Generators spend six reserves every eight game hours while owned, using a shared supply clock; neutral generators keep their reserves. Supply cycles use game hours without opening acceleration.

At zero reserves, factories stop producing, mines stop paying, and generators lose their 50 capacity. Exhausted planets no longer accelerate other mines through territorial ownership. Existing troops survive capacity loss. Shields, sensors, specialists, ownership, and hauler destinations remain intact, so players can move forces out without losing assets to an automatic retirement rule. Exhausted planets can't be converted into mines.

Site inspection displays remaining reserves, consumption rules, and exhaustion. Low reserves (24 or fewer) and exhaustion generate observed events. The Time Machine projects the same reserve consumption as the live engine. Save validation rejects invalid reserves, partially missing reserve data, and invalid generator supply clocks. Private and shared replays preserve reserve state without revealing hidden planetary inventories.

AI uses the same economy. It skips exhausted economic targets and mine investments while continuing to value enemy Kings on depleted planets.

This is the depletion-only experiment from [#99](https://github.com/mcclowes/machination/issues/99). The 120-reserve budget is an initial tuning value. Larger or expanding maps, endless victory rules, automatic retirement, fleet upkeep, settlement caps, independent pause behavior, and restoration specialists are not implemented by this change. See the [frontier proposal](endless-frontier.md) for those possible extensions.

Validation: `node --import tsx --test src/game/depletion.test.ts` exercises exhaustion, blocked production, supply capacity, neutral reserves, capture and conversion, mode isolation, corrupted saves, forecasts, replay reconstruction, hidden information, AI targeting, and split versus whole advancement. `npx playwright test visual-tests/depletion.spec.ts` checks inspection and evacuation controls at desktop and mobile viewport sizes.

# Specialist acceptance audit

Issue #18. Bounded independent audit, October 28, 2026. Read the authoritative version-two engine and selected tests; changed only this document. Starting HEAD: `e92b0283e66f1be08c8a520127b1201aabd4d8ec`. Parent changes to destruction, economy, mining, mine-loss combat, rules, world generation, and save validation are outside this audit's findings. This is a working-tree snapshot, not certification of a later integrated commit.

## Source authority

- [Current official Specialist Reference](https://subterfuge-game.com/rulebook/Specialists.html), fetched directly during this audit. Individual entry names below identify the supporting text.
- [Current official rulebook](https://subterfuge-game.com/rulebook/), especially Combat, Subs, Specialists, and How to lose.
- [June 2016 community FAQ](https://herbertzhb.wordpress.com/2016/06/28/subterfuge-2/) is historical evidence only. Its stacking Admiral bonus and stacking King damage at one per three conflict with the current reference: Admiral is a single 50% global bonus with one or more Admirals; King is a single one-per-four damage effect with one or more Kings. Do not restore those historical values. Other FAQ-only behavior needs separate acceptance evidence.

## Reproduced scope defect

**Medium: Pirate interception return behavior applies to unrelated travel.** The [official Pirate entry](https://subterfuge-game.com/rulebook/Specialists.html) attaches double outbound speed and quadruple return speed to targeting a sub. The implementation grants quadruple speed to every return carrying an active Pirate, without establishing an interception mission.

- Minimal case: `g = createGame(0)`; put `{ id: 'held-pirate', kind: 'pirate', owner: 'vesper', captive: true }` at your outpost `c`; call `releaseSpecialist(g, 'you', 'held-pirate')`. The released fleet has `speed: 32`, four times the ordinary speed of 8, despite never targeting a sub. The reference provides no Pirate bonus for this release trip. Expected under its stated scope: ordinary speed for this manifest.
- Second case: put your Pirate at `c` and Vesper's Elder at `f`; dispatch ordinary opposing site-bound fleets with 30 and 10 drillers. At their midpoint encounter, your surviving Pirate redirects home at speed 32 with 20 drillers, even though neither fleet targeted a sub. The Elder also suppresses local combat participation; whether Pirate's post-combat routing is covered by suppression needs explicit acceptance evidence.
- Likely owner paths: `src/game/specialist-effects.ts:51` (`specialistSpeed` treats generic `return` as Pirate interception return); `src/game/specialist-travel.ts:12` (`sendUnitsHome` uses that generic mission for captive releases); `src/game/specialist-combat.ts`, `resolveHaulerBattle` (unconditional Pirate winner return). The parent owns these paths; no engine edits or proposed patch are included here.
- Existing `specialist-interception.test.ts` verifies a genuine targeted interception's 16 outbound/32 return speeds. It doesn't distinguish an interception return from a release, gift interception, tie return, Saboteur redirection, or ordinary route encounter. The observed extra scope is certain; an intentional broader Pirate rule would require evidence beyond the current official entry.

## Interpretation gaps, not confirmed defects

| Interaction | Observed implementation and minimal acceptance scenario | Likely owner |
| --- | --- | --- |
| Saboteur versus later priorities | `applyCombatAbilities` returns immediately after redirection. Existing Saboteur/Thief test retains the original 20/30 manifests. The [Saboteur entry](https://subterfuge-game.com/rulebook/Specialists.html) specifies redirection but doesn't explicitly terminate combat, unlike Infiltrator and Double Agent. Establish whether separation prevents priorities 4–8. | `src/game/combat-abilities.ts`, `applyCombatAbilities` |
| Engineer local recovery after defeat | Only winners invoke `repairLosses`. The [Engineer entry](https://subterfuge-game.com/rulebook/Specialists.html) explicitly limits global recovery to victories but describes local recovery after combat without that qualifier. Lose a shieldless 10-driller outpost containing Engineer to 20 drillers; establish whether any local recovery occurs, when, and for whom. The official text doesn't resolve capture versus recovery ordering. | `src/game/specialist-combat.ts`, both combat resolvers |
| Multiple Kings' shield penalty | Damage correctly uses a presence check, but `refreshUnitEffects` subtracts 20 shield capacity per King. With two Kings and a Queen at a weak-shield outpost, the implementation yields max shield 0 rather than 10 under a single-penalty interpretation. The [King entry](https://subterfuge-game.com/rulebook/Specialists.html) explicitly caps damage by presence; confirm whether the adjacent shield penalty also shares that cap. | `src/game/specialist-effects.ts`, `refreshUnitEffects` |
| Same-kind local stacking | Two local Engineers each add local recovery; two local Security Chiefs each add local capacity. The current entries specify amounts but no general local stacking policy. Historical FAQ says promoted local effects don't stack; it is insufficient authority to call these current-rule defects. | `specialist-combat.ts`, `specialist-effects.ts` |
| Hiring distribution | Category pools contain three copies per kind; draws can repeat prior offers. [Official hiring rules](https://subterfuge-game.com/rulebook/) specify timing and location, not category decks, offer exclusion, or promotion redraws. Historical FAQ describes restrictions the current code doesn't enforce. Keep these unproven rather than importing the old FAQ wholesale. | `src/game/specialists.ts`, `drawOffers` |

## Evidence and remaining acceptance checklist

Executed `node --import tsx --test src/game/specialist*.test.ts server/specialists.test.ts`: **33 passed, zero failed**. Ran `/tmp/machination-specialist-probe.ts`: captive Pirate speed 32; ordinary Pirate/Elder winner returns at 32; two Admirals give specialist-free speed 12. Probe source is temporary and isn't committed.

Existing tests establish particular scenarios, not the whole interaction matrix:

- [x] Priority examples: Thief before Infiltrator termination; Double Agent before Assassin; reciprocal Assassins kill both sides before War Hero damage. Code snapshots both sides' Thief conversions and priority-eight damage before applying them.
- [x] One Elder suppresses Inspector combat refill; friendly Inspector arrival still refills. The earlier parity review's suppression defect is fixed in current source.
- [x] Capture convoys preserve original specialist ownership and captive state; Hypnotist conversion and explicit release have basic tests; Princess succession preserves leadership in the tested capture scenario.
- [x] Hiring opens at hour 4, repeats after 18 hours, and spends credits; docked units can promote while Queen travels; Queen transit blocks hiring.
- [x] Targeted Pirate speed, Navigator geometry/cooldown, Admiral promotion retiming, Foreman range, Tycoon cadence, Tinkerer drain, and Sentry cadence have focused tests.
- [ ] Exercise every combat priority against one Elder and paired Elders, including Martyr priority 1, General/King global effects, and post-combat Engineer/Pirate behavior. Global-versus-local suppression semantics need explicit expected outcomes.
- [ ] Verify reciprocal Thieves and reciprocal priority-eight damage with odd counts, multiple copies, and swapped combatant order; combine General and King with Assassin removing the final qualifying specialist. Source inspection alone isn't acceptance coverage.
- [ ] Verify gift contacts bypass Martyr/Assassin/Double Agent combat; gifts containing Queen and global specialists update both owners' effects and donor succession at contact; test both-gift contacts and gifts carrying captives. Official Subs says cargo transfers on contact; historical FAQ describes captive exceptions requiring clarification.
- [ ] Test Diplomat range boundaries and captive inactivity for every global effect; rescue and Hypnotist conversion competing at the same timestamp; retaking an outpost holding your own captive Engineer. Establish deterministic expected ordering before asserting parity.
- [ ] Test nearest-Princess succession in transit and after acquired Queens become Princesses; multiple simultaneous Queen losses; defeated players retain specialist effects while losing orders, cargo, mining, and funding, as required by [How to lose](https://subterfuge-game.com/rulebook/).
- [ ] Test global effect acquisition/loss during transit for gifts, Double Agent, capture, conversion, and defeat; combined speed specialists; captive-bearing manifests with Admiral; Pirate return reasons listed above. Admiral's current presence cap has a direct probe, not a committed regression here.
- [ ] Resolve the interpretation rows before claiming faithful specialist parity. Re-run focused acceptance cases against the parent's integrated commit. Mine-loss and wreck ownership remain the parent's separate verification responsibility.

No issue comments, recursive delegation, engine edits, test edits, or UI edits were made. The earlier `specialist-parity-review.md` remains historical; its follow-up records the previous corrections rather than new open defects.


## Implementation follow-up

The parent implemented [mission-scoped Pirate returns](pirate-missions.md) for mechanics version 3 after this audit. New behavior distinguishes released captives and ordinary route victories from genuine interception returns, persists return context, and clears it on Navigator redirection. Focused engine and durable server scenarios cover these cases. Older mechanics preserve their recorded behavior. The five interpretation gaps and remaining acceptance checklist above remain unresolved; this follow-up isn't full matrix or original-client certification.

Subsequent priority acceptance against engine `c782715` uses real dispatch, preparation, opposing-route contact, save decoding, and canonical replay in twelve scenarios, reversing command order in each case. Odd-count reciprocal single Thieves convert from both original manifests before Infiltrators terminate combat. Reciprocal priority-eight damage includes unequal numbers of War Heroes. Reciprocal Assassins remove both sides' local specialists before General eligibility is evaluated, while remote Kings retain their effect. A combined Lieutenant/War Hero/General/King case checks simultaneous post-specialist global damage and specialist-count tie breaking at zero drones. All twelve pass with mechanics revision 5; the scoped TypeScript check passes and no engine change was needed. Multiple-Thief interpretation, Elder/global suppression, the five interpretation rows, and the other unchecked interactions remain open. This doesn't establish a complete specialist matrix or current-client equivalence.

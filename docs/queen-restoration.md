# Restoring captive cores

Tracking: [#81](https://github.com/mcclowes/machination/issues/81), under [fidelity #18](https://github.com/mcclowes/machination/issues/18).

The publisher's [Queen and Princess entries](https://subterfuge-game.com/rulebook/Specialists.html) establish nearest-Princess succession after losing a Queen and conversion of an additional acquired Queen into a Princess. The rules were fetched again on October 29, 2026. They do not demonstrate the current client's precise downgrade moment. The rebuild restores control before counting the unit as active; it does not wait for the return hauler to dock.

## Corrected behavior

New configured games use mechanics revision 14. If a captive core returns to an owner who already controls an active core, the restored unit becomes a fallback core. The successor keeps its identity, location, hiring credits, and recruitment role. The restored fallback keeps its original identity and owner, travels on the actual return route where applicable, and supplies fallback sonar rather than a second core's shields when docked. It can succeed again if the current core is subsequently lost. Releasing a core never revives an eliminated player.

One control-restoration function covers explicit release, Diplomat rescue, battle recapture, gifts, and Double Agent exchanges. The latter paths can carry prisoners when their captor has no friendly outpost to send them to. Existing foreign-core conversion through gifts and Hypnotist remains unchanged. The strict one-active-core invariant is retained.

Batch restoration also counts cores already restored within cargo that has not yet rejoined the world. This matters when an Assassin kills the current core while two captive cores are being recovered: the first restored core can remain active, and subsequent ones become fallbacks. Processing follows manifest order; the exact original-client same-combat leadership ordering is unverified. No test treats that choice as established reference behavior.

Revision 13 could restore the original core after succession without downgrading it, leaving two active cores. The resulting state fails strict save decoding. This is reproduced through real capture and restoration, not inferred from source inspection. A server can write that state because database transactions do not validate every game before committing; the next service restart then refuses the damaged room.

## Existing rooms and histories

Revisions through 13 retain their recorded mechanics. No game or replay is silently upgraded, no strict validator is weakened, and no persisted core is chosen for demotion without its history. The version gate prevents the defect in new games; it does not repair an older room or change its future restoration behavior.

Before deploying against an existing database, run this read-only diagnostic on a backup:

```sh
node scripts/audit-queen-control.mjs /path/to/server-database-backup.json
```

Exit 0 means the one-core check passed for the scanned specialist-format rooms, 1 flags a missing or duplicate active core, and 2 means the scan could not complete. The report includes room indexes, mechanics revisions, factions, and counts. It omits room IDs, unit IDs, and credentials, and never writes the input. Pre-specialist formats are counted as skipped. This is a targeted diagnostic, not full save validation. Flagged rooms need history-based recovery before deployment; the tool does not invent a repair.

The known local development database has three version-one rooms, all skipped by this specialist-only audit. No hosted database was scanned, and no user data was changed.

## Acceptance

Twenty-three arranged engine scenarios cover both victory modes: release, Diplomat rescue, holding-site recapture, a captive carrier losing at a friendly site, transit combat, gifts at site and hauler contact, Double Agent exchange, and a restored fallback succeeding again. These include two cases recovering multiple captive cores after Assassin kills the current core, checking the one-core invariant without asserting which identity the original client would select. Another case keeps the active successor traveling during the original's release and docking, then checks hiring resumes only when the actual Queen docks. The carrier fixture deliberately begins with a departed captor that has no outposts, exercising the real keep-prisoners-aboard fallback. Commands, contacts, return movement, and later succession use the engine. These are controlled fixtures, not ordinary recruitment playthroughs or original-client traces.

Restoration checkpoints check one active core, strict saves, canonical replay, split advancement, observed replay export/decoding/seeking, original identity, and unchanged input. Release and rescue are checked while returning and after docking. Recruitment location/credits, shield capacity, and fallback sonar are checked. Two controls pin the old revision-13 failure and permanent elimination. Twenty-one of the twenty-three tests fail against the unchanged pre-fix source. Existing gift, nearest-Princess, and frozen recruitment compatibility cases also pass. Service persistence/retry acceptance is recorded on #81; native and current-original-client restoration remain unverified.

Source `001a718` passes all 1,041 regular tests, TypeScript, three production-server build/restart checks, and web/iOS/Android exports on Node 24.14.1. Verification used an isolated staged-source archive; all 472 tracked files were then matched to the committed Git blobs. Other agents' uncommitted map and practice changes were excluded. Five service scenarios cover authorization, retries, history, docking, repeated restart, later succession, and the legacy restart failure. Root review corrected a pre-arrival assertion that had advanced the wall clock without settling the game. Logs: `/tmp/machination-queen-restoration-full-check.log`, `/tmp/machination-queen-restoration-exact-export.log`; source metadata: `/tmp/machination-queen-restoration-exact-source.json`.

The test-only follow-up `2acc25b` closes the traveling-successor gap found by independent mutation review. All 32 combined core/service/succession checks and TypeScript pass. Restricting the helper's Queen lookup to outposts makes the new case fail with two active Queens. The earlier mutations removing restoration calls, the version gate, foreign conversion, or the temporary-cargo check also fail. These checks strengthen the stated invariants; they do not establish the original client's unresolved simultaneous ordering. The [signed QA package](native-builds.md#core-restoration-package) contains production source `001a718` and remains outside native runtime acceptance.

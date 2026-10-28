# Public outpost ownership

Issue #18 separates public ownership from sonar-only site detail. Version-two solo, multiplayer, history, and replay observations now include the current owner of every site. A neutral site has `owner: null`; `known: false` means its detailed state is hidden. Version-one saves retain omitted remote ownership.

## Reference and limits

The [official visibility rules](https://subterfuge-game.com/rulebook/) define outpost detail as type, drillers, and specialists. The [Intelligence Officer reference](https://subterfuge-game.com/rulebook/Specialists.html) gives remote type knowledge as a specialist benefit. Both support ownership being separate from detailed visibility. The [official 2014 Time Machine tutorial](https://vimeo.com/114210812), sampled at 02:00 and 02:15, shows colored remote sites. Those frames establish presentation in that build, rather than proving remote updates are fresh.

A [firsthand 2016 FAQ](https://herbertzhb.wordpress.com/2016/06/28/subterfuge-2/) explicitly describes remote third-party conquest updating map color and the Intelligence Report. This is historical secondary evidence. We haven't independently observed a fresh remote capture in the current original client. Public current ownership is the implemented fidelity interpretation; the evidence qualifier remains open.

## Information contract

Hidden sites use an explicit allowlist: id, name, coordinates, known, kind, and version-two owner. They expose no drones, specialists or unit IDs, modules, core identity, shields, production/mining clocks, or destroyed flag. Public mine types and active Intelligence Officer type knowledge retain their existing exceptions. A remote wreck retains its administrative owner under the existing mechanics, while destruction and former type remain hidden. This change doesn't settle original wreck counting or sonar rules.

Fresh snapshots update ownership after remote conquest. Historical snapshots use ownership at the requested time. Public ownership doesn't widen private orders, fleets, event audiences, channels, unit inspection, or command authorization. Replay archives, commands, digests, saved authoritative state, and mechanics versions are unchanged.

## Forecasts and UI

Hidden simulation placeholders stay neutral and inert. A separate public ownership ledger supplies domination accounting, without creating production, power, shields, mining, or zero-defender captures. Known conquests can change ownership and establish a projected win; unseen arrivals stay unresolved and retain baseline public owners. Supported mining wins remain visible. Published winners survive further inspection.

All forecasts with hidden version-two site detail carry `forecastUncertain`. The compact and expanded Time Machine display a caveat. Missing economy, global specialists, succession, routing destinations, and unseen battles can change projected outcomes. This is a conditional observation forecast, not a complete simulation of all possible hidden worlds. Remote owners are retained at baseline unless an observed outcome resolves; hidden effects aren't invented.

Solo and online maps color remote sites by owner while leaving detail unknown. Inspectors and accessibility labels distinguish rival, neutral, and legacy unknown ownership. Domination intelligence shows every participant's public territory total. Forecast totals carry an uncertainty note. Version-two gift controls accept remote public recipients, with the existing contact-time ownership transfer and execution checks. They grant no control of the destination. Version-one gifts retain their observed-recipient restriction.

## Verification

The integrated suite passes 316 tests, including strict observation allowlists, paired hidden-world invariance, remote third-party capture, historical ownership, authenticated HTTP replies, polling, retry receipts, restart, private channels, command denial, legacy fixtures, replay compatibility, and UI description wording. New forecast regressions first reproduced suppressed domination and mining wins, then passed with public territory accounting. A hidden remote conquest still cannot manufacture a projected win.

TypeScript, web export, and the standalone production server's two acceptance checks pass. Browser interaction for remote colors, inspectors, gifts, standings, and compact forecast copy remains unverified: Chrome returned `cgWindowNotFound`. Native phone acceptance and full matches remain open.

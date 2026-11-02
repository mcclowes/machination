# TestFlight build 8

Version **0.1.0 (8)** is available to the existing **Internal testers** group in [App Store Connect](https://appstoreconnect.apple.com/apps/6828789357/testflight). Apple reports `VALID` and `IN_BETA_TESTING`; testing notes and group membership were read back on November 2, 2026. Tracking: [release #196](https://github.com/mcclowes/machination/issues/196).

## Released source

Frozen source `89cada6ce9ae7334c61dcf64675fe77b1ac6e117` packages the tested local game at `6d42979`, with only the iOS build number changed. It includes packed replays, readable replay ranges, map interaction improvements, keyboard and enlarged-text fixes, cargo preservation while scrolling, and reduced-motion title behavior.

The separate merged UI/audio batch in [#182](https://github.com/mcclowes/machination/issues/182) and the then-uncommitted navigation fix in [#195](https://github.com/mcclowes/machination/issues/195) are excluded. Concurrent source, documentation, native-test, and Supabase changes remain untouched. Local candidates 6 and 7 are preserved; future uploads need a build number above 8.

## Artifact and verification

The IPA is `.data/acceptance/testflight-20261102/export/Machination.ipa`, 55,118,508 bytes, SHA-256 `55576b1378e05880d0d8bd2a46a7c68bc58386b4e5c7d01433f4ab19c22fb46f`. Apple accepted delivery `b5c70ce6-7df2-42e4-9db7-e8aafa9bed13`; the uploaded hash matches the verified IPA.

A fresh Xcode 27.2 device archive and export succeeded using Node 24.14.1 and an empty DerivedData directory. The earlier failed copied-cache run is retained as diagnostics and excluded from acceptance. The delivery log records a missing local resume-state file followed by a successful upload; Apple processing and testing state independently confirm acceptance.

- All 802 frozen tracked files match the release commit after generation, compilation, export, and before upload. All 37 installed direct dependencies match the lockfile, and the Pod lockfile is unchanged.
- Deep, strict archive/export signatures, signer membership, local certificate trust, unexpired App Store provisioning, production APNs, and disabled debugging pass. The provisioning profile expires October 18, 2027.
- Identity `com.mcclowes.machination`, version/build, iPhone/iPad support, exempt encryption, iOS device platform, and the bundled HTTPS multiplayer origin pass the artifact and repository verifiers.
- Archive and export contain identical 5,097,549-byte Hermes 96 runtime, SHA-256 `302db09c4183de15c5b689d4b069b6bf7bd39215b9981b31f1dc91d163338482`. Exact recompilation from retained Metro input, bytecode checksums, all 49 reference assets, and executable/dSYM UUIDs pass. Build logs confirm the frozen entry point and a requested Metro cache reset.
- Fresh lint, formatting, architecture, and TypeScript checks pass. All 645 product and verification inputs match the accepted #194 runtime exactly; its full gate passed 1,726 behavior and 20 packaged-server tests with zero failures or skips using disposable PostgreSQL plaintext and verified TLS fixtures. This full gate is retained evidence, not a newly repeated full suite.

The artifact workspace retains `source.json`, source/dependency manifests, build/export logs and results, signing checks, `check-provenance.json`, upload receipt, Apple processing/group/notes readbacks, and `release.json`.

## Service and acceptance limits

The bundled service is `https://machination-api-production.up.railway.app`; its final HTTPS health check returns `status: ok`. No backend rollout, account/provider change, tester invitation, external testing, or App Store submission is performed. Native account sign-in and push delivery remain disabled; production APNs entitlements do not establish delivery.

Physical-device gameplay, native offline behavior, full accessibility, and performance remain unverified. Prior selected simulator flows use the separately signed QA executable and do not establish interaction on this device IPA. At the largest text category, operation navigation labels remain a known issue in this frozen source. Existing saves retain their recorded rules.

## Testing notes

> Packed replay import and playback, smoother chart controls, clearer replay ranges, and improved iPhone/iPad keyboard and enlarged-text layouts. Fixes cargo changing while scrolling and respects Reduce Motion on the title screen. Test practice and solo first; existing saves retain their rules. Multiplayer still uses the current production service, with server-dependent updates pending. Account sign-in and push delivery are disabled. At the largest text setting, operation navigation labels can still wrap poorly. Physical-device gameplay has not yet been accepted. Internal testing only.

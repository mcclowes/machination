# Sound effects

Five operation cues are copied unchanged from Harrow (`../shogun/assets/audio`), using Max's supplied `harrow-sounds` recordings. Machination bundles its own copies and doesn't need Harrow installed.

| Machination cue | Harrow WAV | Original recording | Duration |
| --- | --- | --- | --- |
| Fleet launch | `ship_lift.wav` | `spaceship-takeoff.mp3` | 3.100 s |
| Signal | `radio.wav` | `radio-beep.mp3` | 0.425 s |
| Combat | `explosion.wav` | `artillery.mp3` | 3.500 s |
| Territory captured | `shield_charge.wav` | `shield-power-up-down.mp3` | 0.725 s |
| Territory lost | `shield_break.wav` | `shield-power-up-down.mp3` | 0.960 s |

Harrow's `assets/audio/README.md`, `edits.json`, and `tools/prepare_audio.py` document the original cuts, source hashes, fades, and peak levels. No new recording edits are applied here. The imported files retain Harrow's peak levels (0.5 for radio, 0.6 for takeoff, 0.8 for shield cues, and 0.9 for explosions).

The other nineteen cues are procedural. `npm run build:sounds` rebuilds only those and preserves the five recordings. To refresh a recording, copy its Harrow WAV to the corresponding Machination cue filename after reviewing the source edit.

| Group | Cues | When they play |
| --- | --- | --- |
| Controls | `tap`, `select`, `back`, `confirm`, `time` | Every `Pressable` in the app, via `src/components/Pressable.tsx`. `src/audio/press.ts` picks the cue from the control's label and role: dismissals sound `back`, clock and playback controls `time`, tabs and toggles `select`, committing orders `confirm`, and anything else `tap`. A `sound` prop overrides the choice or silences a control. |
| Orders | `schedule`, `cancel`, `error` | A plan you scheduled or withdrew, a cancelled launch or course change, and a rejected request. |
| Belt telemetry | `build`, `recruit`, `shield`, `pulse`, `council`, `intel`, `gift`, `signal` | New Signal log lines, classified in `src/audio/sound-cues.ts`. Unclassified lines fall back to `signal`. |
| Outcomes | `launch`, `combat`, `capture`, `loss`, `alarm`, `victory`, `defeat` | Your haulers leaving, combat, territory changing hands, core or King threats, and the end of the operation. |
| Diplomacy | `message` | A new direct or channel message from another operator in a multiplayer operation. |

Each observed update plays at most one cue, the most significant. All twenty-four cues are mono, 22,050 Hz, 16-bit PCM WAVs, and the shared Sound mute control applies to all of them.

The committed `defeat.wav` doesn't match what the script currently renders, even under the pinned Node version; the cause hasn't been traced. Restore the committed copy after a rebuild unless the defeat cue itself is being redesigned. Music sources and credits are documented separately in [the soundtrack notes](../music/README.md).

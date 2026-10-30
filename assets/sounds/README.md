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

Tap, scheduling, alarm, victory, defeat, and error cues remain procedural. `npm run build:sounds` rebuilds only those six cues and preserves the five recordings. To refresh a recording, copy its Harrow WAV to the corresponding Machination cue filename after reviewing the source edit.

All eleven cues are mono, 22,050 Hz, 16-bit PCM WAVs. Existing event priorities and the shared Sound mute control apply to both recorded and procedural effects. Music sources and credits are documented separately in [the soundtrack notes](../music/README.md).

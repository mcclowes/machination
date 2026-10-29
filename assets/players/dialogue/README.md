# Practice character art

`admiral.png` and `vesper.png` are 1024 × 1536 transparent illustrations generated with the built-in `image_gen.imagegen` tool from the admiral and pilot in `../roster.png`. The original profile sheet is preserved. `generation.json` records the full prompts and reference cells.

The practice dialogue overlay displays both characters above the chart, highlights the active speaker, and uses the same art across all five missions. Radio scripts live in `src/game/training-dialogue.ts`; they react to the actual exercise clock and assessment, never the inspected forecast. Playback stays within the attempt, resets on retry, and doesn't write game saves or completion progress.

Tracking: [issue #55](https://github.com/mcclowes/machination/issues/55).

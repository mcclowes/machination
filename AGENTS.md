# Machination

Expo/React Native strategy game about rival machine intelligences, with an authoritative Node multiplayer service and a Docusaurus player guide. Start with [README.md](README.md); design and implementation notes live in [docs/](docs).

## Setup

Use Node.js 24.14.1 from `.nvmrc`, then `npm ci`. Other Node versions can refuse the binary64 acceptance checks. See [testing](docs/testing.md).

## Commands

- `npm run check`: the full gate. Run it before committing behavior changes.
- `npm test`: behavior suite (`node:test` via tsx). For one file: `node --import tsx --test path/to/file.test.ts`.
- `npm run typecheck`, `npm run check:architecture`
- `npm run web`: browser app on port 8081. `npm run server`: local service on 127.0.0.1:8787, saving under `.data`.
- `npm run test:visual`: Playwright specs in `visual-tests/`.
- `npm run check:docs`: player guide typecheck, generation, and strict-link build. Run `npm ci --prefix website` first.

## Layout

- `src/game`: pure, deterministic rules engine. It may import only from `src/game`, with no external packages.
- `src/contracts`: wire types and response validation shared by client and server. It may import only from `src/contracts` and `src/game`.
- `server`: authoritative multiplayer service. It may import only from `server`, `src/game`, `src/replay`, and `src/contracts`.
- `src/replay`, `src/solo`, `src/online`, `src/components`, `src/audio`, `src/content`: client-side modules. `App.tsx` is the entry point.
- `website`: player guide. `website/docs/reference/rules.md` and `specialists.md` are generated from `src/content/field-manual.ts` and `src/game/specialist-catalog.ts`, so edit the sources rather than the output.

`scripts/check-architecture.mjs` enforces these boundaries.

## Conventions

- Tests sit beside the code as `*.test.ts`.
- Gameplay changes are gated by mechanics revision (`rules.mechanicsVersion`, default set in `createConfiguredGame` in `src/game/world.ts`). Saved games are never upgraded and keep their recorded rules, so a rule change needs a new revision rather than an edit to an old one.
- Use original names, art, and writing. Subterfuge is a reference for strategic parity only; see [subterfuge parity](docs/subterfuge-parity.md) and [terminology](docs/terminology.md).
- Keep docs in `docs/` accurate when behavior changes, especially revision numbers, counts, and file paths.

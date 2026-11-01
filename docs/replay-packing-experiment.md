# Replay packing experiment

Tracking: [replay export capacity #158](https://github.com/mcclowes/machination/issues/158).

The current exporter can exceed its 250,000-record budget during an ordinary completed ten-seat pulse operation. Increasing the limit or merging mathematically equivalent motion laws would bypass the release requirement: binary64 evaluations can differ when their anchors change.

`scripts/measure-replay-packing.mjs` measures an offline alternative. It interns whole disclosed site objects and public rules by exact structural identity. All groups, causal states, timestamps, scene anchors, fleets, pulse data, and other fields remain in place. It reconstructs every scene and asserts deep equality with the input, including signed zeros. Object key insertion order does not affect identity; absent fields, nulls, array order, and adjacent representable numbers do.

Run against a private **observed timeline**, not an authoritative room or command archive:

```sh
node scripts/measure-replay-packing.mjs /path/to/observed-timeline.json
node --test scripts/measure-replay-packing.test.mjs
```

The CLI prints counts only and does not write the input or packed data. Input files are limited to 64 MiB. This is a trusted local diagnostic, not an untrusted-input decoder. Record counts include every object, array, and primitive; byte counts are serialized UTF-8 JSON sizes, rather than the exporter's estimated string budget. The extra experiment envelope is included in packed counts.

## Measured baseline, November 1, 2026

Node 24.14.1, current source based on `1b8ca97`, default mechanics-19 gravity, seed 2026, ten seats, pulse mode, rivals disabled, hours 0–8:

| Metric | Original | Experiment |
| --- | ---: | ---: |
| Stored records | 43,691 | 10,327 |
| Serialized bytes | 663,646 | 97,770 |
| Groups / causal states / spans | 14 / 27 / 13 | 14 / 27 / 13 |

The dictionary contained 154 distinct site objects and one rules object. Exact in-memory reconstruction passed. The diagnostic also tests changed visibility disclosures, null versus absent fields, neighboring binary64 coordinates, signed zeros, and unchanged input ownership.

This baseline is not the failing terminal scenario. The private capture and packing handoff named in #158 were absent from this machine on November 1. No conclusion about that capture's fit follows from this smaller baseline.

## Requirements before production adoption

- Recover or independently reproduce the failing complete-game timeline, preserving its full requested interval. Measure dictionary fit against the existing limits.
- Specify schema 3 explicitly. Keep schemas 1 and 2 unchanged and negotiate support with released clients.
- Keep the runtime representation packed. Materialize only the selected frame, rather than expanding the complete history during decoding or playback.
- Bound dictionary nodes, references, selected-frame expansion, reachability validation, and semantic work. Reject invalid or unreachable references and budget violations before expansion.
- Prove seek equivalence for each causal ordinal, boundary, and interior evaluation with independent engine observations. Preserve privacy and export-local aliases.
- Define serialized numeric fidelity separately. This experiment proves in-memory structural equality; JSON byte measurements do not prove signed-zero wire preservation.
- Run current-source repository gates, complete the bounded HTTP/SQL endgame scenarios in #157, and build a fresh native candidate before publication.

The experiment does not implement schema 3, change export behavior, raise limits, or certify release readiness.

The subsequent [schema 3 codec](replay-schema-3.md) implements bounded dictionary validation, selected-frame playback, and signed-zero JSON serialization. The experiment remains an offline measurement tool. Incremental export generation and client/service integration are now implemented locally; see that document for negotiation, endgame evidence, and remaining release gates.

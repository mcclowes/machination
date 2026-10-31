# Service capacity measurements

The October 30, 2026 run measures the real `GameService` and atomic JSON persistence on Node 24.14.1 / V8 `13.6.233.17-node.44`. It creates disposable three-seat fixed-chart operations, submits 100 shield commands to one active operation, advances the server clock 24 hours, then samples ten snapshots and ten historical reconstructions. Other operations remain in the same database.

```sh
turnstile run --class test -- npm run benchmark:service -- \
  --rooms=1,10 --commands=100 --samples=10 --hours=24
```

| Rooms | Database bytes | Command p50 | Snapshot p50 | History p50 | Command p95 | History p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 38,349 | 18.21 ms | 6.51 ms | 47.56 ms | 52.19 ms | 211.74 ms |
| 10 | 161,744 | 20.88 ms | 14.86 ms | 94.46 ms | 96.95 ms | 415.69 ms |

The queued poll behind a historical read completed in 71.44 ms in the one-room case and 49.56 ms against a different room in the ten-room case. Catch-up took 85.26 ms and 26.86 ms respectively. Snapshot p95 was 738.25 ms versus 70.89 ms. These nonmonotonic timings came from a contended shared Mac and aren't a deployment capacity estimate. The run also included concurrent uncommitted gameplay work; it isn't a certified release benchmark.

The benchmark records event-loop delay separately: p99 was 254.54 ms / 168.82 ms, and maximum delay was 721.42 ms / 379.06 ms. Those measurements include host scheduling and other machine activity. The reported request times cover service execution and persistence, not network transit or Clerk token verification.

## Original decision

Retain the existing single-process JSON store. This run doesn't justify replacing persistence. It does demonstrate that historical reads and global snapshot writes deserve continued measurement as operation count and retained history grow.

That was the decision from this measurement. Current source also supports [Postgres storage](postgres.md) following #111; these JSON timings don't establish Postgres capacity, Supabase latency, or a safe production load.

The command supports up to 100 rooms, 1,000 retained commands, 100 samples, and 47 catch-up hours. Use larger histories on a quiet host before selecting checkpoints, room-scoped persistence, or SQLite. A command limit is a supported workload bound, not a promise that its largest combination is fast.

The script deletes only its own temporary directory, reports Node/V8 with each case, and never reads or modifies `.data`. It also distinguishes same-room and different-room queued polls. No storage format, transaction ordering, replay rule, or deployment replica count changed.

Raw run evidence: `/tmp/machination-quality-service-benchmark-final.log`.

## Ten-seat SQL acceptance, October 31

A separate functional acceptance run used frozen server source `3d07357`, Node 24.14.1, ten independent HTTP credentials, a localhost fault proxy, and disposable PostgreSQL 17. It used the real SQL adapter and current/released response decoders. It did not access production state.

| Recorded mechanics | Clients | Gravity | Result |
| --- | --- | --- | --- |
| 18 | Five released build 2 clients and five current clients | Disabled | Passed |
| 19 | Ten current clients | Enabled | Passed |

Both cases filled the lobby, kept lobby time frozen, restricted starting to the host, and retained each seat on invitation retry. Bilateral messages were visible only to sender and recipient; a private group was visible only to its three fixed members. Hidden site inventories remained redacted. A current client's preferred color survived the mixed-client representation.

The proxy dropped one successful order response after its upstream body was received. The actual released/current request code treated the disconnect as retryable. The service and database were then restarted before retrying the same command ID. The retry retained one launch, one ten-drone charge, the original launch identity, the same receipt, and the recorded rules. Exact state comparison accounts for normal same-hour engine settlement and the stored-room validator's zero seat-revision defaults; it does not round numbers or change mechanics.

After a controlled four-hour catch-up, all ten seats decoded their snapshots and one-hour history, and an excluded seat decoded a shared replay without receiving private message content. Another order retry left the settled SQL room bytes unchanged. Revision 19 also refused legacy snapshot/order requests without changing its stored room. Both cases completed with exit 0, including fixture cleanup.

This is local functional evidence, not a hosted capacity estimate, native UI test, or physical-device result. The fixture used explicit loopback plaintext, not hosted TLS, and retained only a short command history. Its response timing samples exclude history/replay and the dropped response; they must not be compared with the earlier file-store benchmark as equivalent workloads. Hosted latency, sustained load, long histories, and device responsiveness remain release gates.

The one-off harness and sanitized evidence are retained in `/private/tmp/machination-testflight-build3-20261031-15kun1d5/acceptance-ten-seat-sql/`. The harness SHA-256 is `005444519e8ed1aecc8ac4ad546accf3ca40a25698d966a51d32055eba7e3a04`; its frozen source manifest SHA-256 is `6325deba7b5d4924d058b4642735df59d40b2781a89e390a7826b41b3d2c5ef8`. This manual acceptance run supplements the full gate; it is not a new standing CI check.

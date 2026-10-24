# CI performance and lifecycle acceptance — 24 October 2026

## Matched warm measurements

Same mini (24 GiB RAM, 10 CPUs), templates, native app/test sources and serialized
runner capacity. Every Mac sample includes lint, format, Debug build, unit tests,
Release build, ad-hoc signing, zip and upload. iOS remains app/UI-test-bundle
compilation, not UI behavior execution. No app or test products are reused.

Baseline: `3b0e1c7`, runs 139/140 attempts 3–5. Candidate: `404fa55`,
runs 163–168. These are zero-native-source-change rebuilds; deliberately changed
source rejection is checked separately. Later host-only recovery/diagnostic
changes preserve guest commands and dependency keys and are verified separately.
All nine candidate dependency restores (Debug, Release, iOS in each pair) hit.
The first candidate pair was already warm from successful compatible priming runs;
it is not a cold sample. Provisioning/download cost is excluded: templates were
already installed. First-key cold build/cache-publication cost is reported separately.

| Metric | Baseline median | Candidate median | Change |
|---|---:|---:|---:|
| iOS runner execution | 120 s | 81 s | 32.5% faster |
| Mac with Release execution | 257 s | 238 s | 7.4% faster |
| Combined runner execution | 377 s | 320 s | 15.1% faster |
| Combined observed queue → result | 448 s | 323 s | 27.9% lower; queue affected |

| Pair | Baseline execution / queue → result | Candidate execution / queue → result |
|---|---:|---:|
| 1 | 380 / 382 s | 320 / 474 s |
| 2 | 377 / 448 s | 314 / 319 s |
| 3 | 375 / 554 s | 322 / 323 s |

Times come from Gitea job created/started/completed timestamps and include upload
and runner teardown. Combined execution spans first lane start through last lane
completion; combined latency starts at the first job creation. Baseline queue waits
were 2/71/179 s before its first lane; candidate waits were 154/5/1 s. Other PR jobs
occupied the runner in contended samples. Therefore **15.1% execution improvement**
is the defensible comparison; the full 27.9% observed latency reduction cannot all
be attributed to these changes. Execution spreads do not overlap (375–380 versus
314–322 s); neither lane regressed.

The largest remaining stage is optimized Release compilation, about 2m20s. Mint's
pinned lint binary is reused; no lint-tool compilation or image pull appears in
accepted candidate runs. The baseline needed eight bounded image-cache restorations
during this batch; that temporary guard was stopped before candidate measurements.
Candidate templates/OCI references survived unaided.

## Correctness and lifecycle

64 tooling tests pass (19 worker/cache, 3 iOS orchestration, 6 preview, 36
native-loop). Public command checks cover low disk, template drift, aggregate
resources, invalid seeds, changed inputs/current source, partial clone cancellation,
command expiry, TERM-ignoring descendants, active-run exclusion, cleanup failure,
private-only recovery, cache non-publication on cleanup failure and bounded log
retention after workspace deletion. Standards and Spec reviews have no outstanding
source findings after their corrections.

Installed runner: Homebrew `gitea-runner v3.3.0`. A disposable dispatch-only branch
exercises the real runner and real Tart ownership. Cancellation → next-job
completion (a stricter interval than just cancellation → release):

| Phase | Seconds | Outcome |
|---|---:|---|
| Clone command | 11.68 | Cancelled; owned stopped clone reclaimed |
| Guest startup/readiness | 8.70 | Cancelled; owned guest reclaimed |
| Mac compilation | 8.65 | Cancelled; next reconciliation passed |
| Mac tests | 6.40 | Cancelled; next reconciliation passed |
| Upload action | 11.50 | Cancelled; next job passed |

The clone fixture runs a real local clone, then deliberately holds its command
before returning, exposing the partially created-worker boundary. Startup, build
and test cancellation use the real native command. All are below the 120-second
acceptance ceiling. A real abrupt orchestrator SIGKILL/restart also reclaimed only
its recorded worker, followed by an idempotent second reconciliation. This does
not imply a SIGKILL trap.

A controlled stalled Node upload action failed after 60.31 s at a one-minute
fixture step limit; production uploads use the same runner mechanism with a
two-minute limit. Controlled upload exit 23 failed the job. The actual
`actions/upload-artifact@v3` action also failed on a deliberately missing required
artifact. Production required artifacts now use `if-no-files-found: error`.
[Matching runner deadline implementation](https://gitea.com/gitea/runner/src/tag/v3.3.0/act/runner/step.go)
is supplementary; installed-runner receipts establish the observed behavior.

Real isolated iOS cache cases:

- Corrupt host seed: discarded, cold build succeeded, owned/private cleanup passed
  (68.79 s direct lane, guest build 35.34 s).
- Deliberate Swift `#error` with a valid dependency seed: current source failed
  compilation; no cached app success could satisfy it (50.86 s).
- Changed project input: different dependency key, cold rebuild succeeded and
  private cleanup passed (66.06 s direct lane, guest build 32.87 s).

These direct lane durations exclude Gitea checkout/tooling tests/upload and must
not be compared as whole-CI times. Some correctness probes overlapped another
admitted guest; they are not additional performance samples. Source fixtures were
restored afterward. Actual template fingerprints remained unchanged throughout.

Failed samples remain in the archive: an unchanged playback-lifecycle unit-test
flake occurred on baseline and candidate; an early candidate's successful iOS
build was followed by a process-cleanup EPERM failure, which led to UID-scoped
cleanup; one early iOS tooling run failed transiently and was retained (30 case
executions on the mini subsequently passed); and the first disposable upload
fixture had an ES-module mismatch, corrected before any upload acceptance claim.
None is included in the successful timing distribution.

## Capacity and retained evidence

CPU/memory admission accounts for every running task and CI guest: each template
uses 4 CPUs/8 GiB; two guests use 8 CPUs/16 GiB on this 10-CPU/24-GiB host, leaving
8 GiB. Production runner capacity stays one. No throughput gain from raising
runner capacity is claimed.

During the accepted warm batch, 97 ten-second samples observed free disk
between 18.31 and 15.74 GiB, a 2.57-GiB excursion including guest writes and
Release output. The 12-GiB admission reserve budgets 2.6 GiB observed writes,
1 GiB extra cache/artifact/retained-diagnostic headroom and 8.4 GiB operational
margin. This is a calibrated starting budget, not a guarantee for larger future
workloads; remeasure after toolchain/dependency growth. No unrelated VM or cache
is deleted to satisfy admission. Five 64-MiB host histories cap retained logs
at 320 MiB plus small JSON. Publication staging is bounded and runs after guest
memory has been released.

Raw API timing receipts, full accepted job logs, failure samples, command-test
results, lifecycle receipts and inventory are retained with the PR evidence archive.
No UI changed, so screenshots would not demonstrate this CI change.

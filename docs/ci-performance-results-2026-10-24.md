# CI performance and lifecycle acceptance — 24 October 2026

## Matched warm measurements

Same mini (24 GiB RAM, 10 CPUs), templates, native app/test sources and serialized
runner capacity. Every Mac sample includes lint, format, Debug build, unit tests,
Release build, ad-hoc signing, zip and upload. iOS remains app/UI-test-bundle
compilation, not UI behavior execution. No app or test products are reused.

Baseline: `3b0e1c7`, runs 139/140 attempts 3–5. Final candidate: successful
native-edit commit `86a65d0`, whose CI code is byte-identical to implementation
`cd004c5`; accepted pairs are 187/188, 191/192 and 193/194. The disposable edit
adds a comment to shared `ArcadiaApp.swift`, outside the implementation PR.

Baseline samples are explicitly a **forced-full-app-recompile proxy**, not literal
edit samples. All six accepted Mac logs contain 63 matching app SwiftCompile
entries, including the same 57 individually logged Debug source files and Release
bulk compilation; `ArcadiaApp.swift` is included. App/test products are excluded
from seeds, and dependency inputs are unchanged by the edit. This establishes
matched compilation work for a one-line successful edit without claiming baseline
edits occurred. The independent Spec review accepted this documented equivalence.

All nine final dependency restores (Debug, Release, iOS in each pair) hit.
The caches were already primed by compatible successful jobs. Local identity
provisioning was measured separately at 0.074 s Mac and 0.066 s iOS, without boot
or download. Image/Xcode installation was an existing prerequisite and was not
repeated or timed. First-key cold build/publication costs appear below.

| Metric | Baseline median | Final candidate median | Change |
|---|---:|---:|---:|
| iOS runner execution | 120 s | 82 s | 31.7% faster |
| Mac with Release execution | 257 s | 237 s | 7.8% faster |
| Combined runner execution | 377 s | 319 s | 15.4% faster |
| Combined observed queue → result | 448 s | 321 s | 28.3% lower; queue affected |

| Pair | Baseline execution / queue → result | Final execution / queue → result |
|---|---:|---:|
| 1 | 380 / 382 s | 319 / 320 s |
| 2 | 377 / 448 s | 317 / 321 s |
| 3 | 375 / 554 s | 321 / 324 s |

Times come from Gitea job created/started/completed timestamps and include upload
and runner teardown. Combined execution spans first lane start through last lane
completion; combined latency starts at the first job creation. Baseline first-lane
queue waits were 2/71/179 s; final candidate waits were 1/4/3 s. Other PR jobs
occupied the runner in contended baseline samples. Therefore **15.4% execution
improvement** is the defensible comparison; the full 28.3% observed latency
reduction cannot all be attributed to these changes. Execution spreads do not
overlap (375–380 versus 317–321 s); neither lane regressed.

An earlier implementation (`404fa55`, three pairs 163–168) measured 320 s combined
median, retained as intermediate evidence. Final samples above include all added
tooling regressions and final host cleanup/diagnostic code. Failed pair 189/190
hit the unchanged playback lifecycle test and is retained, not counted as success.

### Phase deltas

Median seconds from accepted job logs:

| Phase | Before | Final |
|---|---:|---:|
| Mac pinned lint | 9.62 | 5.00 |
| Mac format | 0.88 | 0.95 |
| Mac Debug build | 49.01 | 34.86 |
| Mac unit execution | 13.57 | 12.72 |
| Mac Release build | 165.06 | 142.14 |
| Existing three iOS tooling tests | 47.07 | 1.71 |
| iOS dependency resolution | 16.11 | 9.67 |
| iOS dependency compilation state | 7.63 | 6.57 |
| iOS app compilation state | 6.60 | 7.34 |

Mac build/test rows stop at their success marker and exclude subsequent cache
restore/extraction. iOS compiler rows sum logged wall-state intervals: Xcode
interleaves targets, so these are not CPU profiles or independently summable
critical paths. The largest iOS improvement removes roughly 45 s of fake-VM
process waits in the existing three tooling tests; their assertions remain.
Additional worker/cache and native-loop checks are included in final timings.
The largest remaining stage is optimized Mac Release compilation (~2m22s).

Mint's pinned binary is reused; accepted final logs show no lint-tool compilation
or registry image pull. The baseline needed eight bounded cache restorations;
that temporary guard was stopped before candidate measurements and then removed.
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
The final-edit failed sample also retained its downloadable compact XCTest
summary (`XCTAssertEqual`: 3 versus 2 calls). None is included in successful timing
medians; this existing app-test flake remains a reliability limitation outside this
CI-only implementation. No assertion was weakened or skipped to obtain a pass.

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

Final implementation PR checks at `cd004c5` passed both lanes before the final
successful-edit batch. Real Release output was downloaded through Gitea's UI
artifact route: both zip CRCs validated and the app executable was present. iOS
compile evidence and Mac lifecycle/test summaries were also downloaded and
validated (Mac unit target: 35 passed, 3 unchanged skips). Gitea 1.27.3's REST
artifact listing returned empty for these legacy-v3 uploads; the verified UI
route is recorded in the evidence receipts.

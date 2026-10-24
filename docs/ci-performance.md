# Fast isolated native CI

Mac and iOS CI keep their existing checks and outputs. Each job owns a fresh,
background Tart clone. The host coordinates work; builds run in the guest.

## Provision once, not in PR jobs

On the runner host, use the existing stopped Mac template
`arcadia-ci-xcode-26-5-cache` and iOS template
`arcadia-mobile-xcode-27-1-27a9275`. Provisioning an image or updating Xcode is
an explicit maintenance action. Once the correct template is installed:

```sh
python3 scripts/ci-worker --template arcadia-ci-xcode-26-5-cache --artifacts artifacts/provision --provision
python3 scripts/ci-worker --template arcadia-mobile-xcode-27-1-27a9275 --artifacts artifacts/provision --provision
```

Provisioning records local config/NVRAM hashes, the available OCI-manifest hash,
and disk size, inode/device identity and nanosecond modification time. Disk writes
or replacement therefore require explicit reprovisioning without hashing 87 GiB
on every job. This detects ordinary template drift; it is not a cryptographic
attestation against an administrator deliberately rewriting disk metadata.
It does not boot, download or modify the template. Reprovision only after an
intentional verified toolchain change. Jobs reject absent or changed identities.
Mac `TART_IMAGE` and iOS `NATIVE_IOS_TEMPLATE` now select **local template names**,
not registry tags. Normal clones disable automatic pruning after disk admission.

## What stays warm

The existing Mint cache supplies the pinned lint tool. Dependency seeds contain
package checkouts, dependency build products and compilation metadata, using the
existing native-loop dependency filter. They exclude Arcadia app/test products,
runtime state and credentials. Every guest receives a private copy. A seed key
includes template identity, resolved packages, project settings and cache/filter
implementation. Bad checksums fall back to a cold build. Only successful jobs
publish seeds after VM and private-input cleanup. Stable guest source and DerivedData paths preserve signatures.

The cache is an optimization: current source still builds and current tests run.
The first successful job for a new key is cold. Compatible seeds are retained
rather than recompressed on every warm job.

## Ownership, admission and recovery

A short host lock serializes admission and shared-cache publication; up to two CI
workers can build concurrently. A third worker waits for capacity for at most five
minutes (`--admission-timeout`); `--max-workers 1` restores serial admission.
Ownership reserves CPU/memory even while a clone is stopped during startup or
cleanup. Admission stays locked until Tart reports the guest running so older
checkout versions can also see its budget. Cancelled/failed workers skip shared
cache publication; successful publication waits at most 15 seconds. Optional
diagnostic pruning uses its own nonblocking lock. The default total running-guest ceiling is two,
including separately running task VMs. Admission also sums their configured
CPU/memory budgets, leaves at least 4 GiB or one quarter of host RAM (whichever
is larger), and refuses CPU oversubscription. Unknown active-guest budgets fail
closed. The observed templates each use 4 CPUs and 8 GiB RAM on the 10-CPU,
24-GiB mini. The disk reserve is 12 GiB, calibrated against a 2.57-GiB observed warm
write excursion plus artifact/cache/diagnostic headroom and an explicit margin;
see [measurement results](ci-performance-results-2026-10-24.md).
Each existing CI worker adds 3 GiB to the free-space admission floor to cover its
measured warm write burst. `ARCADIA_CI_RESERVE_GIB` can set the operating budget. Remeasure after workload
or toolchain growth. Admission refuses work instead of deleting unrelated resources.

Ownership is recorded before cloning. Cancellation terminates the owned process
group within its own UID and stops/deletes only the recorded clone with bounded waits. Cleanup errors
are visible failures. After a crash, reconciliation requires both a dead owner PID
and authoritative confirmation that the corresponding Gitea run completed.
Missing credentials or an active run prevent automatic reclamation. Reconciliation verifies actual VM
absence after cleanup; a stop error followed by successful deletion is retained
as an attempt warning rather than permanently poisoning admission. CI supplies
`ARCADIA_CI_TOKEN` for this read; the credential is never written to receipts or
passed as a guest build argument. `--reconcile` runs the same recovery check alone.

Artifacts include `worker.json` and a bounded local `worker.log`.
The host keeps the five most recent owned histories under
`~/.cache/arcadia-ci/evidence/<vm>/`, independently of the runner workspace:
up to 64 MiB of streamed log per run plus compact JSON (at most 1 MiB per
supplemental summary). This survives workspace deletion and failed uploads.
Unknown evidence directories are not pruned. Per-worker dependencies and iOS
source inputs live under `state/private/<vm>`; authoritative restart recovery
also retries these after the VM has already been removed.
Cache publication buffers at most three validated 512-MiB seeds after the VM
is gone, removes private storage, then commits the dependency-only seeds. Compact Mac XCTest failure summaries are exported before a failed worker is
removed. Existing iOS compile logs, source guards and the main Release zip remain. Upload steps have a
two-minute deadline and skip obsolete cancelled jobs. Required upload failures
remain failures; local evidence survives upload failure.

## Measure the whole feedback path

Both workflows support manual dispatch. Mac dispatch's `release` input includes
the normal main Release output for matched comparisons without merging a candidate.
Keep PR and Release results separate. Capture server run/job created, started and
completed times as well as worker/guest phase timings. Include queue delay and
upload completion, cache state, source revision, host contention and cleanup.

Compare at least three successful matched warm Mac+iOS cycles before and after;
retain failed attempts too. Require a lower combined warm median, no unexplained
per-lane regression, no registry pulls or lint recompilation, unchanged checks and
artifacts, and passing cancellation/cache-invalidity/cleanup experiments. Increase
sample count when spread prevents a conclusion. No speedup is claimed until those
receipts exist.

Deterministic tooling checks run without Xcode or a VM:

```sh
python3 -m unittest discover -s scripts/native_ci -p 'test_*.py'
python3 -m unittest discover -s scripts/native_ios -p 'test_*.py'
```

Real acceptance additionally covers cancellation during clone, startup, compilation,
tests and upload; orphan recovery after abrupt termination; low-disk refusal; and
the next queued job starting without manual repair. Template and cache retention
must be verified after each controlled experiment.

## Runner concurrency

The mini's runner has a separate `runner.capacity` setting. Keep it at one until
matched real measurements support two. Worker concurrency does not change the
runner's setting by itself. Change capacity only with no active jobs; keep the
ceiling at two on the 10-core/24-GiB mini. A separate task VM consumes one of the
two total guest slots and remains subject to admission checks.

Use an explicit runner config containing `runner: {capacity: 2}` and pass its
absolute path to `gitea-runner daemon --config ...`. Preserve all other runner
configuration, labels and registration. Roll back to `capacity: 1` if queue-to-result
latency or memory pressure regresses; no VM template or cache change is needed.

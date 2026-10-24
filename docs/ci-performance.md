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

Provisioning records the local config and available OCI-manifest fingerprint.
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
publish seeds. Stable guest source and DerivedData paths preserve signatures.

The cache is an optimization: current source still builds and current tests run.
The first successful job for a new key is cold. Compatible seeds are retained
rather than recompressed on every warm job.

## Ownership, admission and recovery

One lock admits one CI worker. The default total running-guest ceiling is two,
including separately running task VMs. The initial disk reserve is 12 GiB;
`ARCADIA_CI_RESERVE_GIB` can set the measured operating budget. This initial value
must be checked against observed peak writes and Release/artifact headroom before
rollout. Admission refuses work instead of deleting unrelated resources.

Ownership is recorded before cloning. Cancellation terminates the owned process
group and stops/deletes only the recorded clone with bounded waits. Cleanup errors
are visible failures. After a crash, reconciliation requires both a dead owner PID
and authoritative confirmation that the corresponding Gitea run completed.
Missing credentials or an active run prevent automatic reclamation. CI supplies
`ARCADIA_CI_TOKEN` for this read; the credential is never written to receipts or
passed as a guest build argument. `--reconcile` runs the same recovery check alone.

Artifacts include `worker.json` and a bounded local `worker.log`. Existing iOS
compile logs, source guards and the main Release zip remain. Upload steps have a
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

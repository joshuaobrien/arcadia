# Isolated native CI with established build and cache tools

Gitea runs two native lanes concurrently on the mini. Each job owns a disposable,
background Tart clone. Fastlane builds/tests inside the clone; the unmodified
`irgaly/xcode-cache` action and Gitea's cache service own cache persistence.

## Tooling and templates

`Gemfile.lock` pins Fastlane and its transitive dependencies. Ruby and gems are
installed **once during template provisioning**, never during a normal job.
Clone the existing Xcode template, boot it privately, and run inside that clone:

```sh
./scripts/ci-provision-fastlane /path/to/checkout
```

Stop it before recording its immutable identity using `scripts/ci-worker --provision`.
The prepared template names are `arcadia-ci-xcode-26-5-fastlane-2-241-1` and
`arcadia-mobile-xcode-27-1-fastlane-2-241-1`. The earlier templates remain available
for rollback. Intentional toolchain changes need a new cache namespace and explicit
reprovisioning. Existing config/NVRAM/manifest hashes and disk metadata validation
still reject template drift without hashing the whole image every job.

## Cache ownership and VM boundary

The workflows pin the upstream Xcode cache action and Node 24. Debug, Release and
iOS have separate keys, including toolchain namespace, resolved package/project
settings, Fastfile and Gemfile.lock. Revision-specific keys have compatible restore
prefixes. Gitea's existing cache service handles archive transport and eviction.
The action restores source mtimes only when content hashes match, and preserves
DerivedData metadata. No private build database decoding or rewriting is used.

Host job paths are unique; the action restores `.ci-derived/<variant>` in that
job's checkout. Tart exposes it through a private `derived` mount. Fastlane uses
native `cp -aX` into stable guest-local DerivedData paths, builds/tests, then exports
back through the same mount. Source archives use native POSIX/PAX tar end to end.
Python still validates iOS archive members before native extraction; it no longer
serializes/extracts metadata through floating-point timestamps.

The upstream action saves in its success-only post phase, **after** worker cleanup.
Worker cleanup removes its private inputs and VM while preserving job DerivedData
for this post phase. Runner workspace cleanup later removes the job directory.
The old seed archive code, checksum receipts, publication enumeration and package
product allowlists are no longer part of CI. Interactive native-loop dependency
helpers remain scoped to that separate workflow.

Full incremental app/test products may now be reused by the established action.
This never skips tests: Mac runs the same ArcadiaTests target, iOS still builds
both app and UI-test runner without claiming UI execution, and Release preserves
its base URL, ad-hoc signing verification and Arcadia.zip. Changed-source and
intentional-regression probes must demonstrate invalidation. Cache-hit messages
alone are not acceptance evidence; inspect actual compiler work in warm guests.

## Isolation, admission and diagnostics

Up to two workers build concurrently. A short host lock reserves CPU/memory and
keeps startup visible to older checkout versions before release. The total guest
ceiling is two, including task VMs; CPU budgets cannot exceed host cores, memory
leaves at least 4 GiB or one quarter of RAM, and disk reserve remains 12 GiB plus
3 GiB per existing CI worker. A third worker waits at most five minutes.

Cancellation stops the owned process tree and removes only its recorded VM.
Cleanup failures remain failures. Crash reconciliation requires a dead owner PID
and authoritative completed-run confirmation; active runs are never reclaimed.
Five bounded local worker histories survive runner workspace removal, and optional
diagnostic pruning never blocks cancellation. Fastlane raw logs/JUnit and existing
JSON summaries remain available. Required uploads retain two-minute deadlines and
skip cancelled obsolete jobs.

## Validation and rollback

Run command-boundary tests with fake VM tools:

```sh
python3 -m unittest discover -s scripts/native_ci -p 'test_*.py'
python3 -m unittest discover -s scripts/native_ios -p 'test_*.py'
```

Real acceptance covers cold and fresh-guest warm builds, actual dependency reuse,
changed source/build inputs, deliberate failures, simultaneous lanes, cancellation,
Release packaging and cleanup. Compare normal PR and Release timings separately.

Reverting the workflow/tooling change restores the old templates and seed path;
no app or backend migration is involved. Runner capacity remains two, with its
original capacity-one launch configuration retained on the host for rollback.

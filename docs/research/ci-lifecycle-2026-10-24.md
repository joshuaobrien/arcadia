# Reliable CI image and worker lifecycle on the Mac mini

Research for [Determine a reliable CI image and worker lifecycle on the Mac mini](http://100.112.160.16:3456/tasks/86), within [Reliable agent work from feedback to verified merge](http://100.112.160.16:3456/tasks/84). Baseline: `3b0e1c7a35720dcceca0efc6f3fd8bdecc4fddab`. Research only: no host, runner, workflow or application changes.

## Recommendation

Repair the existing mini first. Keep disposable background VMs and the current Mac/iOS checks and Release artifact contract. Provision immutable, stopped local templates outside ordinary jobs; admit jobs only when measured disk and worker capacity permit; give every run an explicit ownership record and bounded cancellation/cleanup. Treat artifact upload as a separately bounded stage. Do not turn the temporary cache-restoration poller into permanent infrastructure.

This is a proposed design based on the evidence below, not an accepted implementation plan or a claim that cancellation is already reliable. A subsequent live decision should settle operating thresholds and failure policy.

## Evidence and failure boundaries

The current [Mac workflow](../../.gitea/workflows/native.yml) already declares concurrency cancellation, a 60-minute job timeout and main-only Release upload. [Mac orchestration](../../scripts/ci-native.sh) clones the remote-tag image on every job, shares a Mint cache, and installs an EXIT cleanup trap; stop/delete failures are ignored and the temporary source/expect directory is not removed. The [iOS workflow](../../.gitea/workflows/native-ios.yml) has a 25-minute job timeout and always-run evidence upload. [iOS orchestration](../../scripts/native_ios/ci.py) already handles SIGTERM, uses bounded stop/delete waits and writes cleanup results. It sets `created` only after clone returns, so interrupted/failed clone ownership needs explicit coverage. Both lanes use the same runner label; increasing agents does not create more runner capacity.

Existing session receipts, inspected October 24:

- `/tmp/arcadia-adversarial-review/ci26-final-receipt.json`: the temporary guard restored the exact Xcode26.5 cache **19 times**, then exited; no active VMs; exact cache and stopped seed retained; final free space **19.557GiB**. This proves the workaround worked for the batch, not that production lifecycle is safe.
- `/tmp/arcadia-adversarial-review/ci26-cache-preservation.md`: read-only Swift URL diagnostic found identical paths but unequal relative/absolute URL representations in the Tart2.35 initiator exclusion. This is session evidence, not an upstream acknowledged defect or proof a later Tart release fixes it.
- `/tmp/arcadia-adversarial-review/obsolete-upload-process-receipt.json`: obsolete run135's upload-artifact process had already exited before intervention; no signal was sent and the runner was not restarted. Upload cancellation latency needs a reproducible test; the receipt alone does not establish root cause.

[Tart2.35 Clone source](https://github.com/cirruslabs/tart/blob/2.35.0/Sources/tart/Commands/Clone.swift) documents APFS copy-on-write cloning, automatic pruning, `TART_NO_AUTO_PRUNE`, and a default100GB prune cap. Its implementation reserves virtual-minus-allocated bytes after cloning. [Prune source](https://github.com/cirruslabs/tart/blob/2.35.0/Sources/tart/Commands/Prune.swift) and [OCI storage source](https://github.com/cirruslabs/tart/blob/2.35.0/Sources/tart/VMStorageOCI.swift) are the relevant upstream comparison points. Retaining an APFS seed preserves shared blocks: deleting another reference need not reclaim those bytes. Therefore an image surviving pruning and sufficient writable guest space are separate requirements.

## Smallest durable repair to evaluate

1. **Separate provisioning from execution.** Provision the existing26.5 digest and27.1 template as immutable, never-booted named local sources. Record digest, OS, Xcode and tool versions. Jobs clone those sources with automatic pruning disabled only after admission succeeds. A missing/mismatched template fails quickly with a provisioning instruction rather than silently downloading tens of GB during a PR job. Never mutate or delete golden templates or shared tool caches during cleanup. An upgrade to Tart is optional and must pass the same tests; do not assume upgrading resolves the observed comparison.
2. **One admission authority.** Keep runner capacity1 initially. Account for interactive agent-task VMs too; proposed total ceiling2 running guests on the observed24GiB host, with at most one CI guest. This is a conservative candidate, not a measured maximum. A lock/lease belongs to a run identity, has bounded acquisition and records owner PID/run ID. Do not infer abandoned work solely from its age.
3. **Measured disk reserve.** The emergency8GiB floor protected the last batch but is not a validated steady-state budget. Record free bytes before/after clone, guest writes, tests, Release packaging and upload. Admission reserve should cover measured peak guest delta plus artifacts and an explicit safety margin. Reject before boot when insufficient; never perform broad cache pruning or delete unknown workers to satisfy it. When provisioning a new image, budget old+new overlap separately.
4. **Common lifecycle contract.** Register run identity and planned worker name before clone; trap cancellation; stop the guest, await its host process, delete only the owned disposable worker, remove transient sources/private configuration, and write a durable receipt. Repeated cleanup must be safe. A runner crash requires next-start reconciliation against known ownership records and active jobs. SIGKILL cannot run traps; this reconciliation is essential. Keep failed cleanup visible as failure/actionable state rather than a green run with leftovers.
5. **Bounded artifact stage.** Preserve main Release zip, iOS compile evidence and retention policies. Give upload its own deadline and explicit outcome; bound diagnostics size/count before sending. Release artifact failure must not look like a successful downloadable release. Cancelled obsolete jobs should not spend an unbounded always-run phase uploading evidence. Keep minimal local diagnostics if upload fails, with a bounded retention policy and no secrets. Verify supported action/server versions on the installed Gitea before changing action versions; [Gitea documents compatibility differences](https://docs.gitea.com/usage/actions/comparison/) and [artifacts as a separate workflow output](https://docs.gitea.com/usage/actions/artifacts/).

## Acceptance experiments before adoption

Use a dedicated disposable worker, explicit quotas and a rollback plan. These are proposed verification criteria, not experiments performed by this research:

- Three sequential warm Mac+iOS cycles produce no registry pulls or lint recompilation, leave both immutable templates intact, and preserve all baseline lint/build/test/Release commands and artifacts.
- Supersede a run during clone, readiness, build/test and upload. Within a proposed120-second cleanup budget, its owned process/VM exits or the receipt flags a precise failure; the next queued job can start. No unrelated task VM, cache or template changes.
- Simulate low disk through an injected admission reading, then validate the chosen threshold with measured normal and Release peaks. Rejection occurs before cloning/booting; no destructive reclamation.
- Simulate abrupt orchestrator death and restart. Reconciliation identifies the owned orphan, verifies it is not an active job, and cleans only that worker. Repeat cleanup and prove idempotence.
- Stub an upload that stalls. It reaches an explicit deadline/outcome, does not block the sole runner indefinitely, and retains usable local evidence. A real cancelled upload on the installed runner validates cancellation semantics; workflow syntax alone is insufficient evidence.
- Record admitted wait, clone, boot, lint, compile, test, packaging, upload and cleanup durations. Set latency targets from those measurements rather than promise an unmeasured total.

## Managed macOS fallback

[GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) provide fresh VMs and provider-maintained machines/tools. Their current [published pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), checked October24, is USD0.062/minute for standard3/4-core macOS and USD0.102/minute for5-core M2Pro, with jobs rounded to whole minutes. Thus1,000 billable standard macOS minutes is USD62 before plan allowances/taxes; this is an illustrative calculation, not a quote for Arcadia. Hosted image tooling changes over time; verify the required27.1 Xcode/simulator availability before choosing it.

Managed CI removes host disk/runner maintenance but introduces billable minutes, source/status integration with the self-hosted Gitea repository, and explicit connectivity for private fixture resources. A hosted workflow would need a secure source mirror or dispatch/status bridge; it is not a drop-in `runs-on` change to this Gitea runner. Do not migrate merely because this batch was slow. Revisit if the repaired mini cannot meet agreed cancellation/recovery/latency targets or its measured maintenance cost outweighs the verified hosted estimate. No fallback provider selected here.

## Decisions still needed

Choose measured disk/retention budgets and cancellation deadline; decide whether upload failure blocks each lane; choose the smallest shared ownership/admission interface; agree who provisions/upgrades templates. These are live decision questions for the map. Building the repair, changing CI, and purchasing hosted service remain outside this research ticket.

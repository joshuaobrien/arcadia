# Native CI concurrency rollout — 24 October 2026

The mini's native runner now accepts two jobs, backed by resource-admitted CI
workers. Josh explicitly approved capacity two after the initial real overlap
experiment; the repeated benchmark was stopped rather than waiting for three
successful matched pairs. These are preliminary observations, not a statistically
established speedup.

## Measurements and limits

- Host: 10 CPU cores, 24 GiB RAM. Each existing template uses 4 CPUs and 8 GiB.
- Initial direct sequential Mac+iOS commands: 147.27 seconds (84.44 + 62.83).
- Initial direct parallel commands: 130.77 seconds (Mac 130.66, iOS 103.31).
  Individual jobs slowed under contention; the parallel sample also overlapped
  automatic PR tooling checks, so it is not a clean throughput estimate.
- Observed free space remained above 14 GiB during the initial overlap. Memory
  pressure reached warning level and swap increased. Resource fit alone does not
  imply linear speedup; monitor real queue-to-result latency.
- Two subsequent clean sequential attempts took 151.26 and 147.53 seconds but
  failed the unchanged playback lifecycle assertion
  `testMediaServicesResetKeepsQueueAndPositionPausedUntilDeliberateFreshResolution`.
  They remain failures, not successful benchmark samples. All checks remain.

## Safeguards and rollback

Admission reserves stopped/starting workers' budgets and stays locked until Tart
reports the VM running, including for compatibility with older checkout versions.
Builds overlap; cache publication stays serialized and bounded. Cancellation skips
publication, and optional diagnostic pruning never blocks receipt export.

The runner uses an explicit capacity-two configuration with its original
registration and labels. Change `runner.capacity` to one and restart the idle
runner to roll back. `ci-worker --max-workers 1` also restores serial worker
admission. Original launch settings are saved with the host experiment evidence.

Independent Standards and Spec reviews accepted the worker changes after startup,
cancellation and diagnostic-pruning fixes. All 22 native CI command tests passed;
the existing iOS, preview and native-loop command suites also passed (3, 6 and 36).

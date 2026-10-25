# Native capture device-switch validation

Owned task: `capture-readiness-1026`, on `paseo-host`, cloned from the existing certified `arcadia-native-toolchain-27-1-v1`. Native source SHA: `49cf665e18e6cf272b12138012acc35926a33559002a0b6ac7845d6a4b07581c`. CI, templates and permission grants were not changed.

The failed issue #33 Duo image (`issue-33-skeletons-iterate-daff8dda/capture-attempt.png`) visibly showed the previous iPhone. The issue implementation remains checkpointed separately at `f50d7bf`.

## Reproduction and repair

- Fresh Duo capture passed (`f1feb467`). Apple's non-prompting `CGPreflightScreenCaptureAccess()` returned true in the guest's Tart execution context.
- Switching to iPhone with both task simulators booted failed (`82cbb840`): `simctl io … screenshot` timed out after 15 seconds. The timeout exception escaped before the existing window fallback.
- Shutting down only the inactive owned Duo allowed the same iPhone screenshot command to complete. This is one diagnostic observation, not proof that every stale frame has the same cause.
- The repair shuts down only inactive booted simulators in the task's persisted inventory, and allows the existing window fallback after direct simulator capture times out. Current-run marker validation remains mandatory.
- Repaired iPhone capture passed (`558a0e90`): 18.59 seconds guest total, direct simulator display.
- Return to Duo passed (`0d6179a2`): 130.44 seconds guest total, including an 86.83-second build invocation mostly spent in package resolution. The accepted image uses the simulator-window fallback and visibly shows the Duo and `FRAME0D6179A2` marker. Inventory inspection confirmed only the owned Duo remained booted.

Three deterministic regressions exercise timeout fallback, stale-window rejection after timeout, and shutdown limited to the inactive owned device. All 52 native-loop tests pass. The timeout-fallback and ownership tests failed before their respective fixes.

Complete receipts, logs, failed capture diagnostics and passing screenshots are retained at `/tmp/arcadia-native-loop-501/capture-readiness-1026/` on the mini and exported locally under `/tmp/capture-readiness-evidence/`. The owned VM is removed after export.

## Limits

These are capture freshness checks, not app behavior acceptance. Issue #33's independent song-position assertion still needs resolution. Its reported permission dialog has not been reproduced or confirmed from the supplied retained image; the reporting agent has been asked for the exact artifact. No TCC records or security settings were changed. Cold startup and package resolution timings are separate from capture time.

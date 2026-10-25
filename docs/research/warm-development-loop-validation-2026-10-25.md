# Warm development-loop validation

Date: 2026-10-25. Based on main ba22251, task `warm-loop-validation`, background clone of `arcadia-mobile-xcode-27-1-fastlane-2-241-1` on the mini. No host viewer opened. CI and the human Jellyfin launcher were unchanged.

## Observations

| Run | Guest build | Guest total | Evidence run suffix |
|---|---:|---:|---|
| Mac loaded albums | 5.18s | 7.88s | 74c27390 |
| iPhone loaded songs | 8.16s | 22.11s | aecb75ef |
| iPhone same-size source edit | 8.42s | 18.27s | db4cc967 |
| Duo loaded artists, final capture path | 5.90s | 18.89s | ae68bbba |
| Mac explicit Jellyfin connection form | 8.28s | 10.60s | 49bacb6c |
| Mac empty songs, final capture path | 3.45s | 5.66s | 4bb04915 |

The last Mac command took **8.81s end to end**, including remote setup/source transfer and evidence export. Other totals are guest-side measurements, excluding those transfers. These are individual observations, not a repeated benchmark or a speed guarantee. iPhone used an owned iPhone17 simulator on iOS27.0; Duo used its own simulator on iOS27.1. Both used Xcode27.1. First boot and compilation are setup costs, excluded from warm observations. The first Duo pass spent 86.5s preparing its simulator and 106.2s building against its runtime.

The source-edit probe temporarily changed `The First Song` to the equal-length `The Fresh Song`. The accepted iPhone image visibly contained the new text. The probe was restored; it is not a product change. Immutable source SHA and image SHA are recorded in each exported verification receipt. A current run marker was checked with Apple Vision; images were also visually inspected.

## Failure checks and review fixes

- Public-command tests reject stale-run receipts, wrong source hashes and modified image hashes. Test filters on a visual iteration are rejected instead of silently ignored. All 41 native-loop command tests pass.
- Direct simulator screenshots were not accepted when they lacked the marker. Device Hub initially kept showing the previous iPhone during a Duo request, and the command failed. The final implementation restarts the guest-only viewer and sets the observed Xcode27.1 selection preference; the Duo screenshot then showed the actual Duo and Artists page. A future incompatible viewer change fails closed through the marker gate.
- Two initial long SSH calls disconnected after successful builds but before a complete receipt. They were failures, not accepted images. Subsequent warm calls passed. A guest workspace lock prevents a disconnected iteration from overlapping a later source sync; explicit guest interruption terminates the owned build group. The original transport cause was not established.
- Standards/Spec reviews prompted selected-page loading readiness, settled Jellyfin restoration, current-run-only routine evidence export and process-group cleanup. Reviews then reported no remaining blockers; the final Device Hub selection correction was verified on the genuine Duo.
- The first PR CI attempt found two lint violations, corrected in the final increment. Its iOS job also refused capacity while the development VM occupied a slot. Final CI runs follow task cleanup, without capacity/configuration changes.

Screenshots prove visual freshness and state presentation, not playback, navigation or queue behavior. Existing behavioral CI checks remain separate. The validation VM is discarded after complete evidence export; full task receipts/logs/images are retained in the evidence archive.

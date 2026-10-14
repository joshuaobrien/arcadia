# Explicit native Duo validation

Run this entrypoint only inside an owned, logged-in macOS task VM with Xcode27.1, the genuine27.1 Duo runtime, one owned booted Duo and guest-only native control/capture permissions. Reuse warmed DerivedData and lint/dependency caches. Do not open a host viewer or modify CI. The script validates the sole booted UDID and never starts or deletes VMs.

`validate.py` selects exactly one canonical method, records the actual source archive SHA, verifies every archived file before/after, exports XCTest results/attachments, and rejects selected skips or unexpected methods. `fixture` checks current song, paused elapsed time, duplicate occurrence order, artist route and public control bounds through actual native folding/rotation. `short` commits closed landscape and requires an actual window below500points with hittable, contained transport/seek. `real` retains one real queue occurrence while a300second600Hz source plays across all four poses; direct process PCM and a simultaneous global positive control must pass unchanged frequency/frame/callback/quiet-gap assertions during each native action. The global path alone is not app attribution. Physical speaker acoustics and actual iOS hardware are separate checks.

The two external-controller fixture tests skip when the nonsecret `arcadia-duo-native-validation.json` runner marker is absent. The real test additionally requires `arcadia-jellyfin-duo-long-fixture.json`. Only this entrypoint stages/removes its own marker/private configuration. Generic `MobileListeningTests` do not require the marker. Missing activation is never accepted as selected validation: every requested method must pass exactly once with zero skips.

From an immutable source snapshot extracted in the VM:

```sh
export DEVELOPER_DIR=/Applications/Xcode_27.1.app/Contents/Developer
xcrun swiftc test-environment/native/duo/control.swift -o "$TASK_TOOLS/duo-control"
xcrun swiftc test-environment/native/duo/orientation.swift -o "$TASK_TOOLS/duo-orientation"
python3 test-environment/native/duo/validate.py fixture \
  --device "$DUO_UDID" --output "$EVIDENCE/fixture" \
  --derived-data "$WARM_DERIVED_DATA" --source-archive "$SOURCE_ARCHIVE" \
  --control "$TASK_TOOLS/duo-control"
python3 test-environment/native/duo/validate.py short \
  --device "$DUO_UDID" --output "$EVIDENCE/short" \
  --derived-data "$WARM_DERIVED_DATA" --source-archive "$SOURCE_ARCHIVE" \
  --control "$TASK_TOOLS/duo-control" --orientation "$TASK_TOOLS/duo-orientation"
```

Each output directory must be new. `SOURCE_ARCHIVE` is the exact committed archive whose files are extracted at this script's repository root. Set the variables to owned absolute guest paths. Native controls derive coordinates from the observed unique Device Hub hinge slider; orientation uses its actual Device>Orientation menu. There are no device coordinate constants or production test hooks.

For the explicit real check, use a separate task-owned backend; never modify a shared fixture or personal Jellyfin:

```sh
# Run on the fixture host, with unique unused ports and a new owned root.
python3 test-environment/native/jellyfin.py start --root "$FIXTURE_ROOT" \
  --port "$FIXTURE_PORT" --sustained-seconds 300
python3 test-environment/native/relay.py --root "$FIXTURE_ROOT" \
  --bind "$VM_HOST_INTERFACE" --port "$RELAY_PORT" --upstream-port "$FIXTURE_PORT"
```

Create a mode0600 copy of `fixture.json` for the guest, changing only its server URL to the owned relay. Preserve `duration_seconds`, `expected_hz`, source/media hash and fresh server identity; never export the password. Build/reuse the guest-only capture app from the existing `../audio-capture.swift` and `../audio-capture.plist` as described in `../audio-verification.md`. Then:

```sh
python3 test-environment/native/duo/validate.py real \
  --device "$DUO_UDID" --output "$EVIDENCE/real" \
  --derived-data "$WARM_DERIVED_DATA" --source-archive "$SOURCE_ARCHIVE" \
  --control "$TASK_TOOLS/duo-control" \
  --audio-helper "$AUDIO_CAPTURE_APP/Contents/MacOS/pilot" \
  --configuration "$PRIVATE_GUEST_FIXTURE"
```

Export raw PCM, callback chunks, strict assertions, actual pose intervals/PIDs, native recordings, app-window screenshots, source guards, logs and XCTest verification before discarding the VM. Review recordings for prompts/unsafe overlaps and scan exports for fixture credentials before PR publication. Do not infer hinge geometry from orientation alone: retain actual reserved-region query observations and synchronized native physical-pose/control bounds review. An empty runtime query is not proof of no unsafe region. Cleanup owns/reaps only its children; remove only fixture resources whose ownership label/PID command matches this task, using the existing fixture stop command after evidence export. Keep private caches.

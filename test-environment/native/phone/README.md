# Explicit iPhone restoration validation

Run `validate.py restore` only **inside an owned, logged-in disposable macOS task VM** via Tart Guest Agent. It never starts, stops, or migrates VMs, opens a host viewer, grants permissions, or changes CI. This mode verifies real playing-restart restoration; it does not claim Lock Screen controls, hardware background audio, or native remote commands.

Josh explicitly waived direct iOS native Now Playing card/system-command verification for this initial PR on 15 October 2026 ("just assume this works it's ok"). That portion is an accepted assumption, not a tested pass. Retained simulator reference recordings separately verify known actual output after personally reviewed rendered Lock Screens; they do not establish physical-device behavior or actual native remote-command routing. No hardware verification is claimed.

Prepare an immutable native source archive using the existing native-loop snapshot whitelist, extract it at the repository root, and use the same archive for `--source-archive`. Keep warmed DerivedData private to this task. The archive's files are checked before build and after execution; its SHA and actual requested/executed test identifiers are retained. The archive must include the accepted `RestoringRealListeningTests.swift` and `verify-audio.py` must support the unchanged strict `iphone-restore` profile.

Use [source-keyed helper builds](audio-helper.md) for a fresh guest/toolchain and pass `--audio-helper-manifest "$BUILT_MANIFEST"` with the returned binary. The validator recomputes committed source/plist/toolchain identity and verifies binary, bundle and signature; a manifest cannot supply commands. The historical exact binary remains a fast path without this optional argument.

Supply the accepted tap-only capture helper (binary SHA256 `5aba931e1baf63f5cba3f96ee882a753391c1706cc6054a42090a9d5f55a255c`, source SHA256 `eae052df31d6ca3371e7f01a6a8a4eb21da15decc23abd0e6486e5e34bd1f331`). The microphone-concatenating experimental helper is not accepted. Capture runs with `--unmuted --paused-output`: a global guest output tap and actual zero-output engine clock survive termination of the old app process. The resumed known 680 Hz tone calibrates the same route; this global mix is not per-process attribution.

Supply two task-owned, already compiled native preflight tools: `--native-control` implements `UDID DEVICE_NAME inspect`, failing unless guest Accessibility is trusted, the owned phone is the sole booted simulator, its exact UDID row is selected and its focused Device Hub window matches the device name, and the native Controls > Lock menu is available. `--alerts-helper` outputs `trusted=true` followed by JSON-lines with `bundle` and `windows`; any UserNotificationCenter window fails preflight. Compile the included `control.swift` and `alerts.swift` with guest `xcrun swiftc` into task-owned tools, then pass those paths. The controller uses actual public AX selected-row and focused-window observations; it does not select or launch devices. Their binary hashes are recorded. Native preflight completes **before** capture arming starts; missing permission requires an observed, scoped guest decision and a fresh output directory, never an automatic Allow or TCC database edit.

Use a fresh output directory and absolute owned guest paths:

```sh
export DEVELOPER_DIR=/Applications/Xcode_27.1.app/Contents/Developer
python3 test-environment/native/phone/validate.py restore \
  --device "$PHONE_UDID" --output "$EVIDENCE/restore" \
  --derived-data "$TASK_DERIVED_DATA" --source-archive "$SOURCE_ARCHIVE" \
  --configuration "$PRIVATE_GUEST_FIXTURE" --audio-helper "$TAP_ONLY_HELPER" \
  --native-control "$TASK_TOOLS/device-lock" \
  --alerts-helper "$TASK_TOOLS/58-native-alerts"
```

The private JSON contains `server`, `username`, `password`, `firstSongID`, and `secondSongID` from a separate disposable Jellyfin fixture. Never use a personal source, log these values, or publish this input. The driver installs it mode0600 in the actual runner's Documents directory after build/install and follows replacement runner containers during XCTest. It refuses unrelated pre-existing input/markers. A unique ownership marker and content hash authorize cleanup across initial/replacement containers; changed private content is retained and the run fails for inspection. No Keychain contents are copied.

Only `ArcadiaMobileUITests/RestoringRealListeningTests/testRealJellyfinRestoresTheSameQueueAndPositionPausedAfterRestart` is selected. The exact method must execute once and pass with zero failures or skips. Build-for-testing precedes capture; test-without-building reuses the same source and package resolution. A background coordinator follows `Documents/mobile-restore-58`: fresh `target-request`, actual app PID, `capture-ready`, incremental `phases.json`, `queue-before.json`, and final `done`. The coordinator follows configuration/container changes without a separate watcher process. The capture child is always signaled, waited/reaped, then TERM/KILL boundedly if necessary. An exclusive guest capture lock rejects concurrent phone validators, and an existing accepted capture-helper producer is rejected rather than killed.

Export the entire owned output before discarding the VM: raw PCM/chunks/format, phases and queue evidence, helper PID attribution, full `.xcresult`, summary/tests/verification, attachments, logs, source/driver/helper hashes, child return codes, and staging cleanup report. Failure evidence is retained too. The strict PCM profile requires `before-restart` 680 Hz, `restored-paused` silence with meaningful captured samples, and `restored-resumed` 680 Hz. Missing callbacks never prove silence. Review native evidence and scan exports for fixture credentials before publication; do not publish private fixture configuration.

Host-safe filesystem guard tests do not build or launch apps:

```sh
python3 -m unittest discover -s test-environment/native/phone -p 'test_*.py'
```

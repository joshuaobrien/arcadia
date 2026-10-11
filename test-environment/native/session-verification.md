# Restored sessions and Mac system controls

`PlaybackPersistenceTests` verifies the shared PlayerStore snapshot boundary: source binding, occurrence identity and origin, a whitelist without artwork/resource URLs, unavailable-song recovery, and a newer explicit choice winning over old asynchronous restoration. `SessionRestoreTests` additionally drives real disposable Jellyfin through the public UI. Fixtures supplement this integration journey.

The real playing-restart journey requires independent **before and after process taps**. A tap is associated with a PID, so reusing the pre-termination tap cannot verify the restarted app. Reuse the signed guest helper described in `audio-verification.md`, sequentially arming the runner-container directories `tmp/arcadia-audio-capture-56/before` and `after`. Start the second helper after the first writes its results. The UI test publishes each actual app PID and records phases. Run `SessionRestoreTests/testRealPlayingRestartIsSilentUntilDeliberateResumeAndSystemCommands` explicitly. The ordinary app-process tap can provide no frames before a newly restored process first plays; missing frames never prove silence. Also arm `quiet` with `audio-capture.swift --paused-output`. This creates a separate global output tap and an actual guest audio-engine clock that renders zero samples. It verifies meaningful captured silent buffers, then captures Arcadia's resumed 680 Hz on the same global tap as a positive route calibration. Use `--unmuted` for the task's per-process helpers while the global tap overlaps; Tart remains `--no-audio`, so this changes only guest capture routing. The ordinary helper default remains unchanged.

Require all three independent checks:

```bash
python3 test-environment/native/verify-audio.py CAPTURE/before --profile restart-before
python3 test-environment/native/verify-audio.py CAPTURE/quiet --profile restart-paused-output
python3 test-environment/native/verify-audio.py CAPTURE/after --profile restart-after
```

The global recording contains the real guest output mix, including the zero-output clock; all other guest apps remain silent. Its positive resumed 680 Hz phase proves that this route actually includes Arcadia. The separate PID tap proves app attribution for the playback and command phases. No samples are inserted into recorded files.

The independent expectations are the disposable fixture's 680 Hz saved segment, silent paused restoration, resumed 680 Hz, silence after a real media key, the next duplicate First Contact occurrence beginning at 520 Hz, native pause silence, native resumed 520 Hz, and the following Persistent State occurrence at600 Hz. The UI verifies exact occurrence IDs and order across restart and native Next; identical titles alone cannot distinguish duplicate queue entries.

For the media-key gate, compile `media-key.swift` once inside the task VM and run it with the runner-container directory `tmp/arcadia-media-keys-56`. It posts actual macOS NX_SYSDEFINED media-key down/up events through CoreGraphics. This is OS input injection, not direct invocation of a registered remote-command handler. The UI test requests Play/Pause and observes public transport state; the process tap independently requires silence. Write its `done` marker after export. Remove capture `armed` markers before ordinary full-suite runs so stale setup cannot masquerade as current acceptance.

`SystemTransportTests` uses native Playback menu shortcuts and the real Control Center status item `com.apple.menuextra.controlcenter`. It targets system buttons by their native accessibility identifiers, observes the app's shared controls and changing system metadata, and retains native-panel evidence. Ordinary app screenshots remain app-window only.

Observed macOS26.6.2/Xcode27.1RC limitation: after a fresh process restores paused, Control Center displayed **Not Playing** until deliberate playback started. The saved queue and position were available in Arcadia; no native Play event reached the adapter from that empty system tile. This records the observed platform surface and does not claim a proven OS cause. Arcadia does not publish a false playing state to force a system tile. Deliberate app keyboard Resume is followed by actual system controls and output verification.

Everything runs in the background task VM. Grant capture/automation prompts only inside that disposable guest; no host permissions, viewer, personal music source, or existing CI defaults are changed. Export source fingerprints, executed test names, logs, results, app-window screenshots and PCM assertions before discarding the VM. Optional/unarmed skips do not count as real-audio or native-key acceptance.

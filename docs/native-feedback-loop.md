# Native development feedback loop

Every Arcadia app build, launch and test runs in a disposable macOS VM. Reuse that VM within a task, export evidence, then discard it. The host only orchestrates; a new task gets a fresh clone. The implementation follows the [agreed plan](http://100.112.160.16:3456/tasks/34).

**Operate in the background by default.** Do not open Screen Sharing, a VNC viewer, Xcode or the guest desktop during ordinary agent work. Inspect saved app-window screenshots and logs. Live viewing is opt-in and requires an explicit user request; it is not a completion requirement for the normal loop.

## Start and iterate

Prerequisites on the VM host: Tart with the pinned official image cached, Python 3.9+, a logged-in guest GUI session and Tart Guest Agent. For remote execution, use an existing trusted SSH alias with noninteractive authentication. The repository's existing mini is `paseo-host`.

```sh
./scripts/native-loop --host paseo-host start album-browse
./scripts/native-loop --host paseo-host build album-browse
./scripts/native-loop --host paseo-host test album-browse
./scripts/native-loop --host paseo-host review album-browse
./scripts/native-loop --host paseo-host oracle album-browse
./scripts/native-loop --host paseo-host lint album-browse
./scripts/native-loop --host paseo-host finish album-browse
```

Use a new lowercase task name each time. `NATIVE_LOOP_HOST` can replace `--host`; omit both when running the orchestrator directly on the Tart host. `--source` selects the checkout; `--artifacts` selects the local export directory (default `.native-loop/<task>`). Keep the same settings for subsequent operations. `--root` selects task state on the VM host, defaulting to `/tmp/arcadia-native-loop-<uid>`.

`start` pins the image by digest, creates task-owned mounts and checks guest readiness. Source and orchestration tools are guest read-only; artifacts are writable. Whole helper bundles and source archives have content-addressed paths to avoid stale shared-folder reads. Each build/test synchronizes the current native source snapshot, including uncommitted changes and file deletions, into a writable guest workspace. Guest DerivedData and package caches survive subsequent iterations in the same task. The manifest records source/driver fingerprints, revision, image, tool versions, timings and statuses. Debug app and UI runner use a stable development identity inside each task-isolated VM and valid ad-hoc signing. Production identity is unchanged.

Mint tools persist on the VM host at `~/.cache/arcadia-ci-mint`, preserving the old Gitea CI default. `MINT_CACHE` / `--mint-seed` overrides that host path. A fresh VM receives a private copy; after successful lint, the runner atomically publishes the compiled tools under a key derived from the pinned image and Mintfile. Subsequent tasks reuse that seed without rebuilding SwiftLint. Existing legacy `packages`/`bin` caches are imported automatically. Guests never mutate the persistent seed, and app builds/state remain task-local. Never point the Mint cache at DerivedData; compiled package dependencies use a separate sanitized seed described below. Startup uses a bounded guest-agent readiness deadline; a failed startup stops/deletes its clone and retains diagnostics.

## Data modes

Debug defaults to `ARCADIA_DATA_MODE=fixtures`, without needing a backend URL. `ARCADIA_FIXTURE_SCENARIO` selects `success`, `empty`, `failure`, `failure-then-success` or `two-page`. Fixtures have stable IDs and bundled artwork; they do not contact a server. Unknown mode/scenario values produce a configuration error.

`integration` and `live-readonly` require an explicit `ARCADIA_BASE_URL` in development; they never fall back to the production URL embedded in a build. The native client uses GET requests. Live browse is an optional read-only smoke check, not the reproducible acceptance oracle. Release retains its configured backend URL and cannot enable development fixtures.

The behavioral suite checks:

- Success: expected album, loaded artwork, independently targetable track controls, expected track title, and back navigation.
- Empty: completed loading, zero albums and no request error.
- Failure: controlled request error, completed loading, and a Retry action that remains available after another failure.
- Recovery: the first request fails; Retry loads the library and clears the error.
- Two pages: scrolling loads the second page; expected IDs/count match and duplicate links are rejected.

`oracle` changes the title only in the guest copy, verifies the success assertion fails, restores the file, and verifies the test passes. It rejects a build failure or a mutation that incorrectly passes. This is an assertion sensitivity check, not an audio playback test; track playback remains the existing stub.

## Disposable real API integration

The host needs a running local Docker engine/Compose, ffmpeg and network access to the pinned fixture images. The stack contains Arcadia, slskd, beets-flask and Jellyfin. It builds from an explicit source subset, with no production runtime configuration or state.

```sh
./scripts/native-loop --host paseo-host integration album-browse
./scripts/native-loop --host paseo-host test album-browse --integration
```

All container names, ports, source, credentials and storage are task-scoped. The runner seeds the existing test library, bootstraps disposable Jellyfin, probes album/tracks/artwork, and opens an authenticated SSH reverse forward bound only to guest loopback. Guest host keys come from Tart exec; SSH verification remains enabled. The app receives an explicit guest-local URL. No production containers, databases, ports or credentials are reused. Failed provisioning tears down only its own Compose project; failure logs remain. `finish` removes containers, volumes and the private relay.

## Background visual review and optional live viewing

`review` runs album/track/back navigation inside the guest and saves app-only screenshots, without opening any host window. The ordinary four-scenario tests also save screenshots. Inspect these exported PNGs for visual review. No authentication dialog or viewer is involved.

UI tests launch with AppKit's `ApplePersistenceIgnoreState` flag so a previously closed or navigated window cannot change the next scenario. This only affects test launches, not ordinary app state restoration.

Only when the user explicitly requests live viewing:

```sh
./scripts/native-loop --host paseo-host view album-browse
./scripts/native-viewer-setup --connection .native-loop/album-browse/viewer.json --output .native-loop/album-browse/Viewer.app
# Launch that generated app through native computer control, then in another terminal:
./scripts/native-loop --host paseo-host review album-browse --live-review
```

`view` creates a task-owned loopback SSH tunnel and prints its endpoint; it never opens a viewer. The optional setup helper requires the official Homebrew `tiger-vnc` formula and verifies its signature. It packages a signed native app bound to that task's tunnel. The launcher validates ownership, pinned image and live SSH process before supplying the [official public image credentials](https://tart.run/quick-start/) via TigerVNC's supported environment variables. It connects without a login dialog, does not save passwords, disables clipboard exchange, and exits quietly on connection errors. SSH remains encrypted and verified. The tunnel is removed by `finish`; it is not exposed on a public interface. Launch the generated app only through native computer control; shell UI automation is unnecessary.

Host accessibility exposes the viewer, not guest controls. Guest XCUITest identifiers provide repeatable semantic assertions. Apple Screen Sharing's connected-window XPC helper is not targetable by the current computer-control tool. The optional TigerVNC viewer's automatic connection was verified, but coordinate navigation remains unreliable and is not counted as behavioral evidence. Use the background tests for verification. Do not change guest security settings or disable macOS verification to make a viewer launch.

The explicitly requested `--live-review` session holds the app for approximately three minutes and saves app-window screenshots on state changes. It is excluded from ordinary checks. Do not build or test concurrently against a task under review; task operations are locked. Establish the optional viewer connection before starting this session.

## Evidence, recovery and CI

Every build/test/lint/review saves logs and full result bundles directly to task-owned host storage, even on failure. Remote operations transfer a smaller `review.tgz` containing logs, test summaries, manifest and app-only PNG attachments. `finish` also saves a verified full `evidence.tgz` on the VM host before deletion, and prints its retained location. `.xcresult` and automatic failure videos remain available there; explicit `export` downloads the full archive, even after the task has finished. This avoids copying hundreds of megabytes during routine work or cleanup. Evidence includes targeted `tokyo.drift.Arcadia` logs tagged with the run ID. Runtime logs contain controlled mode/scenario/state names, never request URLs, authorization headers or payloads. Never capture the host desktop.

`finish` verifies a full evidence archive on the VM host before removing owned resources, then exports cleanup status. Archive creation failure retains the VM for recovery; a later local transfer failure retains the host archive for retry. Cleanup removes the task VM, integration containers/volumes/bind storage, relay keys and viewer tunnel. Evidence and reusable lint-tool seeds remain. Use `status` to inspect state. A finished task cannot be reused; choose a fresh name. Do not remove arbitrary Tart images or Docker projects to recover a task.

The development loop is separate from the existing Gitea CI workflow and `scripts/ci-native.sh`. CI retains its ephemeral VM, shared Mint cache, lint/format checks, build, unit tests and existing Release artifact packaging. Run the behavioral fixture tests, regression oracle and evidence export through `scripts/native-loop` during development.

Runner ownership/archive/export-order checks can run without a VM:

```sh
python3 -m unittest discover -s scripts/native_loop -p 'test_*.py'
```

## Faster iterations and screenshot comparisons

Run one relevant test during edits; run the full suite before opening the PR:

```sh
./scripts/native-loop --host paseo-host test album-browse --only-testing ArcadiaUITests/FeedbackLoopTests/testEmpty
./scripts/native-loop --host paseo-host test album-browse
```

`--only-testing` accepts a full XCTest class or method identifier and can be repeated. A run with no passing tests is rejected (including a misspelled filter that Xcode silently skips). A targeted pass is recorded with its filter in the manifest and does not count as a full-suite pass. Filters do not apply to the regression oracle or integration mode.

Capture one test before editing and again after editing:

```sh
./scripts/native-loop --host paseo-host capture album-browse --only-testing ArcadiaUITests/FeedbackLoopTests/testEmpty --label before
# edit the app
./scripts/native-loop --host paseo-host capture album-browse --only-testing ArcadiaUITests/FeedbackLoopTests/testEmpty --label after
```

This runs the selected test, exports its app-window attachment, and creates `comparison/before.png`, `comparison/after.png`, a provenance manifest and `comparison/README.md` with a ready-to-use comparison table. Upload both images to the PR and replace the relative image links with their attachment links. Captures must have matching pixel dimensions; the command rejects a mismatched pair instead of silently resizing either image. Test launches continue to ignore persisted window state. If a test saves several screenshots, select an exact display name with `--screenshot-name 'Success - library after back'`. `compare` uses the most recent successful matching targeted test without rerunning it. Always inspect both images; this tool prepares the comparison and does not decide whether a visual change is correct.

Progress output identifies source transfer, VM startup, dependency resolution/compilation, app compilation, signing, behavioral tests, cache publication, evidence export and cleanup. Build phases emit a heartbeat every 15 seconds. Raw build logs remain in the artifacts; progress messages do not echo request URLs or secrets. Per-command `.phases.json` files record timings. VM startup, build/test execution and export are separate costs.

Fresh task VMs can reuse a dependency seed stored at `~/.cache/arcadia-native-dependencies` on the VM host (`--dependency-cache` overrides it). The versioned key covers the pinned VM image/toolchain, `Package.resolved` and Xcode project settings. Seeds include package checkouts, dependency products/intermediates, module caches, explicit SDK modules, generated module maps and Xcode build metadata; they exclude Arcadia app/test products and intermediates, index/test logs and app runtime state. Stable paths and a stable development bundle identifier inside each isolated guest preserve dependency signatures. Changing a global bundle identifier per task also changes package build settings and can invalidate dependency reuse. Development identity remains distinct from production; task isolation comes from the fresh VM. Each guest restores a private copy, never writes directly to a shared cache, and rebuilds its own development app in isolated storage. Changed cache inputs clear guest DerivedData and select a new key. Publication is atomic and locked; a checksum mismatch falls back to a cold build. `start --no-dependency-cache` disables restoration and publication for that task. Release builds retain their separate configuration and do not seed this Debug cache. The dependency cache does not change the existing CI or Mint cache.

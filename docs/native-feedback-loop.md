# Native development feedback loop

Every Arcadia app build, launch and test runs in a disposable macOS VM. Reuse that VM within a task, export evidence, then discard it. The host only orchestrates; a new task gets a fresh clone. The implementation follows the [agreed plan](http://100.112.160.16:3456/tasks/34).

**Operate in the background by default.** Do not open Screen Sharing, a VNC viewer, Xcode or the guest desktop during ordinary agent work. Inspect saved app-window screenshots and logs. Live viewing is opt-in and requires an explicit user request; it is not a completion requirement for the normal loop.

## Prepared development template and readiness

The mini's development default is `arcadia-native-toolchain-27-1-v1`: Xcode
27.1 build 27A9275, Mint 0.18.0 and compiled SwiftLint matching `Mintfile`.
CI retains its existing separately validated Fastlane templates and cache owners.
Do not boot or modify a shared template during ordinary work.

A local template must have a host certificate at
`~/.cache/arcadia-native-toolchains/<template>.json`. Before cloning, `start`
checks its identity and the exact Mintfile/formatter configuration against that
certificate. Drift fails immediately. Guest startup then checks the pinned
versions, runs cached SwiftLint with `--no-install`, and parses/lints the actual
formatter configuration. It installs nothing and writes `toolchain.json` evidence.
A readiness failure is an infrastructure blocker: retain diagnostics and report
it. Do not install tools in an app task or edit app formatting configuration to
make an incompatible template pass.

Maintainers prepare a **new** clone of the existing Fastlane image. Inside that
private guest, with an allowlisted checkout and an existing compiled Mint seed
mounted read-only, run:

```sh
./scripts/native-provision-toolchain /path/to/checkout /path/to/mint-seed
```

The explicit `--bootstrap-lint` alternative permits a one-time seed build only
during provisioning. It is never part of ordinary task startup. Stop the candidate
before recording its identity. Validate a fresh clone, then publish its certificate:

```sh
./scripts/native-loop --host paseo-host start template-smoke --template arcadia-native-toolchain-27-1-v1 --validate-template
./scripts/native-loop --host paseo-host lint template-smoke
./scripts/native-loop --host paseo-host build template-smoke
./scripts/native-loop --host paseo-host test template-smoke --only-testing ArcadiaUITests/FeedbackLoopTests/testEmpty
./scripts/native-loop --host paseo-host finish template-smoke
./scripts/native-loop --host paseo-host certify template-smoke
```

`--validate-template` is a maintainer-only bootstrap path; it skips only the
host certificate lookup, never guest checks. `certify` requires successful
preflight, lint, build and a behavioral test against the same source, complete
evidence export/VM cleanup, and an unchanged template. The receipt is invalidated
by image or contract changes. `NATIVE_LOOP_TEMPLATE` or `--template` selects an
explicit alternative; it must be certified too. Never fall back silently to an
older/raw Xcode image.

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

Targeted `test --only-testing …`, explicit integration tests, `review` and `oracle` suppress Xcode's expensive post-failure system diagnostics when the installed Xcode advertises `-collect-test-diagnostics`. XCTest result bundles, screenshots, test logs and assertion/accessibility evidence remain enabled. Unsupported Xcode versions retain their normal diagnostics behavior; the runner checks capability rather than assuming a version. Unfiltered test runs retain the normal Xcode policy. Add `--full-diagnostics` to a targeted run when investigating simulator or runner failures; collection can take several minutes. Each run saves `diagnostics-policy.txt` alongside its evidence. This policy does not change Gitea CI.

## Fast visual iteration

For a UI edit, keep one task VM warm and build only the platform you are editing:

```sh
./scripts/native-loop --host paseo-host start player-layout --template arcadia-mobile-xcode-27-1-fastlane-2-241-1
./scripts/native-loop --host paseo-host iterate player-layout --platform mac --state songs
./scripts/native-loop --host paseo-host iterate player-layout --platform iphone --state albums
./scripts/native-loop --host paseo-host iterate player-layout --platform duo --state artists
./scripts/native-loop --host paseo-host finish player-layout
```

Use the same task name and `--artifacts` setting throughout. `--template` clones an existing stopped local template and records its configuration/disk identity; it does not modify the template. Normal CI remains unchanged. The first build and simulator boot are setup costs; subsequent edits reuse the task's build products and its own fresh simulator. Content comparison copies only changed source files, including same-size edits made within one second.

`iterate` defaults to fixtures and the successful library. Select `--scenario empty`, `failure`, `two-page` or `loading` for other states, or `--data-mode jellyfin` for the connection flow. Supported states are songs, artists, albums, playlists and search. The separate human `native-preview` launcher retains its Jellyfin default.

Each iteration builds, relaunches the selected state, and captures the app window (Mac) or simulator display inside the background guest. If direct simulator capture is black or stale, it falls back to the simulator window. When changing devices, inactive booted simulators from this task’s own inventory are shut down before booting the selected device; unrelated simulators are left alone. Xcode27.1 Device Hub is restarted and its task-guest selection is set explicitly. A direct simulator screenshot timeout falls back to the viewer window, just as a stale direct frame does; the current-frame marker remains mandatory. An explicit Debug-only frame marker must match the current run through Apple Vision before an image is accepted. A black, stale or unavailable frame fails the command. The exported verification receipt binds the image to its run and source archive and reports phase timings. No host viewer opens. Screenshots contain the temporary frame marker; ordinary app launches do not. Library captures wait for the selected page to finish its initial load (except `--scenario loading`, which holds fixture requests for 60 seconds to capture the pending layout); Jellyfin connection captures wait for saved-session restoration. This readiness gate does not assert that the result is correct. Each `iterate` export contains its current run only; explicit `export` and `finish` retain the complete task history.

Guest iterations also hold a workspace lock. If SSH disconnects, the guest command may continue; another iteration fails as busy rather than changing its source mid-build. Explicit guest interruption terminates the owned build process group. Use `finish` to discard a task that cannot recover.

A visual iteration is **not a behavioral test pass**. Run the existing targeted `test --only-testing …` command when behavior changes, and preserve the normal acceptance checks before merging. SwiftUI component previews are also available for short and long album metadata, for convenient focused layout inspection in Xcode; they are not required for the command loop.

For fixture UI tests on iPhone or Duo, select the platform and mobile test explicitly:

```sh
./scripts/native-loop --host paseo-host test artist-layout --platform iphone --only-testing ArcadiaMobileUITests/ArtistLoadingLayoutTests/testArtistSongLoadingPreservesRowPositions
./scripts/native-loop --host paseo-host test artist-layout --platform duo --only-testing ArcadiaMobileUITests/ArtistLoadingLayoutTests/testArtistSongLoadingPreservesRowPositions
```

These commands reuse the task's own simulator inventory and warm iOS build directory.
They retain device/runtime facts, immutable source hashes, source integrity checks,
XCTest selections, result bundles and screenshot attachments. Mobile tests require
explicit mobile fixture selections; Mac defaults and integration commands retain
their existing behavior. Run platforms sequentially. This does not exercise native
folding, real audio, restoration or background behavior; use the dedicated acceptance
entrypoints below when those behaviors change.

## Data modes

Debug defaults to `ARCADIA_DATA_MODE=fixtures`, without needing a backend URL. `ARCADIA_FIXTURE_SCENARIO` selects `success`, `empty`, `failure`, `failure-then-success` or `two-page`. Fixtures have stable IDs and bundled artwork; they do not contact a server. Unknown mode/scenario values produce a configuration error.

`integration` and `live-readonly` require an explicit `ARCADIA_BASE_URL` in development; they never fall back to the production URL embedded in a build. The native client uses GET requests. Live browse is an optional read-only smoke check, not the reproducible acceptance oracle. These are legacy Arcadia API modes. Release now defaults to `jellyfin`: `ArcadiaApp` opens the direct Jellyfin connection flow, rather than using an Arcadia backend URL. Debug can select the same flow with `ARCADIA_DATA_MODE=jellyfin`; Release cannot enable development fixtures. Explicit legacy API modes retain their configured URL behavior.

The behavioral suite checks:

- Success: expected album, loaded artwork, independently targetable track controls, expected track title, and back navigation.
- Empty: completed loading, zero albums and no request error.
- Failure: controlled request error, completed loading, and a Retry action that remains available after another failure.
- Recovery: the first request fails; Retry loads the library and clears the error.
- Two pages: scrolling loads the second page; expected IDs/count match and duplicate links are rejected.

`oracle` changes the title only in the guest copy, verifies the success assertion fails, restores the file, and verifies the test passes. It rejects a build failure or a mutation that incorrectly passes. This is an assertion sensitivity check, not an audio playback test; track playback remains the existing stub.

## Shared native player: Mac, iPhone and Duo

Use the explicit [iPhone validation entrypoint](../test-environment/native/phone/README.md) and [Duo validation entrypoint](../test-environment/native/duo/README.md) for mobile player work. These run inside an owned, logged-in task guest with Xcode27.1 and the matching27.1 simulator runtime; Duo additionally requires the genuine Duo runtime and owned device. Record the actual template/image provenance, Xcode/runtime versions, device UDID and tool hashes. Follow each entrypoint's native permission/preflight requirements before capture. The `scripts/native-loop` commands above describe the Mac loop; the existing26.5 Mac CI image and workflow remain unchanged.

The phone's eight `MobileListeningTests` are deterministic fixture UI checks, separate from real Jellyfin playback, playing-restart restoration and background/native-control validation. Select those additional modes explicitly using the phone instructions as they become available; a fixture pass does not establish real audio or background behavior. The checked-in `restore` mode requires real playback before restart, meaningful silent output while restored paused, and known-tone output after deliberate Resume. Follow the phone README's stated verification limits and accepted assumptions for native iOS controls. Duo similarly distinguishes `fixture`, `short` and `real` modes.

For every acceptance run, retain the immutable source archive and its SHA, verify archived files before and after execution, and record requested and executed XCTest identifiers. Every exact selected method must pass once with zero failures or skips. Export full result bundles, logs, native screenshots/recordings and applicable raw PCM/assertions, helper provenance and cleanup reports, including failure evidence, before releasing the owned guest. Missing output callbacks do not establish silence.

Keep each run's disposable fixture configuration and media frozen through capture and verification; do not reseed a backend used by another run. Use the [direct Jellyfin fixture setup](../test-environment/native/README.md), [known-tone/output contract](../test-environment/native/audio-verification.md) and [restored-session verification](../test-environment/native/session-verification.md). Keep credentials private and publish only reviewed, credential-free evidence.

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

Run one relevant test during edits; run the default unit and feedback-loop suite before opening the PR:

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

Test, review and oracle operations first run cached lint against the exact source snapshot. The successful lint gate is reused only for the same snapshot, VM image and helper bundle. XCTest evidence records requested and executed identifiers; an exact selected method must pass, and missing or unexpected selections fail the operation. The default test command selects `ArcadiaTests` and `FeedbackLoopTests`; it does not claim coverage of every UI test class. Add relevant classes with repeated `--only-testing` arguments.


## Local interactive previews

Automated development and verification continue to use the background task VM. For a requested hands-on review, the maintained local launcher builds and opens the Mac app and a dedicated iPhone simulator:

```sh
./scripts/native-preview                         # Mac + regular iPhone
./scripts/native-preview --device duo            # Mac + iPhone Duo
./scripts/native-preview --device both           # Mac + both phones
./scripts/native-preview --device both --check   # read-only capability check
./scripts/native-preview --device duo --check --json
```

Run it from any working directory using the path to this checkout's script. It always builds that checkout. It selects the highest installed Xcode in `/Applications`, respecting `DEVELOPER_DIR` or an explicit `--xcode /Applications/Xcode_27.1.app`. It never changes `xcode-select`, downloads runtimes, accepts licenses or erases devices. Finish Xcode's first-launch setup before running it.

All mobile builds need an iOS Simulator SDK of at least 27.1 because the shared UI references those APIs at compile time. A regular iPhone needs an available iOS 26 or later runtime; Duo needs an available 27.1 or later runtime that supports the Duo device type. Install runtimes through the selected Xcode. The preflight checks actual SDK and runtime capabilities before building, with an actionable error for a missing capability.

Previews explicitly use direct Jellyfin mode, never the fixture default or the Arcadia backend. Connect through the app's source screen. The review bundle identifiers and credential namespace are separate from production. Existing `Arcadia PR12 iPhone` and `Arcadia PR12 Duo` devices and the previous review session are reused; otherwise the launcher creates its own `Arcadia Preview` devices. It does not modify unrelated simulators. A failed migration reported by `simctl bootstatus` stops launch even if that tool exits successfully.

DerivedData, build logs, phase timings, simulator boot logs and `environment.json` persist under `~/Library/Caches/Arcadia/native-preview/<checkout-id>/`; `--cache PATH` overrides that location. Repeated runs reuse the cache. Compilation prints progress every 15 seconds. Concurrent launches from one checkout are rejected; Ctrl-C stops the owned build process. The selected viewer opens only for this explicit interactive command.

## Additive iOS compilation CI

`.gitea/workflows/native-ios.yml` adds an independent check without changing the existing macOS workflow or `scripts/ci-native.sh`. It compiles the `ArcadiaMobile` app **and its UI-test bundle** with `build-for-testing`, using the resolved package versions. This catches mobile-only SDK and test compilation failures. It does not execute UI tests or establish behavioral coverage; retain the existing iPhone/Duo behavioral verification for that purpose.

The macOS runner must have Tart and the prepared local template `arcadia-mobile-xcode-27-1-27a9275`, with Xcode 27.1 and a working Tart Guest Agent. `NATIVE_IOS_TEMPLATE` can select a replacement template; the guest still verifies its actual SDK and records the selected toolchain. Each run clones a uniquely named disposable VM, uses no graphics/audio/clipboard, shares an allowlisted source snapshot read-only, checks source integrity before and after compilation, and removes its own VM on completion or cancellation. It never changes the template or existing macOS CI cache.

To reproduce on that runner:

```sh
./scripts/ci-native-ios --artifacts "$PWD/artifacts/native-ios"
```

The workflow uploads the build log, phase timings, toolchain facts, source-integrity reports, compile verdict and VM-cleanup manifest even on failure. The verdict explicitly distinguishes compilation from behavioral execution. CLI regression checks run without Xcode or a VM:

```sh
python3 -m unittest discover -s scripts/native_preview -p 'test_*.py' -v
```

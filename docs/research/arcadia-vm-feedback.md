# Arcadia: agent feedback inside an isolated macOS VM

Research for [Determine how an agent can inspect and drive an isolated macOS VM](http://100.112.160.16:3456/tasks/38), 2026-10-09. This is a planning artifact, not an implemented or validated VM workflow.

## Finding

Tart can provide the build machine, desktop, source transport, and evidence transport. Guest XCUITest can provide semantic behavioral verification and app screenshots. Interactive native review needs an additional connection: a visible remote desktop for pixel input, or a guest accessibility client for semantic input. Host computer control alone does not establish access to guest app accessibility.

The smallest useful validation is one fresh disposable VM, two edit/build/run iterations within it, a native screenshot/input interaction, and one behavior assertion that demonstrably fails when behavior is broken. That would test the missing bridge without committing to a large tooling implementation.

## Evidence status

| Capability | Status and evidence |
| --- | --- |
| VM host | Parent agent verified trusted SSH alias `paseo-host`, macOS 26.6.2, Tart 2.35.0 at `/opt/homebrew/bin/tart`, and cached stopped `macos-tahoe-xcode:26.5` image, digest `sha256:61f6e857a3d65dd2f8daf9c51c7b837fa458bcc9181ae8556e645b534dab6bf6`. |
| Existing orchestration | Repository `scripts/ci-native.sh` clones, boots, copies source, runs lint/build/unit tests, exports optional artifact, and deletes the VM. It uses `--no-graphics`, `CODE_SIGNING_ALLOWED=NO`, and `-only-testing:ArcadiaTests`. This is source inspection, not a fresh execution. |
| Installed GUI/share options | This research ran `ssh paseo-host '/opt/homebrew/bin/tart run --help'`. Installed version exposes `--vnc`, `--vnc-experimental`, `--dir` with `ro`, and `--no-graphics`. No VM was started. |
| UI-test implementation | Checked-in `ArcadiaUITests.swift` has a launch-only example and launch-performance test; these do not assert product behavior. |
| Evidence exporter | Local `xcrun xcresulttool export attachments --help` confirms attachment export with a generated manifest. Guest Xcode exporter version remains unchecked. |
| End-to-end guest GUI | Not experimentally verified: guest desktop readiness, signing, permissions, screenshot/input bridge, app accessibility, backend reachability, and warm iteration timings. |

Repository inspected at `6af1df1159f20489d5198406bb51b0fc4b89df19`; the user's uncommitted working files were not included in this isolated research clone.

## Source and artifact movement

Tart documents SSH via `tart ip` and named directory shares, including read-only mounts under `/Volumes/My Shared Files`. These are host-to-guest shares, not direct laptop-to-remote-guest shares. [Tart quick start](https://tart.run/quick-start/)

Proposed remote path: laptop task checkout → versioned source snapshot on mini → guest-private writable checkout. A read-only source share can carry the snapshot; a separate writable, task-specific artifact share can carry results back. Build products and DerivedData stay inside the VM. Copying source into guest storage avoids assuming shared filesystem build performance or allowing guest changes to overwrite the source snapshot. Existing CI already demonstrates the tar/scp alternative in its source.

Expose only task inputs and output directories. A shared writable cache is an intentional isolation exception; the existing Mint cache is shared that way. Dependency/compiler caches across tasks need an explicit policy, rather than silently making the entire host checkout writable. Apple's virtualization API supports selecting the directories a guest sees. [Apple shared directories](https://developer.apple.com/documentation/virtualization/shared-directories)

## VM lifetime

The user's requirement places every edit/build/run loop inside a VM; it does not yet specify a cold VM for every iteration. A proposed interpretation is one unique clone per task, kept warm through iterations, reset app/fixture state per run, then exported and deleted. This preserves guest-local DerivedData while preventing cross-task app state. A fresh clone per iteration offers stronger state reset but adds boot, login, copy, and cold-build costs; timings have not been measured.

Tart's maintainer describes APFS copy-on-write clones: cloning does not physically copy every disk block. Cheap cloning does not establish cheap booting or building. [Tart maintainer explanation](https://github.com/openai/tart/discussions/292)

Remote host startup also has a prerequisite: Tart documents an unlocked login keychain requirement on macOS 15 and later. Do not confuse that host requirement with having an active guest desktop session. [Tart headless-machine FAQ](https://tart.run/faq/)

## GUI and semantic control

Three possible bridges have different tradeoffs:

1. **Native remote desktop plus guest XCUITest.** View/control the guest using Screen Sharing or the Tart display; host computer control targets that viewer. Assertions run inside the guest. Screen Sharing supports viewing and controlling another Mac and uses VNC. A mini guest's private NAT IP ordinarily needs a reachable route or an SSH tunnel through the mini; this topology is a trial prerequisite. [Apple Screen Sharing](https://support.apple.com/en-nz/guide/mac-help/mh11848/mac)
2. **Guest accessibility helper over SSH.** A guest-side, consistently signed client could return AX roles/identifiers/values and perform supported actions. Apple's APIs provide attribute reads, application lookup by PID, and actions, with unsupported-action and timeout errors. This is a feasible design inference, not an existing Arcadia tool. [Apple AX actions and related APIs](https://developer.apple.com/documentation/applicationservices/1462091-axuielementperformaction)
3. **XCUITest-only exploration.** Write short inspection tests, query identifiers, log query diagnostics, perform actions, and attach screenshots. This reduces infrastructure but makes exploratory feedback depend on test build/run latency. XCUITest queries explicitly support matching identifiers and inspecting values. [Apple element queries](https://developer.apple.com/documentation/xcuiautomation/xcuielementquery)

Installed Tart's help and current upstream source distinguish ordinary `--vnc` from experimental framework VNC. The latter is explicitly experimental; available flags are not proof that a guest connection works. [Tart run implementation](https://github.com/openai/tart/blob/main/Sources/tart/Commands/Run.swift)

A guest AX helper must pass its own guest accessibility trust check. Host permission does not grant guest permission. Apple exposes `AXIsProcessTrustedWithOptions` to check trust; prompting does not immediately change its return value. No TCC database edits, permission changes, or helper installs were performed. [Apple accessibility trust](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)

## Signing, desktop readiness, and evidence

The existing unsigned unit-test command is not a validated UI-test command. The earlier local trial reported a damaged UI-test runner until signing was corrected; that outcome must be reproduced in the guest. Use Xcode's supported signing settings for the app and UI-test runner, verify the resulting bundles, and preserve required entitlements. Record actual signing settings and OS/Xcode versions. Do not treat disabling Gatekeeper or SIP as the solution. Apple documents signing nested code in dependency order and avoiding signing as another user. [Apple signing guidance](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac)

Require a logged-in, unlocked guest desktop, stable display size, resolved first-run prompts, correct selected Xcode, and a reachable app process before UI testing. Tart's image-creation guidance includes automatic login and remote login; the cached image's actual readiness is unverified. [Tart quick start](https://tart.run/quick-start/)

Capture the app/window screenshot rather than the operator's entire host desktop. XCTest screenshots cover screen or element state, can be attached to tests, and expose PNG data. Keep useful attachments on passing tests too, rather than retaining only failures. [Apple XCUIScreenshot](https://developer.apple.com/documentation/xcuiautomation/xcuiscreenshot)

Suggested run bundle: source revision plus diff hash, fixture/integration mode, image digest, Xcode/macOS versions, signing verification, cold/warm timings, command logs and exit codes, `.xcresult`, exported attachment manifest, app-window screenshots, and the specific asserted behavior. Apple's result bundles retain test attachments and are accessible via `xcresulttool`; use the guest tool's help to select compatible export syntax. [Apple testing in Xcode](https://developer.apple.com/videos/play/wwdc2019/413/)

## Smallest validation trial and remaining decisions

1. Clone the cached image to a unique task VM. Confirm unlocked host keychain and guest console user, selected Xcode, SSH readiness, display, and available storage.
2. Copy a controlled source snapshot and deterministic fixtures into guest-private storage. Build and verify app/runner signatures; launch the intended app by exact path/identity.
3. Establish one guest visual/input bridge. Save an app-only before screenshot, interact with a separately identified control, and save the resulting screenshot. Demonstrate semantic inspection inside the guest via XCUITest or AX, rather than infer it from host viewer accessibility.
4. Run one behavior-specific UI assertion with saved `.xcresult` and attachments. Temporarily break that behavior in the disposable trial checkout and require the assertion to fail.
5. Change one visual property and rebuild in the same guest. Compare cold and warm elapsed times and evidence. Reset fixture/app state between runs.
6. Export artifacts before deletion. Repeat from a clean clone to distinguish image assumptions from preserved task state.

Execution should separately test explicit disposable-backend integration from the guest; fixture success says nothing about network or backend configuration. Optional live smoke must remain read-only and explicit, as the user chose.

Choices still requiring resolution or validation: warm-per-task versus fresh-per-iteration lifetime; viewer bridge versus guest AX helper for exploration; remote route/tunnel; pinned ready image and signing/permission bootstrap; backend host placement and guest endpoint; artifact location/retention; acceptable warm-loop latency. The research establishes feasibility and prerequisites, not these preferences or acceptance results.

# Arcadia edit-to-image experiment

Date: 2026-10-25. Question: does first-party SwiftUI preview rendering provide a better rapid visual loop than an incremental app build/relaunch?

## Result

Both paths work without a viewer on Josh's desktop. For the small shared-view edit tested, warm app builds were already competitive. First-party preview rendering was modestly faster on Mac and slower on iPhone Duo. This does not justify replacing the development loop wholesale with Previews or claiming browser-style instant updates.

| Guest-side edit to saved image | SwiftUI RenderPreview | App build/relaunch/capture |
|---|---:|---:|
| Mac | 4.59s | 5.96s |
| iPhone Duo, iOS 27.1 | 13.66s, 12.24s | 7.39s |

These are individual observations, not a repeated benchmark or a guarantee. Mac app compilation itself took 4.88s; iPhone compilation took 5.48s, install 0.59s, launch 0.27s. Final images were visually inspected for their changed title markers. The earlier 10.08s iPhone attempt produced black simctl output and is excluded as visual evidence.

The first successful preview calls took 18.43s on Mac and 71.39s on iOS, after prerequisites. App setup/first passes were kept separate: Mac 20.26s; fresh Duo boot 36.59s plus 141.06s for its initial app pass. Those first-pass numbers are not controlled cold-build comparisons: packages/build products were reused across parts of the experiment, destination and signing settings differed, and simulator setup needed recovery.

## Method and scope

- One disposable background Tart clone on the mini: `arcadia-loop-preview-probe-20261025`, cloned from `arcadia-mobile-xcode-27-1-fastlane-2-241-1`. No CI jobs, templates or workflows modified.
- Xcode 27.1 build27A9275; macOS guest 26.6.2. Both iOS preview and accepted app run used the Duo model with iOS 27.1; they used separate preview/default simulator instances.
- Isolated checkout based on `63fbd8688048f89646ff3c3510458c025addf3c6`, equivalent implementation to merged PR #23. The main checkout's existing edits were untouched.
- A throwaway `IterationProbeView` wraps the actual production `AlbumCardView` with deterministic title/artist/year and no network artwork. A debug environment switch presents the same component in the full app.
- Real source edits change the card's headline font and a visible title marker. Timing starts immediately before the guest writes the edit and ends when a new image is saved. Full-app runs use incremental xcodebuild, persistent DerivedData and build/install/relaunch. No tests run on each edit.
- Preview measurements include the MCP render operation after client initialization. All measurements exclude SSH/source transfer, MCP initialization, artifact download and human/model inspection. They are not complete operator turn latency.
- Mac app capture uses the actual app window. Accepted iPhone app capture uses the Device Hub window, including simulator chrome; preview output is a component image. Image framing differs, so these numbers describe usable visual feedback, not identical rendering workloads.
- This measures a small component edit. It does not verify navigation, audio, queue state, Jellyfin integration, state preservation or full-screen layout changes. It does not measure the human Xcode canvas's continuous-update latency.

## Findings that matter for automation

Apple's headless MCP server can render genuine Arcadia SwiftUI pixels inside the VM. Its RenderPreview output contains destination metadata and a PNG path, which can be exported without opening a host viewer. The service was enabled only in the disposable VM, with a project-folder grant and a 24-hour grant for the specific experiment client; unrestricted agent access remained off. The existing CI trusted-macro behavior required a guest-only Xcode macro-fingerprint validation override. All guest configuration disappears with VM deletion.

Use workspace IDs returned by discovery. In this installed version, passing an absolute project path to a tool that advertised it as accepted returned an unknown-workspace error; the opaque workspace ID worked.

Check actual rendered destination metadata. Selecting iPhone 17 as the workspace destination still produced an iPhone Duo preview on 27.1. The experiment then explicitly selected Duo and used Duo for the accepted comparison. This supports the research note's warning about destination handling; it does not prove all 27.1 previews select the wrong device.

The inherited regular Duo simulator repeatedly shut down before install. The ordinary iPhone 17 control completed, and a fresh task-owned Duo completed. This identifies unreliable inherited simulator state as a candidate to investigate, not a proven root cause.

Successful build/launch and a PNG file are insufficient evidence. Both Duo simctl display captures were black even while Device Hub visibly displayed the correct app. Opening Device Hub inside the VM did not fix the simctl pixel capture. Capturing only the Device Hub window yielded genuine visible UI and the final changed marker. No host desktop or viewer was opened. The black-output cause was not diagnosed in this experiment.

## Recommendation

Keep one warmed task VM, DerivedData directory and simulator for ordinary iteration. Choose one platform and one named state per edit, perform only the incremental build/relaunch/capture required for that view, and run behavioral tests separately. Preserve explicit real-Jellyfin mode for full-app exploration.

Use named SwiftUI previews as an optional route to deterministic component states and visual variants. First-party MCP access is viable, but these measurements do not establish it as the fastest path on every platform. Treat a reliable fresh-image contract and avoiding repeated startup/navigation/full-suite work as the first development-loop improvements. No injection dependency or production preview framework was added.

## Evidence

Saved outside the source checkout at `/Users/josh/.codex/visualizations/2026/10/09/01a12024-58e4-7b43-8bdb-ebeb3d4215ae/arcadia-preview-loop-2026-10-25/`. The evidence archive contains exact scripts, source snapshot, MCP schemas/responses, timings, successful images and rejected black captures. The experiment source is checkpointed on `codex/preview-loop-experiment`; it is not intended for merging into the product.

See [source research](swiftui-development-loop-2026-10-25.md) for Apple's preview/MCP documentation and the evaluated injection-tool alternatives.

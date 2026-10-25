# SwiftUI development iteration: previews, agents and injection

Date: 2026-10-25. Research only; no app, signing, Xcode settings or development commands changed.

## Finding

Apple already supplies both interactive SwiftUI iteration and agent-requested preview rendering. Investigate those before adding hot-reload dependencies. A warm preview is different from installing and relaunching the full app; neither substitutes for full-app behavior verification. No Arcadia latency measurement was performed in this research.

## First-party visual iteration

`#Preview` runs actual project code and supports SwiftUI, UIKit and AppKit. Xcode recompiles the minimum needed for a change and reruns the preview; appearance, text size and orientation can be varied. A preview is therefore a useful UI construction surface, rather than an approximation drawn by another renderer. It does not establish that navigation, networking or playback work correctly in the complete app. [Apple WWDC23: Build programmatic UI with Xcode Previews](https://developer.apple.com/videos/play/wwdc2023/10252/)

Since Xcode 16, previews share the project's build products and reassemble the program dynamically instead of producing a separate application copy. This reduces duplicate build work; it is not a promise that every edit avoids compilation, relaunch or initial simulator startup. [Apple WWDC24: What's new in Xcode 16](https://developer.apple.com/videos/play/wwdc2024/10135/)

Apple's current developer-tools lab explicitly distinguishes initial build cost from warm updates: after the preview is running, the machinery does the minimum work to reload the current source file. Keeping a task's environment warm is consequently worth measuring before changing frameworks. [Apple WWDC26: Xcode Tips and Tricks Group Lab](https://developer.apple.com/go/?id=wwdc26-xcode-tips-and-tricks-group-lab)

`@Previewable` lets dynamic properties such as `@State` be declared inside a preview body, enabling interactive bindings without creating a separate wrapper view. [Apple Previewable reference](https://developer.apple.com/documentation/swiftui/previewable())

`PreviewModifier` creates reusable preview environments and caches shared context across participating previews. That can hold representative models/sample data without repeating expensive setup. It is a preview-specific composition mechanism, not a reason to create a second implementation of product views. [Apple PreviewModifier reference](https://developer.apple.com/documentation/swiftui/previewmodifier)

Recommendation/inference: preview Arcadia's existing shared views in named states such as loading, populated, empty, failed, selected and playing. Use deterministic data for repeatable visual inspection, and retain a separate real Jellyfin full-app loop. Avoid network-dependent preview initialization when a representative model is sufficient.

## Agent access is now first party

Apple documents external-agent access through `xcrun mcpbridge`. Its documented setup requires enabling Xcode Tools access in Intelligence settings and opening the project in Xcode. This is a bridge to Xcode capabilities, rather than a generic standalone command that renders any Swift file. [Apple: Giving external agents access to Xcode](https://developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode)

Xcode 27 release notes additionally document a newer MCP server experience that does not require an open workspace, introduced as a preview in beta 5. Commands include `sudo xcrun mcp-server enable` and `xcrun mcp-server status`; these were **not executed**. The notes document `RenderPreview`, preview groups, and snapshot appearance/orientation/type-size variants, while warning that some server configurations and permissions may require restarting Xcode or the machine. Therefore it is incorrect to say Apple has no agent-accessible preview renderer. [Apple Xcode 27 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes)

Destination handling remains version-sensitive: Xcode 27.2 beta 2 specifically fixes `RenderPreview` to return available destinations and accept a chosen destination. That is evidence to inspect the installed tool schema and actual output on 27.1; it is not evidence that 27.1 cannot render any iPhone preview, nor a recommendation to upgrade to a beta. [Apple Xcode 27.2 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27_2-release-notes)

Read-only local observation: selected `/Applications/Xcode.app` reports Xcode 26.6, build 17F113. `xcrun --find mcpbridge` succeeds. Its `--help` says the bridge auto-selects a running Xcode process and errors when none exists. This does not establish the versions or enabled MCP capabilities inside Arcadia's task VMs. Rendering, permission behavior, background operation and screenshot output remain untested here.

Additional read-only check: `/Applications/Xcode_27.1.app` is also installed locally, reporting Xcode 27.1 build 27A9275 when selected with `DEVELOPER_DIR`. Its `xcrun mcp-server --help` confirms `open`, `enable`, `status`, folder permissions and agent approvals, and directs clients to `mcpbridge`. No server was enabled or launched and no permissions were changed. An Xcode upgrade is therefore not needed merely to investigate the documented headless path; availability inside a particular task VM still needs checking.

For humans, the canvas provides continuous visual interaction. For agents, requesting a specific preview and inspecting its returned image is the relevant interface. A snapshot is visual evidence, not semantic UI automation or proof of playback/queue behavior.

## Established third-party hot reload

InjectionIII recompiles edited files and dynamically loads replacements into a running app. Its documented limits include stored-property layout changes and added/renamed/deleted source files. SwiftUI needs an injection observer and body type erasure. Debug linker flags are required; Xcode 16.3+ log-parsing mode needs `EMIT_FRONTEND_COMMAND_LINES=YES`. Its macOS guidance requires development-time sandbox/library-validation changes. These costs matter for Arcadia's signed isolated workflow. [InjectionIII owner README](https://github.com/johnno1962/InjectionIII)

Inject is a convenience layer over InjectionIII, not an independent compiler or renderer. SwiftUI integration uses `@ObserveInjection` and `.enableInjection()`; the owner describes production builds as no-ops. Its setup expects an injection application and matching Xcode/compiler environment. [Inject owner README](https://github.com/krzysztofzablocki/Inject)

InjectionNext is the successor identified by the InjectionIII owner. It supports simulator, device and macOS injection; function-body edits are the supported case, while signatures/storage changes require rebuilding. It documents file-watcher operation for external editors and an MCP server with screenshots and touch recording/replay. Its log-parsing mode requires compatible build logs, and the README warns of incompatibility with `COMPILATION_CACHE_ENABLE_CACHING`. This is relevant to any future toolchain/cache experiment, not proof of a conflict with Arcadia's current DerivedData cache. [InjectionNext owner README](https://github.com/johnno1962/InjectionNext)

The older HotReloading Swift package is described by its owner as largely superseded. Device injection requires explicit network connectivity and may prompt for network/firewall permission. [HotReloading owner README](https://github.com/johnno1962/HotReloading)

Inference: with builds and execution inside a task VM, keep any watcher, compiler logs, injection service and app in that same guest first. Host edits would need to reach guest source paths before injection. These tools do not automatically remove VM synchronization, permission or screenshot costs, and no cross-VM compatibility was demonstrated by this research.

## Arcadia-specific next experiment, if implementation is authorized

Read-only inspection of `/tmp/arcadia-established-ci` found no `#Preview`, `@Previewable` or `PreviewModifier` declarations in its Swift sources. Its `scripts/native_preview/preview.py` installs the simulator product and launches with `--terminate-running-process`; that path is an ordinary build/install/relaunch loop, despite the command's name.

Measure a small shared-view edit through (1) warm first-party preview render and (2) warm full-app build/relaunch/screenshot, separately on macOS and iPhone. Record initial setup, warm latency, resulting image freshness, failures and whether UI appears on the user's desktop. Check the actual 27.1 MCP schema before designing around newer release-note behavior. Keep CI unchanged. Only evaluate InjectionNext/Inject if first-party iteration still misses the desired feedback speed or full-app state continuity is the demonstrated bottleneck.

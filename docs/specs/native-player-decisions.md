> Current scope (2026-10-31): macOS and standard iPhone. The owner retired Duo support; older Duo requirements below are historical and no longer acceptance criteria.

# Native player interaction and support decisions

Approved by Josh during Vikunja ticket 50 review, 11 October 2026. These decisions resolve the corresponding provisional options in the shared native player specification.

- First launch starts in Songs. Subsequent launches restore the last library destination.
- Explicit Play replaces the queue: a standalone song plays alone; an album or playlist plays in its source order. Play Next and Add to Queue preserve the session.
- Confirm queue replacement only when it would discard manually added upcoming entries. Otherwise replace immediately. Track manual additions by queue-entry identity, including repeated instances of a song.
- Adding music leaves queue visibility unchanged and preserves its scroll position. Show brief accessible feedback with Undo. When the queue is first opened, reveal the current song and upcoming entries; preserve the user's scroll thereafter.
- Minimum deployment targets are macOS 26 and iOS 26. Gate newer Duo-specific composition behind verified API availability and provide the supported baseline layout on older systems. Build with the prepared Xcode 27.1 toolchain where Duo verification requires it; minimum OS and build SDK are separate choices.
- Required real integration uses a separate disposable Jellyfin server, account, library and storage. No changes to the personal server are required. An optional read-only personal-server smoke check can follow when its URL and access are provided.
- Initial integration target is Jellyfin 12.2, verified as a stable upstream release on 11 October 2026: https://github.com/jellyfin/jellyfin/releases/tag/v12.2 . Pin the fixture image by immutable digest and record its actual reported version when establishing the integration stack. This selects a compatibility target; Arcadia compatibility is not yet tested or claimed. Additional versions require their own verification.

Ticket 51 must establish the disposable real-source fixture and demonstrate successful direct browsing; simulated prototype playback and the existing Arcadia API fixture are not substitutes. Existing CI defaults and fixture image pins remain unchanged unless a specific later ticket requires a separately reviewed modification.

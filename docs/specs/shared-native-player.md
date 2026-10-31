> Current scope (2026-10-31): macOS and standard iPhone. The owner retired Duo support; older Duo requirements below are historical and no longer acceptance criteria.

# Shared native Arcadia player

## Problem Statement

Arcadia needs to become a usable personal music player on macOS and iPhone, based on the accepted native SwiftUI library-led studies. The current native application is predominantly album-oriented, uses the Arcadia backend for library access and has limited playback and queue behavior. The studies demonstrate a direction but use invented music and simulated playback. Maintaining separate platform implementations would duplicate behavior and make future changes inconsistent.

## Solution

Build a native library-led listening experience with shared feature views, music models, playback state and commands. Adapt navigation and composition to the available space on macOS, iPhone and iPhone Duo. Connect directly to a real Jellyfin music source through an internal interface, with Jellyfin details confined to its adapter and configuration. Deliver actual streaming and queue behavior, validated against Jellyfin as well as deterministic fixtures.

## User Stories

1. As a listener, I want to connect to my Jellyfin music library, so that I can listen without an additional Arcadia backend.
2. As a listener, I want clear connection and authentication feedback, so that I can correct an unavailable or invalid connection.
3. As a listener, I want connection credentials handled privately, so that ordinary logs and screenshots do not expose them.
4. As a listener, I want to browse songs directly, so that choosing music does not require navigating through an album.
5. As a listener, I want to browse artists, so that I can explore their music across releases.
6. As a listener, I want to browse albums and their ordered tracks, so that I can listen to a release as intended.
7. As a listener, I want to browse source-provided playlists, so that I can choose an existing collection of songs.
8. As a listener, I want search across songs, artists, albums and playlists, so that I can find music without knowing its browsing category.
9. As a listener, I want artwork and readable music metadata, so that I can recognize what I am browsing and hearing.
10. As a listener, I want loading, empty and failed-request states, so that I understand what is happening and can recover.
11. As a listener, I want large libraries to load in pages without duplicate entries, so that browsing remains usable.
12. As a listener, I want to play an individual song, so that I can listen spontaneously.
13. As a listener, I want album Play to replace the queue with tracks in release order, so that I hear the complete album.
14. As a listener, I want playlist playback in its source order, so that I can listen to that collection.
15. As a listener, I want Play Next, so that I can choose what follows without interrupting the current song.
16. As a listener, I want Add to Queue, so that I can extend the listening session from anywhere in the library.
17. As a listener, I want to inspect, remove and reorder upcoming songs, so that I can shape the session.
18. As a listener, I want persistent compact playback controls while browsing, so that I can pause or advance without leaving the library.
19. As a listener, I want an expanded player and an accessible queue presentation, so that I can focus on the current session.
20. As a listener, I want accurate progress and seeking for real streams, so that I can move within a song reliably.
21. As a listener, I want automatic advancement when a song ends, so that queued music continues playing.
22. As a listener, I want clear playback failure feedback, so that an unavailable stream does not appear to be playing successfully.
23. As a listener, I want reopening to restore the queue and position paused, so that I can resume deliberately.
24. As a Mac listener, I want keyboard shortcuts, media keys and system Now Playing controls, so that playback fits normal desktop use.
25. As an iPhone listener, I want native touch navigation and system playback controls, so that listening works naturally on my phone.
26. As an iPhone listener, I want playback to continue when the app is backgrounded or the screen locks, so that normal phone use does not end my session.
27. As a listener, I want the current song, queue, playback position and browsing selection preserved when the layout changes, so that resizing or folding does not restart the session.
28. As a Duo listener, I want both displays and partially folded arrangements to keep content and controls usable, so that the hinge and reserved regions do not obstruct listening.
29. As a listener using a short-height layout, I want transport controls reachable without scrolling through oversized artwork, so that I retain control of playback.
30. As a listener using accessibility features, I want labeled controls, keyboard/focus access where applicable and adaptable text, so that the native experience remains operable.
31. As Arcadia's developer, I want shared feature changes to appear on macOS and iPhone, so that behavior and visual refinements do not require duplicate implementations.
32. As Arcadia's developer, I want fixture and real-Jellyfin evidence, so that attractive simulated screens are not mistaken for a working player.
33. As Arcadia's developer, I want native builds and reviews to run in an isolated background VM with exported evidence, so that ordinary iterations do not interrupt my desktop.

## Implementation Decisions

- Organize shared content and behavior around Library, Player and Queue features. Reuse meaningful SwiftUI views for song rows/actions, artwork, library content, player information/transport and queue content. Do not copy the throwaway prototypes into production as the architecture.
- Own playback, queue and durable browsing state above adaptive presentation. Layout changes must not recreate the session. A queue entry needs identity independent of song identity so repeated songs can be edited and advanced correctly.
- Keep platform shells small: macOS windows, sidebar, menus, keyboard and pointer behavior; iPhone tabs, touch navigation and sheet/full-screen presentation. Reuse content and actions without forcing identical native navigation or adding platform flags throughout every feature view.
- Adapt to available space, size classes, safe areas and fold-related reserved regions. Width-only or orientation-only branching is insufficient for Duo. Use supported native adaptive composition; exact API availability and deployment targets must be verified when implementing.
- Retain library-led browsing with songs, artists, albums and playlists. Expanded Now Playing remains secondary. macOS supports a toggleable trailing queue inspector; compact iPhone exposes a dedicated queue presentation; expanded player layouts can show player and queue together.
- The internal music-source interface covers connection/session handling, browsing, search, artwork and playable audio access. The current album-only service is prior art, not an already complete implementation of this contract. Extend or replace it cohesively rather than adding parallel provider-specific seams to each screen.
- Jellyfin is the first real adapter. Source identifiers and credentials stay within source/session abstractions. Views and playback must not parse Jellyfin responses or construct Jellyfin endpoints. Credentials use platform-secure storage and are excluded from diagnostic evidence.
- Native listening must not require the Arcadia backend. Preserve unrelated acquisition and synchronization services and existing CI behavior.
- Playback uses real playable audio, explicit errors and reliable duration/progress handling. Shared commands own playback and queue semantics; platform system-media integrations call those commands.
- Album Play replaces the queue in track order. Play Next inserts immediately after the current entry; Add to Queue appends without interrupting playback. Removing or reordering upcoming entries preserves the current entry and playback position.
- Persist enough source-independent session information to restore queue and position paused. Refresh source access as needed rather than treating previously resolved stream URLs as permanently valid.
- iPhone background audio and system-media integration are part of usable listening, not proof supplied by simulated prototype state.
- CarPlay is a future platform: preserve reusable models, session state and commands; its native template presentation is separate from SwiftUI view reuse.
- Do not introduce a generic UI framework solely to maximize reuse. A shared feature change should be demonstrable on both platforms.

## Testing Decisions

- Test externally observable behavior and outcomes, rather than view structure, implementation details or snapshots alone. Public app UI is the principal end-to-end acceptance boundary; music-source adapter contract checks supplement it where request/response and failure behavior need precise verification.
- Real Jellyfin integration is REQUIRED acceptance evidence. Use a controlled test account/library with known songs, artists, albums, playlists and artwork. Record server version, library fixture identity and data mode without credentials. Configuration is external to the spec; a missing server is a blocked acceptance gate, not a passing skipped test.
- Against real Jellyfin, verify successful and invalid connection handling, browsing and search in all supported categories, artwork, pagination where available, actual stream playback, audible/output evidence or an equivalent verified audio-output check, pause/resume, seeking, natural end-of-track advancement and queue actions. Advancing a UI timer alone does not prove audio playback.
- On both macOS and iPhone, verify at least one complete real-source listening journey from connection through browse/search to playback and queue modification. Verify system playback controls; on iPhone include background/lock-screen continuity.
- Initial-PR exception, explicitly accepted by Josh on 15 October 2026: direct iOS native Now Playing card and system-command verification is waived ("just assume this works it's ok"). This is an accepted assumption, not a tested pass or physical-device proof. Keep actual verified audio-output evidence separate; retain the native-control verification limit in the PR and evidence handoff.
- Keep deterministic fixtures for repeatable success, empty, request failure and two-page cases, plus mixed queues, duplicate song entries and playback failures. Inject them through the same source contract as Jellyfin. Fixture success cannot substitute for real-source acceptance.
- Use existing native XCUITest patterns: stable accessibility identifiers, separately targetable controls, explicit behavioral assertions and saved app-window screenshots/results/logs. Add meaningful shared-state tests for queue ordering, duplicate entries and restoration where they isolate behavior more reliably than UI timing.
- Verify search and browsing do not interrupt playback; album queue replacement follows track order; Play Next and append preserve the current song; removal/reordering affects the intended queue entry; restart restores paused at the saved position.
- Verify common feature behavior on macOS and iPhone, including empty/error recovery, artwork fallback, readable text and accessible transport. Visually review the shared view in compact and expanded compositions.
- In actual Duo simulation, exercise both outer and inner displays, closed/open/partially folded states and rotation, using committed native fold transitions without app relaunch. Preserve current song, playback state/position, queue contents/order and browsing selection. Check hinge avoidance, reserved regions and short-height transport visibility.
- Record transitions as well as settled screenshots. The existing study's intermittent black previews require investigation before claiming smooth folding; classify simulator versus application causes with evidence rather than treating settled images as animation approval.
- Run builds, launches and tests inside a task-scoped isolated VM in the background, reuse warm builds/cached lint within the task and export evidence before cleanup. Real Jellyfin may run outside the VM as an explicitly configured integration service. Do not open a host viewer unless requested.
- Include before/after screenshots where applicable in implementation PRs, plus test summaries and known limitations. A deliberate behavioral regression must fail the relevant assertion when validating the extended loop.

## Out of Scope

- Web UI and parity with web workflows.
- Acquisition, Sony Walkman synchronization and unrelated backend rewrites.
- Offline downloads, additional music-source adapters and production CarPlay presentation in this build.
- Audio visualization, a new physical-device/e-ink aesthetic or replacing the accepted native SwiftUI direction.
- Playlist creation/editing, social features and recommendation systems; browsing existing playlists is included.
- Unrelated CI redesign, deployment or changes to production music data during test runs.
- Treating a simulator study as real-device or real-audio proof.

## Further Notes

This specification synthesizes the accepted macOS/iPhone starting point and reusable-view requirement. Josh approved its ticket breakdown and invoked implement-spec on 11 October 2026. Implementation proceeds through the tracker dependency graph on a single integration branch.

Primary design evidence is preserved on the throwaway branch `prototype/swiftui-studies`: library-led comparison at `3c3cd98`, listening flow at `64b5409`, song-first macOS study at `cf6ee6b`, iPhone study at `f792121`, and Duo verification documentation at `532f3c5`. Vikunja task 47 contains mobile screenshots, native Duo captures, recordings and state-check results. The source-boundary ADR and product-direction record remain governing inputs.

The [approved native player decisions](native-player-decisions.md), recorded in completed Vikunja task 50, settle the provisional interaction choices, deployment baseline and Jellyfin integration target. They supersede corresponding options in the prototypes. Implementation tickets 51–60 carry native blocking links and references to these decisions.

Known Duo refinements: the expanded library sidebar currently wastes space, artwork crosses a horizontal fold, short-height player layouts hide transport below oversized artwork, and repeated folding recordings expose unresolved black previews. These are acceptance concerns for the production layouts, not reasons to duplicate platform feature views.

The requirement for real Jellyfin integration was explicitly added during testing-boundary review. Deterministic UI verification remains complementary; completion requires real-source listening evidence.

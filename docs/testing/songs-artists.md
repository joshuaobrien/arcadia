# Songs and Artists browsing

Songs leads a new library session. The app restores the last library destination; its namespaced preference remains separate from the connected source's Keychain session. Songs and Artists each retain their loaded pages and browsing position while switching destinations. Artist details reuse song presentation and show credited songs separately from album-artist releases. Selecting a song uses the shared player session; contextual artist/release navigation does not create a player.

Track metadata carries optional, opaque artist and album references. Album references carry the release's own album artist, rather than substituting a track's credited performer. Artwork uses a track image or its parent album image, with the shared artwork fallback when neither is available.

Jellyfin 12.2 still supports the deprecated `/Artists` endpoint. The adapter deliberately uses that bounded compatibility route because its IDs match `Audio.ArtistItems`; `/Persons` returns a different identity family. Any future migration belongs entirely in the adapter and must keep artist selection, song filtering and release filtering coherent. Views do not join identities by artist name.

## Reproducible integration fixture

Run `test-environment/native/jellyfin.py start --root FRESH_TASK_ROOT --port UNUSED_PORT --artist-count 23` on the VM host. This creates a separate task-owned, digest-pinned Jellyfin 12.2 container with 26 songs, 24 albums and 23 artists. Arcadia Test Ensemble has 4 songs across Orb Sessions and Fixture Album02; the remaining 22 albums each have a different artist. Internet metadata providers remain disabled. The default one-artist fixture is unchanged.

The richer fixture verifies distinct artist IDs and records its known opaque song, artist and album identities in its private configuration. Copy the configuration's `server`, `username`, `password`, `firstSongID`, `secondSongID`, `artistID`, `lastArtistID` and `albumID` into guest `/tmp/arcadia-jellyfin-fixture.json`, replacing `server` with the task relay URL. Keep mode 0600, remove any exchange copy immediately, and exclude the configuration from evidence. See the native fixture README for relay ownership and cleanup.

All app builds and tests run inside the disposable task VM in the background. Reuse the approved local Xcode 27.1 template and warm dependencies as documented for native playback; no host viewer or CI workflow change is required. Select `ArcadiaTests/SongArtistSourceTests`, `ArcadiaUITests/SongArtistBrowseTests` and `ArcadiaUITests/RealSongArtistBrowseTests` explicitly. A skipped real-source test does not count as acceptance.

The source contract verifies 20+6 song and 20+3 artist pages without duplicate identities, artist/song identity agreement, two real releases and credential-free artwork references. Public UI tests cover Songs-first navigation, loading, empty content, request failure/retry, pagination, restored destinations, retained browsing position and real browse-to-play journeys. Existing album-focused suites select Albums explicitly.

## Actual playback while browsing

The real journey optionally coordinates with the existing guest-only Core Audio capture helper through the UI runner's `tmp/arcadia-audio-capture-53` directory. Arm a fresh capture only for the explicit output check. The three phases are standalone First Contact, contextual artist navigation while that song continues, and explicit Persistent State play from the artist. After capture, export PCM/chunks/phases/results and run:

```
python3 test-environment/native/verify-audio.py CAPTURE_DIRECTORY --profile browsing
```

The independent expected tones are 520 Hz, 520 Hz and 600 Hz. Missing callbacks, insufficient samples, silence or the wrong tone fail. The original transport profile still verifies play/pause/resume/seek/natural advancement. Remove `armed` after the helper finishes before ordinary test suites. Guest consent may require both system-audio and private-picker dialogs; consent applies only to the disposable guest's responsible process.

Export app-window screenshots, XCTest results, filtered runtime logs and password-free fixture facts. Keep the richer backend for dependent task work only with an explicit ownership handoff; otherwise stop its owned relay/container and remove disposable storage after evidence export. Discard the task VM after validation, while preserving reusable templates and lint/dependency caches.

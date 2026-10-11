# Disposable direct Jellyfin integration

This fixture verifies Arcadia's direct music-source adapter. It is separate from the existing Arcadia API fixture and does not change CI defaults. Run it on the task VM host with Docker available; all application builds, launches, lint and XCTest runs stay inside the task VM.

The image is pinned by digest in `jellyfin.py`. Startup requires its reported version to be 12.2.0. The library contains 24 albums, including Orb Sessions with three ordered tracks and artwork. Generated audio is a short tone, not copyrighted music. Internet metadata providers and automatic port mapping are disabled.

## Start and connect the task

On the VM host, run `python3 jellyfin.py start --root /tmp/arcadia-jellyfin-TASK --port PORT`. Choose an unused port and a fresh task directory. The root is private and contains a random disposable password in `fixture.json` with mode 0600. `evidence.json` contains the server version, immutable image identity and album count without the password. Never upload `fixture.json`, configuration storage, request bodies or access tokens as evidence.

The container listens on host loopback by default. When the guest cannot reach loopback directly, run `relay.py` with the same root, the host's VM-network interface as `--bind`, an unused `--port`, and the fixture port as `--upstream-port`. This relays only that disposable fixture. Do not bind the relay to all host interfaces. Its PID is recorded in `relay.pid`; retain the process for the lifetime of this task only.

Copy just `server`, `username` and `password` from the private fixture configuration into `/tmp/arcadia-jellyfin-fixture.json` inside the task guest, substituting the relay's guest-reachable server URL. Keep this file 0600. Transfer through the task's private artifact exchange, then remove the exchange copy. Do not place credentials in source, shell arguments, environment variables, XCTest typed-text events or logs. The UI test uses the guest pasteboard for the password.

Run the explicit public contract and UI tests with the existing loop entry point:

```
scripts/native-loop --host VM_HOST --only-testing ArcadiaTests/JellyfinSourceTests --only-testing ArcadiaUITests/JellyfinBrowseTests test TASK
```

Both real-source tests must execute and pass. A skipped test means the private guest configuration was absent and is not integration acceptance. Run the full unit and UI suites explicitly at completion; the loop's unchanged default only selects existing feedback-loop UI tests.

## Evidence and cleanup

Export app-window screenshots, XCTest results, logs filtered to the run ID, and the password-free fixture evidence before destroying the VM. The screenshots show recoverable sign-in failure, two-page browsing, artwork and ordered tracks. Connection sessions are stored in the guest Keychain; disconnect removes the saved session.

Stop the relay process identified by this task's `relay.pid`, confirming its command belongs to this fixture. Run `python3 jellyfin.py stop --root /tmp/arcadia-jellyfin-TASK`; cleanup checks the container's ownership label before removing it. Once password-free evidence is exported, remove the owned fixture directory (including disposable config/cache/music) and discard the task VM. Preserve unrelated containers, reusable VM templates and dependency/lint caches.

The optional `--artist-count 23` setup adds a paged artist library and independent opaque IDs for real Songs/Artists journeys. See [Songs and Artists browsing](../../docs/testing/songs-artists.md) for expected counts, private guest inputs and actual-output verification. Its default remains the original one-artist fixture.

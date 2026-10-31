# Arcadia

Arcadia is a personal music acquisition, library, and Sony NW-A55 synchronization tool. MusicBrainz supplies catalog identity, Arcadia searches and downloads through slskd, beets owns review/tagging/import, and Jellyfin provides read-only browsing and playback.

## Development

For the macOS application, use the [background VM development loop](docs/native-feedback-loop.md). Builds, UI tests and app-window screenshots run inside a disposable task VM.

For an interactive local review on your Mac and an iPhone simulator:

```sh
./scripts/native-preview
./scripts/native-preview --device iphone
```

The launcher uses real Jellyfin connection mode and a separate review app identity. It requires Xcode 27.1 or later; `--check` reports missing capabilities without building or changing simulators. See [local previews and iOS CI](docs/native-feedback-loop.md#local-interactive-previews) for setup, logs and runtime requirements.

The native app can connect directly to a Jellyfin music source, storing its session in the platform Keychain. Debug builds default to deterministic fixtures; select `ARCADIA_DATA_MODE=jellyfin` to exercise connection and real browsing. Release builds default to direct source connection. The existing `integration` and `live-readonly` modes retain explicit Arcadia API access during the transition. See the [disposable direct Jellyfin fixture](test-environment/native/README.md) for real-source verification without personal-server changes.

```sh
npm install
amp orb services ensure
npm test
npm run typecheck
npm run build
```

The Vite interface uses port 5173 and the Fastify API uses port 8787. The production-faithful environment contains exactly Arcadia, slskd, beets-flask, and Jellyfin; see [`test-environment/README.md`](test-environment/README.md).

## Runtime configuration

- `SLSKD_URL` and `SLSKD_API_KEY` connect direct Soulseek acquisition.
- `SLSKD_DOWNLOADS_ROOT` is the slskd destination (default `/downloads`).
- `SLSKD_PATH_MAPPINGS` maps provider download paths into Arcadia/beets-visible paths, for example `[{"id":"downloads","providerPrefix":"/downloads","needlePrefix":"/music_path/inbox"}]`. The `needlePrefix` field name is retained for configuration compatibility.
- `BEETS_URL` connects the sole canonical-library mutation owner. Arcadia submits only explicitly reviewed imports and never deletes inbox content.
- `JELLYFIN_URL` and `JELLYFIN_API_KEY` enable read-only album, track, artwork, and audio-stream access.
- `MUSIC_LIBRARY_PATH` points at the canonical library mounted read-only in Arcadia.
- `ARCADIA_DATABASE_PATH` stores durable acquisition workflows and beets operations in SQLite. Run one writer per database. `NEEDLE_DATABASE_PATH` remains accepted for existing deployments.
- `ARCADIA_PUBLIC_URL` is Arcadia's externally reachable origin, used for durable listening links (for example `https://arcadia.example`). Audio and artwork paths remain relative to that origin. `NEEDLE_PUBLIC_URL` remains accepted for existing deployments.

MusicBrainz catalog access needs no provider secret. Soulseek credentials belong to slskd and must be supplied as deployment secrets, never committed or printed.

Arcadia persists wanted intent, direct candidate selection, transfer correlation, and import operations. Old acquisition/import records remain displayable as history, but only direct workflows can start or report live acquisition progress.

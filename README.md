# Needle

Needle is a personal music acquisition, library, and Sony NW-A55 synchronization tool. MusicBrainz supplies catalog identity, Needle searches and downloads through slskd, beets owns review/tagging/import, and Jellyfin provides read-only browsing and playback.

## Development

```sh
npm install
amp orb services ensure
npm test
npm run typecheck
npm run build
```

The Vite interface uses port 5173 and the Fastify API uses port 8787. The production-faithful environment contains exactly Needle, slskd, beets-flask, and Jellyfin; see [`test-environment/README.md`](test-environment/README.md).

## Runtime configuration

- `SLSKD_URL` and `SLSKD_API_KEY` connect direct Soulseek acquisition.
- `SLSKD_DOWNLOADS_ROOT` is the slskd destination (default `/downloads`).
- `SLSKD_PATH_MAPPINGS` maps provider download paths into Needle/beets-visible paths, for example `[{"id":"downloads","providerPrefix":"/downloads","needlePrefix":"/music_path/inbox"}]`.
- `BEETS_URL` connects the sole canonical-library mutation owner. Needle submits only explicitly reviewed imports and never deletes inbox content.
- `JELLYFIN_URL` and `JELLYFIN_API_KEY` enable read-only album, track, artwork, and audio-stream access.
- `MUSIC_LIBRARY_PATH` points at the canonical library mounted read-only in Needle.
- `NEEDLE_DATABASE_PATH` stores durable acquisition workflows and beets operations in SQLite. Run one writer per database.

MusicBrainz catalog access needs no provider secret. Soulseek credentials belong to slskd and must be supplied as deployment secrets, never committed or printed.

Needle persists wanted intent, direct candidate selection, transfer correlation, and import operations. Old acquisition/import records remain displayable as history, but only direct workflows can start or report live acquisition progress.

# Needle

Needle is a personal music acquisition, library, and Sony NW-A55 synchronization tool. Lidarr is used as an acquisition controller only; it does not own or mutate the canonical music library.

## Development

```sh
npm install
amp orb services ensure
```

The development services are declared in `.amp/services.yaml`:

- Vite interface: port `5173`
- Fastify API: port `8787`

Run the verification suite with:

```sh
npm test
npm run typecheck
npm run build
```

## Production-faithful test environment

Needle includes a disposable Docker Compose environment with real Lidarr, slskd, beets-flask, and Jellyfin services, deterministic tagged music, and portable production-equivalent path mappings. It is the default runtime in Amp orbs and can also run locally.

See [`test-environment/README.md`](test-environment/README.md) for startup, reset, live Soulseek credentials, and image-locking instructions.

## Docker

The production image uses Node 24 LTS, builds the Vite interface, and serves it with the Fastify API on port `8787`.

```yaml
services:
  needle:
    build: ./needle
    container_name: needle
    init: true
    environment:
      - LIDARR_URL=http://lidarr:8686
      - LIDARR_API_KEY=${LIDARR_API_KEY}
      - JELLYFIN_URL=http://jellyfin:8096
      - JELLYFIN_API_KEY=${JELLYFIN_API_KEY}
      - BEETS_URL=http://beets-flask:5001
      - MUSIC_LIBRARY_PATH=/music
      - NEEDLE_DATABASE_PATH=/data/needle.sqlite
      - TZ=Etc/UTC
    volumes:
      - needle-data:/data
      - /path/to/music:/music:ro
    ports:
      - "8787:8787"
    restart: unless-stopped

volumes:
  needle-data:
```

`LIDARR_URL` names the Lidarr origin visible from the Needle container and must not include `/api/v1`. When both services belong to the same Compose project, the Lidarr service name resolves directly through Compose DNS.

`JELLYFIN_URL` and `JELLYFIN_API_KEY` provide Needle's read-only library browser with album, track, and artwork metadata. Create the key in Jellyfin under **Dashboard → Advanced → API Keys**. Needle does not send a Jellyfin user ID or call mutation endpoints.

`BEETS_URL=http://beets-flask:5001` enables the beets-flask inbox and import workflow. Needle reads inbox and session state, requests metadata previews, and submits only explicitly approved candidate imports. Duplicate handling is limited to skip or keep; Needle never calls beets-flask delete operations. Every approval explicitly declares whether the import fulfills a wanted release because beets-flask 1.2.x does not expose enough authoritative identity to infer that link safely. Linked journeys move from wanted to importing and complete only after Jellyfin confirmation. Approved operations and their exact choices are persisted in Needle's database, shown in Activity, and marked library-confirmed only after an exact fresh Jellyfin album, artist, and audio-track-count match. This integration targets the internal API of beets-flask 1.2.x, so pin and test that service before upgrading it.

`MUSIC_LIBRARY_PATH` points to the canonical audio filesystem inside the Needle container. Mount the corresponding host directory read-only; Needle uses these bytes for inventory and future device synchronization, while Jellyfin supplies the browsing projection.

`NEEDLE_DATABASE_PATH` enables Needle-owned durable state in SQLite. The named volume preserves the database, write-ahead log, and shared-memory files across container replacement. Needle currently runs as a single writer; do not run multiple replicas against the same database.

Needle does not expose Lidarr or Jellyfin mutation operations. Beets-flask preview and import mutations are constrained to current inbox albums and require explicit candidate approval.

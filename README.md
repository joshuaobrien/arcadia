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

## Docker

The production image builds the Vite interface and serves it with the Fastify API on port `8787`.

```yaml
services:
  needle:
    build: ./needle
    container_name: needle
    init: true
    environment:
      - LIDARR_URL=http://lidarr:8686
      - LIDARR_API_KEY=${LIDARR_API_KEY}
      - TZ=Etc/UTC
    ports:
      - "8787:8787"
    restart: unless-stopped
```

`LIDARR_URL` names the Lidarr origin visible from the Needle container and must not include `/api/v1`. When both services belong to the same Compose project, the Lidarr service name resolves directly through Compose DNS.

Needle does not expose Lidarr mutation operations over HTTP. The current production surface is connection status, catalog lookup, acquisition queue, and acquisition history.

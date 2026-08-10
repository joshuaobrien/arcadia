# Production-faithful test environment

This stack runs the real Needle integration boundaries: plugin-capable Lidarr with the pinned slskd plugin, slskd without a VPN, beets-flask with Needle's production import policy, and Jellyfin. It uses portable repository-local state and the same container paths as the home deployment. Lidarr's completed-download handling is disabled: it discovers and acquires releases but leaves files in the shared inbox for beets-flask to tag and manage. Its view of the canonical music library is read-only.

## Orb usage

A fresh Amp orb runs `.agents/setup`, which installs Docker, starts `dockerd` as a supervised orb service, installs dependencies, and generates deterministic media. `amp orb services ensure` starts the stack and exposes Needle as a portal.

The default fixture collection contains a playable album in the canonical library and a separate completed download in the Soulseek inbox. slskd uses deliberately invalid offline credentials, so its `/health` endpoint may report `502` even though the service is working as intended. Set `NEEDLE_TEST_SLSK_USERNAME` and `NEEDLE_TEST_SLSK_PASSWORD` as Amp project secrets only when a test genuinely requires the live Soulseek network.

```sh
amp orb services ensure
./test-environment/bin/verify
```

Reset every service to deterministic empty application state and regenerate fixtures with:

```sh
./test-environment/bin/reset
amp orb service restart needle-test
```

## Local usage

Docker Engine, Docker Compose, Node 24, ffmpeg, curl, and jq are required.

```sh
sudo dockerd # only when Docker is not already managed by the host
PORT=8787 ./test-environment/bin/orb-stack
```

Needle is available on port 8787. Debugging interfaces remain bound to loopback:

- Lidarr: 8686
- slskd: 5030 (`needle` / `needle-test-password`)
- beets-flask: 5001
- Jellyfin: 8096 (`needle` / `needle-test-password`)

## Reproducibility

`images.env` pins every upstream container to an immutable multi-platform manifest digest, including the plugin-capable Lidarr image. `bin/prepare` installs `Lidarr.Plugin.Slskd` 1.1.1.0 from its checksum-verified release archive. Run `bin/capture-production-images` on the home Docker host and update image values when intentionally adopting different production image bits.

Runtime state, generated music, access tokens, and databases are ignored by Git. Test credentials are intentionally local and must never be reused in production.

The one intentional topology difference is that this stack omits Gluetun and binds service interfaces to loopback. Seeded mode does not contact Soulseek; optional live mode connects slskd directly and must only be used where that is acceptable.

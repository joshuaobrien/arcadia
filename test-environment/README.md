# Production-faithful test environment

This Compose stack contains exactly Arcadia, slskd, beets-flask, and Jellyfin. It uses repository-local disposable state and production-equivalent download/inbox/library paths. No VPN sidecar is included.

```sh
amp orb services ensure
./test-environment/bin/verify
```

The fixture has a playable canonical-library album and a separate completed download in the beets inbox. slskd defaults to invalid offline Soulseek credentials; provide `NEEDLE_TEST_SLSK_USERNAME` and `NEEDLE_TEST_SLSK_PASSWORD` only as project secrets for intentional live-network tests. Never commit `runtime.env` or print secret values.

Reset with `./test-environment/bin/reset`, then restart the supervised `arcadia-test` service. For local use, run `PORT=8787 ./test-environment/bin/orb-stack`. Debug interfaces bind only to loopback: slskd 5030, beets-flask 5001, and Jellyfin 8096.

`images.env` pins all upstream images. `bin/capture-production-images` reports replacement digests from a production host. `bin/verify` confirms Arcadia can reach MusicBrainz, slskd, beets-flask, and Jellyfin, browse the inbox, and stream ranged audio.

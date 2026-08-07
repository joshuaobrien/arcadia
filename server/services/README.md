# Service boundaries

Needle owns wanted state, sync intent, search selections, transfer correlation, and transfer history. External services are capability adapters rather than domain authorities.

| Port | Initial adapters | Notes |
| --- | --- | --- |
| `CatalogLookupPort` | Lidarr, MusicBrainz | MusicBrainz IDs are cross-provider identities; provider IDs remain opaque. |
| `MusicAutomationPort` | Lidarr | Commands are asynchronous and version-sensitive. Lidarr's queue aggregates its configured download clients. |
| `ReleaseSearchPort` | Prowlarr, slskd | Prowlarr searches synchronously. slskd retains asynchronous search jobs. |
| `TransferClientPort` | qBittorrent, SABnzbd, slskd | Payloads remain protocol-specific. Controls are exposed through runtime capabilities. |
| `LibraryImportPort` | beets, Lidarr | Import paths are provider-local and require explicit path mappings. |
| `NotificationPort` | ntfy | Notifications report Needle state; they do not own workflow state. |

## Adapter rules

1. Vendor transport DTOs never escape an adapter. Preserve unmodeled fields in `raw` only where diagnostics or compatibility require them.
2. Every provider identifier is paired with `adapterId`. Display names are never identifiers.
3. Every mutation receives a Needle `operationId`. Adapters use it for tags, categories, batch IDs, or logs where the provider permits correlation.
4. Paths are assumed to exist in the provider's container namespace. A path only becomes usable by Needle after an explicit mapping.
5. Normalized states always retain `rawState`. SABnzbd post-processing, qBittorrent seeding, and Soulseek queueing are not interchangeable.
6. Unsupported controls fail before making a remote request. The UI reads adapter capabilities rather than guessing from provider type.
7. Needle persists its own ledger. qBittorrent has no durable deleted-transfer history, Prowlarr search handles expire, and slskd records can be cleared.
8. Cancelling active work and removing its provider record are separate actions. Data deletion is never implied and always requires `deleteData: true`.
9. List operations are cursor-paginated even when an upstream API uses page numbers. The adapter owns cursor translation.

`AcquisitionJob` is the durable Needle workflow. It links any number of provider search jobs to a selected candidate, transfer, and import operation. Provider polling updates this record; provider records do not replace it.

## Provider-specific constraints

### Lidarr

- `/api/v1`, authenticated with `X-Api-Key`.
- Artist/release lookup and monitoring are catalog-aware.
- Searches, refreshes, rescans, and downloaded-album scans are runtime command jobs. Command names and payloads must be version-gated.
- Queue removal may optionally remove the underlying client item or blocklist the release. Pause/resume belongs to the actual transfer client.

Needle configures the adapter through `LIDARR_URL` and `LIDARR_API_KEY`. The URL is the Lidarr origin or configured URL base, without `/api/v1`.

The server currently exposes the read model at:

- `GET /api/services/lidarr`
- `GET /api/services/lidarr/artists?term=...`
- `GET /api/services/lidarr/releases?term=...`
- `GET /api/services/lidarr/profiles`
- `GET /api/services/lidarr/roots`
- `GET /api/services/lidarr/queue?limit=...&cursor=...`
- `GET /api/services/lidarr/history?limit=...&cursor=...&since=...`

The adapter also implements artist creation, release monitoring, verified Lidarr command submission, command polling, and queue removal. These mutations are not exposed over HTTP until Needle's acquisition workflow can persist intent and operation results.

### Prowlarr

- `/api/v1`, authenticated with `X-Api-Key`.
- Search results represent downloadable releases, not catalog entities.
- Searches are synchronous.
- Grab handles depend on an in-memory result cache and expire. Prefer extracting a magnet/download URL and enqueueing through a selected transfer adapter.

### slskd

- `/api/v0`; treat the API as unstable and pin tested versions.
- Searches are retained asynchronous jobs with explicit stop and delete operations.
- Downloads use the batch endpoint and identify remote files by username, path, and size.
- General pause/resume must not be advertised unless verified against the connected version.

### qBittorrent

- `/api/v2`; cookie login is the compatibility baseline.
- Enqueue does not reliably return the resulting hash. Parse the info hash or reconcile using Needle tags/categories.
- Completed torrents only remain visible while retained. Persist history before deletion.
- Pause/resume endpoint names differ between 4.x and 5.x and require version gating.

### SABnzbd

- Mode-based `/api`; the API key is generally a query parameter and must be redacted from logs.
- Enqueue returns stable `nzo_id` values.
- Active queue and history are separate. A missing queue item must be checked in history before being marked missing.
- Mutation success booleans are not always authoritative; verify resulting state.

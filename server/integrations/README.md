# Integration boundaries

Needle owns durable acquisition intent and workflow state. External systems expose capabilities, not domain authority.

| Adapter | Responsibility |
| --- | --- |
| MusicBrainz | Artist, release-group, concrete-edition, media, and track identity. |
| slskd | Soulseek search, candidate files, direct batch submission, and transfer reconciliation. |
| beets-flask | Explicit metadata preview and approved import; sole canonical-library mutation owner. |
| Jellyfin | Read-only library projection, artwork, refresh after import, and audio streaming. |

Every provider identifier carries an `adapterId`, every mutation receives a Needle operation ID, and provider paths become usable only through explicit mappings. Needle's SQLite ledger remains authoritative when transient provider records disappear.

## Direct acquisition

`SLSKD_URL` and `SLSKD_API_KEY` configure slskd. `SLSKD_DOWNLOADS_ROOT` chooses its download root. `SLSKD_PATH_MAPPINGS` is a JSON array of `{ id, providerPrefix, needlePrefix }` objects mapping completed downloads into the inbox namespace shared with beets. Search uses MusicBrainz release editions and tracks to score Soulseek candidates before submitting exact files.

## Import and library

`BEETS_URL` configures beets-flask. Candidate imports require an explicit choice per task; duplicate handling is limited to `skip` or `keep`, and delete is unsupported. Needle persists the exact approval and confirms completion against Jellyfin.

`JELLYFIN_URL` and `JELLYFIN_API_KEY` configure read-only browsing and playback. Jellyfin never mutates the canonical library through Needle. beets owns files; Jellyfin reads them.

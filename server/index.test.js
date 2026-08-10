import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildApp, scanMediaRoot } from './index.ts'
import { AdapterError } from './integrations/errors.ts'

test('scanMediaRoot counts audio files and infers artist/album directories', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'needle-media-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  await mkdir(join(root, 'Artist One', 'Album One'), { recursive: true })
  await mkdir(join(root, 'Artist Two', 'Album Two'), { recursive: true })
  await writeFile(join(root, 'Artist One', 'Album One', '01 Track.flac'), '')
  await writeFile(join(root, 'Artist One', 'Album One', '02 Track.MP3'), '')
  await writeFile(join(root, 'Artist Two', 'Album Two', '01 Track.m4a'), '')
  await writeFile(join(root, 'Artist Two', 'Album Two', 'cover.jpg'), '')

  const result = await scanMediaRoot(root)

  assert.equal(result.configured, true)
  assert.equal(result.mounted, true)
  assert.deepEqual(result.media, {
    tracks: 3,
    albums: 2,
    artists: 2,
    formats: { FLAC: 1, M4A: 1, MP3: 1 },
  })
  assert.ok(result.capacity.totalBytes > 0)
  assert.ok(result.scannedAt)
})

test('scanMediaRoot reports unconfigured and missing roots without throwing', async () => {
  const unconfigured = await scanMediaRoot()
  const missing = await scanMediaRoot(join(tmpdir(), 'needle-path-that-does-not-exist'))

  assert.equal(unconfigured.configured, false)
  assert.equal(unconfigured.mounted, false)
  assert.equal(missing.configured, true)
  assert.equal(missing.mounted, false)
})

test('status API returns the device profile and filesystem state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'needle-api-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = buildApp({ walkmanPath: root, libraryPath: root, lidarr: null, logger: false })
  t.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/status' })
  const body = response.json()

  assert.equal(response.statusCode, 200)
  assert.deepEqual(body.device.profile, { manufacturer: 'Sony', model: 'NW-A55' })
  assert.equal(body.device.mounted, true)
  assert.equal(body.library.mounted, true)
})

test('library tracks API returns a stable paginated canonical inventory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'needle-library-api-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'Artist', 'Album'), { recursive: true })
  await writeFile(join(root, 'Artist', 'Album', '01 First.flac'), 'not real audio')
  await writeFile(join(root, 'Artist', 'Album', '02 Second.mp3'), 'not real audio')
  const app = buildApp({ libraryPath: root, lidarr: null, logger: false })
  t.after(() => app.close())

  const first = await app.inject({ method: 'GET', url: '/api/library/tracks?limit=1' })
  const second = await app.inject({ method: 'GET', url: `/api/library/tracks?limit=1&cursor=${first.json().nextCursor}` })

  assert.equal(first.statusCode, 200)
  assert.equal(first.json().configured, true)
  assert.equal(first.json().mounted, true)
  assert.equal(first.json().total, 2)
  assert.equal(first.json().items[0].relativePath, 'Artist/Album/01 First.flac')
  assert.equal(first.json().items[0].metadataStatus, 'unreadable')
  assert.equal(first.json().nextCursor, '1')
  assert.equal(second.json().items[0].relativePath, 'Artist/Album/02 Second.mp3')
  assert.equal(second.json().nextCursor, undefined)
})

test('library browser proxies read-only Jellyfin albums, tracks, and artwork', async (t) => {
  const albumId = 'a'.repeat(32)
  let albumQuery
  const jellyfin = {
    listAlbums: async (query) => {
      albumQuery = query
      return {
        items: [{ id: albumId, title: 'Tender Buttons', albumArtist: 'Broadcast', year: 2005, trackCount: 12, hasArtwork: true }],
        total: 1,
      }
    },
    listAlbumTracks: async () => ({
      items: [{ id: 'b'.repeat(32), title: 'I Found the F', artists: ['Broadcast'], trackNumber: 1, durationSeconds: 123 }],
      total: 1,
    }),
    listArtists: async () => ({ items: [{ name: 'Broadcast', albumCount: 1, representativeAlbumId: albumId }], total: 1 }),
    listTracks: async () => ({ items: [{ id: 'b'.repeat(32), title: 'I Found the F', artists: ['Broadcast'], albumId }], total: 1 }),
    getAlbumArtwork: async () => ({ contentType: 'image/jpeg', data: new TextEncoder().encode('artwork') }),
  }
  const app = buildApp({ jellyfin, lidarr: null, logger: false })
  t.after(() => app.close())

  const albums = await app.inject({ method: 'GET', url: '/api/library/albums?term=Broadcast' })
  const tracks = await app.inject({ method: 'GET', url: `/api/library/albums/${albumId}/tracks` })
  const artwork = await app.inject({ method: 'GET', url: `/api/library/albums/${albumId}/artwork` })
  const artists = await app.inject({ method: 'GET', url: '/api/library/artists?term=Broad' })
  const songs = await app.inject({ method: 'GET', url: '/api/library/songs?term=Found' })

  assert.equal(albums.json().configured, true)
  assert.equal(albums.json().items[0].title, 'Tender Buttons')
  assert.equal(albumQuery.term, 'Broadcast')
  assert.equal(tracks.json().items[0].title, 'I Found the F')
  assert.equal(artwork.headers['content-type'], 'image/jpeg')
  assert.equal(artwork.body, 'artwork')
  assert.deepEqual(artists.json(), { configured: true, mounted: true, scannedAt: null, total: 1,
    items: [{ name: 'Broadcast', albumCount: 1, representativeAlbumId: albumId }] })
  assert.equal(songs.json().items[0].albumId, albumId)
})

test('song stream API proxies full and ranged streaming responses and rejects malformed ranges', async (t) => {
  const songId = 'b'.repeat(32)
  const ranges = []
  const jellyfin = {
    getTrackAudio: async (_id, range) => {
      ranges.push(range)
      if (range === 'bytes=100-200') return { status: 416, contentRange: 'bytes */10', acceptRanges: 'bytes' }
      return {
        status: range ? 206 : 200,
        contentType: 'audio/flac',
        contentLength: range ? '4' : '10',
        ...(range ? { contentRange: 'bytes 2-5/10' } : {}),
        acceptRanges: 'bytes',
        body: new Response(range ? '2345' : '0123456789').body,
      }
    },
  }
  const app = buildApp({ jellyfin, lidarr: null, logger: false })
  t.after(() => app.close())

  const full = await app.inject({ method: 'GET', url: `/api/library/songs/${songId}/stream` })
  const partial = await app.inject({ method: 'GET', url: `/api/library/songs/${songId}/stream`, headers: { range: 'bytes=2-5' } })
  const unsatisfiable = await app.inject({ method: 'GET', url: `/api/library/songs/${songId}/stream`, headers: { range: 'bytes=100-200' } })
  const malformed = await app.inject({ method: 'GET', url: `/api/library/songs/${songId}/stream`, headers: { range: 'bytes=0-1,4-5' } })

  assert.equal(full.statusCode, 200)
  assert.equal(full.body, '0123456789')
  assert.equal(partial.statusCode, 206)
  assert.equal(partial.body, '2345')
  assert.equal(partial.headers['content-type'], 'audio/flac')
  assert.equal(partial.headers['content-range'], 'bytes 2-5/10')
  assert.equal(partial.headers['accept-ranges'], 'bytes')
  assert.equal(partial.headers['cache-control'], 'no-store')
  assert.equal(partial.headers['x-content-type-options'], 'nosniff')
  assert.equal(unsatisfiable.statusCode, 416)
  assert.equal(unsatisfiable.headers['content-range'], 'bytes */10')
  assert.equal(malformed.statusCode, 416)
  assert.deepEqual(ranges, [undefined, 'bytes=2-5', 'bytes=100-200'])
})

test('song stream API returns 404 when provider has no track', async (t) => {
  const app = buildApp({ jellyfin: { getTrackAudio: async () => null }, lidarr: null, logger: false })
  t.after(() => app.close())
  const response = await app.inject({ method: 'GET', url: `/api/library/songs/${'b'.repeat(32)}/stream` })
  assert.equal(response.statusCode, 404)
})

test('music search combines library, catalog, and wanted state by MusicBrainz identity', async (t) => {
  const musicBrainzReleaseGroupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const wanted = {
    id: 'wanted-1',
    state: 'wanted',
    artist: 'Broadcast',
    release: 'Tender Buttons',
    musicBrainzReleaseGroupId,
    searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:mbid:a' }],
    createdAt: '2026-08-09T00:00:00Z',
    updatedAt: '2026-08-09T00:00:00Z',
  }
  const acquisitionRepository = {
    list: () => [wanted],
    wantRelease: () => { throw new Error('not used') },
    getDefaults: () => null,
    setDefaults: defaults => defaults,
  }
  let libraryPages = 0
  const jellyfin = {
    listAlbums: async ({ cursor }) => {
      libraryPages += 1
      return cursor ? { items: [{
        id: 'a'.repeat(32),
        title: 'Tender Buttons',
        albumArtist: 'Broadcast',
        musicBrainzReleaseGroupId,
        hasArtwork: true,
      }], total: 1 } : { items: [], total: 1, nextCursor: '100' }
    },
    listAlbumTracks: async () => ({ items: [], total: 0 }),
    listArtists: async () => ({ items: [{ name: 'Broadcast', albumCount: 1 }], total: 1 }),
    listTracks: async () => ({ items: [{ id: 'b'.repeat(32), title: 'Echo', artists: ['Broadcast'] }], total: 1 }),
    getAlbumArtwork: async () => null,
  }
  const lidarr = {
    probe: async () => ({ adapterId: 'lidarr', kind: 'lidarr', state: 'available', checkedAt: '2026-08-09T00:00:00Z', latencyMs: 1 }),
    lookupArtists: async () => [],
    lookupReleases: async () => [
      {
        ref: { adapterId: 'lidarr', nativeId: 'album:mbid:a' },
        artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:b' },
        artistName: 'Broadcast',
        title: 'Tender Buttons',
        musicBrainzReleaseGroupId,
      },
      {
        ref: { adapterId: 'lidarr', nativeId: 'album:mbid:c' },
        artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:b' },
        artistName: 'Broadcast',
        title: 'Work and Non Work',
        musicBrainzReleaseGroupId: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee',
      },
    ],
    listQueue: async () => ({ items: [] }),
    listHistory: async () => ({ items: [] }),
  }
  const app = buildApp({ jellyfin, lidarr, acquisitionRepository, logger: false })
  t.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/music/releases?term=Broadcast' })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().sources, { library: 'available', artists: 'available', tracks: 'available', catalog: 'available', wanted: 'available' })
  assert.equal(response.json().items.length, 2)
  assert.equal(response.json().items[0].state, 'in-library')
  assert.equal(response.json().items[0].acquisition.id, 'wanted-1')
  assert.equal(response.json().items[1].state, 'can-request')
  assert.deepEqual(response.json().artists, [{ name: 'Broadcast', albumCount: 1 }])
  assert.equal(response.json().tracks[0].title, 'Echo')
  assert.equal(libraryPages, 2)
})

test('Lidarr API reports an unconfigured adapter without making a request', async (t) => {
  const app = buildApp({ lidarr: null, logger: false })
  t.after(() => app.close())

  const status = await app.inject({ method: 'GET', url: '/api/services/lidarr' })
  const artists = await app.inject({ method: 'GET', url: '/api/services/lidarr/artists?term=test' })

  assert.equal(status.statusCode, 200)
  assert.deepEqual(status.json(), { configured: false })
  assert.equal(artists.statusCode, 503)
  assert.equal(artists.json().error.code, 'unavailable')
})

test('journey detail uses exact identity, paginates safely, and makes an exact review handoff', async (t) => {
  const mbid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const job = { id: 'journey-1', state: 'wanted', artist: 'Right Artist', release: 'Same Title', musicBrainzReleaseGroupId: mbid,
    searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:id:9' }], createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }
  const release = (id, musicBrainzReleaseGroupId, title = 'Same Title') => ({ ref: { adapterId: 'lidarr', nativeId: `album:id:${id}` },
    artistRef: { adapterId: 'lidarr', nativeId: 'artist:id:1' }, title, musicBrainzReleaseGroupId })
  const queueCursors = []
  const historyCursors = []
  const lidarr = {
    listQueue: async ({ cursor }) => {
      queueCursors.push(cursor)
      if (!cursor) return { items: [{ ref: { adapterId: 'lidarr', nativeId: 'queue:id:1' }, title: 'Same Title', state: 'downloading', rawState: 'downloading',
        release: release(9, mbid.toUpperCase()), bytesTotal: 100, bytesRemaining: 25, output: { providerPath: '/data/Album', needlePath: '/inbox/Album/' }, statusMessages: [] }], nextCursor: 'page-2' }
      return { items: [{ ref: { adapterId: 'lidarr', nativeId: 'queue:id:2' }, title: 'Same Title', state: 'failed', rawState: 'failed',
        release: release(10, 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee'), statusMessages: [] }], nextCursor: 'page-2' }
    },
    listHistory: async (since, { cursor }) => {
      assert.equal(since, job.createdAt)
      historyCursors.push(cursor)
      if (!cursor) return { items: [
        { ref: { adapterId: 'lidarr', nativeId: 'history:id:1' }, eventType: 'grabbed', occurredAt: '2026-08-02T00:00:00Z', release: release(99, undefined, 'Same Title'), data: {} },
        { ref: { adapterId: 'lidarr', nativeId: 'history:id:2' }, eventType: 'downloadFolderImported', occurredAt: '2026-08-03T00:00:00Z', release: release(9, mbid), output: { providerPath: '/data/Album', needlePath: '/inbox/Album' }, data: {} },
        { ref: { adapterId: 'lidarr', nativeId: 'history:id:3' }, eventType: 'downloadFailed', occurredAt: '2026-08-04T00:00:00Z', release: release(11, 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee'), data: {} },
        { ref: { adapterId: 'lidarr', nativeId: 'history:id:4' }, eventType: 'renamedTrack', occurredAt: '2026-08-05T00:00:00Z', release: release(9, mbid), data: {} },
      ], nextCursor: 'history-2' }
      return { items: [], nextCursor: 'history-2' }
    },
  }
  const beets = { listFolders: async () => [{ name: 'Album', providerPath: '/inbox/Album', hash: 'hash', album: true, type: 'directory', children: [] }] }
  const repository = { list: () => [job], get: id => id === job.id ? job : null, wantRelease: () => { throw new Error('unused') },
    getDefaults: () => null, setDefaults: value => value, listBeetsImportOperations: () => [] }
  const app = buildApp({ lidarr, beets, acquisitionRepository: repository, logger: false })
  t.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/journeys/journey-1' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().stage, 'review')
  assert.deepEqual(response.json().progress, { percent: 75, bytesTotal: 100, bytesRemaining: 25 })
  assert.deepEqual(response.json().events.map(event => event.kind), ['downloadFolderImported', 'journey-created'])
  assert.equal(response.json().nextAction.folder.providerPath, '/inbox/Album')
  assert.deepEqual(queueCursors, [undefined, 'page-2'])
  assert.deepEqual(historyCursors, [undefined, 'history-2'])
})

test('journey review handoff requires a mapped authoritative completed-download path', async () => {
  const job = { id: 'j', state: 'wanted', release: 'Album', searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:id:9' }],
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }
  const release = { ref: job.searchRefs[0], artistRef: { adapterId: 'lidarr', nativeId: 'artist:id:1' }, title: 'Album' }
  const repository = { list: () => [job], get: () => job, wantRelease: () => {}, getDefaults: () => null,
    setDefaults: value => value, listBeetsImportOperations: () => [] }
  const cases = [
    {
      queue: [{ ref: { adapterId: 'lidarr', nativeId: 'queue:id:1' }, title: 'Album', state: 'completed', rawState: 'completed', release,
        output: { providerPath: '/data/Album', needlePath: '/inbox/Album' }, statusMessages: [] }],
      history: [], folderPath: '/inbox/Album', expectedStage: 'review',
    },
    {
      queue: [],
      history: [{ ref: { adapterId: 'lidarr', nativeId: 'history:id:1' }, eventType: 'downloadFolderImported', occurredAt: '2026-08-03T00:00:00Z',
        release, output: { providerPath: '/inbox/Album' }, data: {} }],
      folderPath: '/inbox/Album', expectedStage: 'review',
    },
    {
      queue: [],
      history: [
        { ref: { adapterId: 'lidarr', nativeId: 'history:id:1' }, eventType: 'downloadFolderImported', occurredAt: '2026-08-03T00:00:00Z', release, data: {} },
        { ref: { adapterId: 'lidarr', nativeId: 'history:id:2' }, eventType: 'downloadFailed', occurredAt: '2026-08-02T00:00:00Z', release,
          output: { providerPath: '/data/Wrong', needlePath: '/inbox/Wrong' }, data: {} },
      ],
      folderPath: '/inbox/Wrong', expectedStage: 'review',
    },
  ]
  for (const scenario of cases) {
    const lidarr = { listQueue: async () => ({ items: scenario.queue }), listHistory: async () => ({ items: scenario.history }) }
    const beets = { listFolders: async () => [{ name: 'Album', providerPath: scenario.folderPath, hash: 'h', album: true, type: 'directory', children: [] }] }
    const app = buildApp({ lidarr, beets, acquisitionRepository: repository, logger: false })
    const body = (await app.inject({ method: 'GET', url: '/api/journeys/j' })).json()
    assert.equal(body.stage, scenario.expectedStage)
    assert.equal(body.nextAction, undefined)
    await app.close()
  }
})

test('journey review handoff follows an exact Lidarr download reference when completed download handling is disabled', async (t) => {
  const job = { id: 'j', state: 'wanted', release: 'Album', searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:id:9' }],
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }
  const release = { ref: job.searchRefs[0], artistRef: { adapterId: 'lidarr', nativeId: 'artist:id:1' }, title: 'Album' }
  let queue = [{ ref: { adapterId: 'lidarr', nativeId: 'queue:id:1' }, underlyingDownloadRef: 'download-123', title: 'Album',
    state: 'downloading', rawState: 'downloading', release, statusMessages: [] }]
  let history = [
    { ref: { adapterId: 'lidarr', nativeId: 'history:id:1' }, eventType: 'grabbed', occurredAt: job.createdAt,
      release, underlyingDownloadRef: 'download-123', data: {} },
  ]
  const lidarr = { listQueue: async () => ({ items: queue }), listHistory: async () => ({ items: history }) }
  const folder = { name: 'Album', providerPath: '/inbox/lidarr/download-123/Artist - Album', hash: 'h', album: true, type: 'directory', children: [] }
  const beets = { listFolders: async () => [
    { name: 'Different Album', providerPath: '/inbox/Artist - Album', hash: 'other', album: true, type: 'directory', children: [] },
    folder,
  ] }
  const repository = { list: () => [job], get: () => job, wantRelease: () => {}, getDefaults: () => null,
    setDefaults: value => value, listBeetsImportOperations: () => [] }
  const app = buildApp({ lidarr, beets, acquisitionRepository: repository, logger: false })
  t.after(() => app.close())

  const downloading = (await app.inject({ method: 'GET', url: '/api/journeys/j' })).json()
  assert.equal(downloading.stage, 'downloading')
  assert.equal(downloading.nextAction, undefined)

  queue = []
  const body = (await app.inject({ method: 'GET', url: '/api/journeys/j' })).json()
  assert.equal(body.stage, 'review')
  assert.deepEqual(body.nextAction, { kind: 'review', folder })

  history = [{ ref: { adapterId: 'lidarr', nativeId: 'history:id:2' }, eventType: 'downloadFailed', occurredAt: '2026-08-01T00:01:00Z',
    release, underlyingDownloadRef: 'download-123', data: {} }, ...history]
  const failed = (await app.inject({ method: 'GET', url: '/api/journeys/j' })).json()
  assert.equal(failed.stage, 'attention')
  assert.equal(failed.nextAction, undefined)

  history.push({ ref: { adapterId: 'lidarr', nativeId: 'history:id:3' }, eventType: 'downloadFolderImported', occurredAt: job.createdAt,
    release, underlyingDownloadRef: 'download-123', output: { providerPath: '/downloads/Album', needlePath: folder.providerPath }, data: {} })
  const failedAfterOutput = (await app.inject({ method: 'GET', url: '/api/journeys/j' })).json()
  assert.equal(failedAfterOutput.stage, 'attention')
  assert.equal(failedAfterOutput.nextAction, undefined)
})

test('journey detail omits fuzzy and ambiguous folder matches and durable import state wins', async (t) => {
  const job = { id: 'j', state: 'wanted', release: 'Album', searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:id:9' }], createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }
  const operation = { id: 'op', sessionId: 's', providerPath: '/inbox/Album', hash: 'h', state: 'library-confirmed', selections: [], acquisitionId: 'j', libraryAlbumIds: ['library-1'], createdAt: job.createdAt, updatedAt: job.updatedAt }
  const release = { ref: job.searchRefs[0], artistRef: { adapterId: 'lidarr', nativeId: 'artist:id:1' }, title: 'Album' }
  const lidarr = { listQueue: async () => ({ items: [] }), listHistory: async () => ({ items: [{ ref: { adapterId: 'lidarr', nativeId: 'history:id:1' }, eventType: 'downloadFailed', occurredAt: job.createdAt, release, output: { providerPath: '/data/Album', needlePath: '/inbox/Artist/Album' }, data: {} }] }) }
  const beets = { listFolders: async () => [{ name: 'Album', providerPath: '/other/Album', hash: 'h', album: true, type: 'directory', children: [] }] }
  const repository = { list: () => [job], get: () => job, wantRelease: () => {}, getDefaults: () => null, setDefaults: value => value, listBeetsImportOperations: () => [operation] }
  const app = buildApp({ lidarr, beets, acquisitionRepository: repository, logger: false })
  t.after(() => app.close())
  const body = (await app.inject({ method: 'GET', url: '/api/journeys/j' })).json()
  assert.equal(body.stage, 'collected')
  assert.equal(body.nextAction, undefined)
  assert.deepEqual(body.libraryAlbumIds, ['library-1'])
})

test('beets read routes expose normalized items and truthful unconfigured errors', async (t) => {
  const unconfigured = buildApp({ beets: null, lidarr: null, jellyfin: null, logger: false })
  t.after(() => unconfigured.close())
  assert.deepEqual((await unconfigured.inject({ method: 'GET', url: '/api/services/beets' })).json(), { configured: false })
  const missing = await unconfigured.inject({ method: 'GET', url: '/api/imports/inboxes' })
  assert.equal(missing.statusCode, 503)
  assert.deepEqual(missing.json().error, { code: 'unavailable', adapterId: 'beets', message: 'beets-flask is not configured', retryable: false })

  const beets = {
    adapterId: 'beets', kind: 'beets',
    probe: async () => ({ adapterId: 'beets', kind: 'beets', state: 'available', checkedAt: '2026-08-09T00:00:00Z', latencyMs: 2, version: '2.3.1', apiVersion: 'v1' }),
    listInboxes: async () => [{ name: 'Inbox', providerPath: '/inbox', taggedCount: 1, importedCount: 0, bytes: 12, fileCount: 2 }],
    listFolders: async () => [{ name: 'Inbox', providerPath: '/inbox', hash: 'abc', album: false, type: 'directory', children: [] }],
    listFolderStatuses: async () => [{ providerPath: '/inbox/Album', hash: 'def', status: 'previewed' }],
  }
  const app = buildApp({ beets, lidarr: null, jellyfin: null, logger: false })
  t.after(() => app.close())
  assert.equal((await app.inject({ method: 'GET', url: '/api/services/beets' })).json().health.version, '2.3.1')
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/imports/inboxes' })).json(), { items: await beets.listInboxes() })
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/imports/folders' })).json(), { items: await beets.listFolders() })
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/imports/status' })).json(), { items: await beets.listFolderStatuses() })
})

test('beets workflow gates mutations on the current album tree and validated choices', async (t) => {
  const calls = []
  const operations = []
  let libraryAlbums = []
  let libraryRefreshes = 0
  let failLibraryRefresh = false
  let loseSubmissionCas = false
  let throwSubmissionCas = false
  const linkedAcquisition = { id: 'wanted-1', state: 'wanted', artist: 'Artist', release: 'Album', searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:1' }], createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z' }
  const folder = { name: 'Album', providerPath: '/inbox/Album', hash: 'album-hash', album: true, type: 'directory', children: [] }
  const session = {
    id: 'session-1', providerPath: folder.providerPath, hash: folder.hash, progress: 20,
    tasks: [{
      id: 'task-1', currentMetadata: { artist: 'Artist', album: 'Album' }, items: [{ title: 'Track' }],
      candidates: [{ id: 'candidate-1', kind: 'candidate', artist: 'Artist', album: 'Album', distance: 0.1, penalties: [], trackCount: 1, duplicateCount: 0 }],
    }],
  }
  const beets = {
    adapterId: 'beets', kind: 'beets',
    probe: async () => ({ adapterId: 'beets', kind: 'beets', state: 'available', checkedAt: '2026-08-09T00:00:00Z', latencyMs: 2 }),
    listInboxes: async () => [], listFolders: async () => [folder], listFolderStatuses: async () => [],
    getPreview: async () => session,
    enqueuePreview: async (target, context) => { calls.push(['preview', target]); return { jobId: 'preview-job', kind: 'preview', ...target, operationId: context.operationId } },
    enqueueImport: async (request, context) => { calls.push(['import', request]); return { jobId: 'import-job', kind: 'import_candidate', providerPath: request.providerPath, hash: request.hash, operationId: context.operationId } },
  }
  const acquisitionRepository = {
    list: () => [linkedAcquisition], get: id => id === linkedAcquisition.id ? linkedAcquisition : null,
    wantRelease: () => { throw new Error('not used') }, getDefaults: () => null, setDefaults: defaults => defaults,
    createBeetsImportOperation: input => {
      const existing = operations.find(item => item.sessionId === input.sessionId)
      if (existing) return { operation: existing, created: false }
      const operation = { id: `import-operation-${operations.length + 1}`, ...input, state: 'submitting', libraryAlbumIds: [], createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z' }
      operations.push(operation)
      if (input.acquisitionId) Object.assign(linkedAcquisition, { state: 'importing', importRef: { adapterId: 'beets-import', nativeId: operation.id } })
      return { operation, created: true }
    },
    getBeetsImportOperation: id => operations.find(item => item.id === id) ?? null,
    listBeetsImportOperations: () => operations,
    abortBeetsImportOperation: id => {
      const index = operations.findIndex(item => item.id === id && item.state === 'submitting')
      if (index < 0) return false
      const [operation] = operations.splice(index, 1)
      if (operation.acquisitionId) Object.assign(linkedAcquisition, { state: 'wanted', importRef: undefined })
      return true
    },
    transitionBeetsImportOperation: (id, expectedState, state, update = {}) => {
      const operation = operations.find(item => item.id === id)
      if (!operation) return null
      if (operation.state !== expectedState) return operation
      if (throwSubmissionCas && expectedState === 'submitting' && state === 'submitted') {
        throwSubmissionCas = false
        throw new Error('database write failed')
      }
      if (loseSubmissionCas && expectedState === 'submitting' && state === 'submitted') {
        operation.state = 'submission-unknown'
        return operation
      }
      Object.assign(operation, { state, updatedAt: '2026-08-09T00:01:00.000Z' }, update)
      if (operation.acquisitionId && state === 'submission-unknown') linkedAcquisition.state = 'selection-required'
      if (operation.acquisitionId && state === 'library-confirmed') linkedAcquisition.state = 'completed'
      return operation
    },
  }
  const jellyfin = {
    refreshLibrary: async () => {
      libraryRefreshes += 1
      if (failLibraryRefresh) {
        failLibraryRefresh = false
        throw new AdapterError({ code: 'unavailable', adapterId: 'jellyfin', message: 'offline', retryable: true })
      }
    },
    listAlbums: async () => ({ items: libraryAlbums, total: libraryAlbums.length }),
    listAlbumTracks: async albumId => ({ items: albumId === 'album-1' || albumId === 'album-2' ? [{ id: `track-${albumId}`, title: 'Track', artists: ['Artist'] }] : [], total: 1 }),
    getAlbumArtwork: async () => null,
  }
  const app = buildApp({ beets, lidarr: null, jellyfin, acquisitionRepository, logger: false })
  t.after(() => app.close())

  const crossOrigin = await app.inject({ method: 'POST', url: '/api/imports/preview', headers: { origin: 'https://evil.example' }, payload: { providerPath: folder.providerPath, hash: folder.hash } })
  assert.equal(crossOrigin.statusCode, 403)
  assert.equal(calls.length, 0)

  const stale = await app.inject({ method: 'POST', url: '/api/imports/preview', payload: { providerPath: folder.providerPath, hash: 'stale-hash' } })
  assert.equal(stale.statusCode, 409)
  assert.equal(calls.length, 0)

  const preview = await app.inject({ method: 'POST', url: '/api/imports/preview', payload: { providerPath: folder.providerPath, hash: folder.hash } })
  assert.equal(preview.statusCode, 202)
  assert.equal(preview.json().jobId, 'preview-job')
  const duplicatePreview = await app.inject({ method: 'POST', url: '/api/imports/preview', payload: { providerPath: folder.providerPath, hash: folder.hash } })
  assert.equal(duplicatePreview.statusCode, 409)

  const review = await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  assert.equal(review.statusCode, 200)
  assert.deepEqual(review.json(), session)

  const missingDecision = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'skip' }] } })
  assert.equal(missingDecision.statusCode, 400)
  const missingAcquisition = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: 'missing', providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'skip' }] } })
  assert.equal(missingAcquisition.statusCode, 409)

  const invalidChoice = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'unknown', duplicateAction: 'skip' }] } })
  assert.equal(invalidChoice.statusCode, 409)

  const dangerousPolicy = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'remove' }] } })
  assert.equal(dangerousPolicy.statusCode, 400)

  const imported = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: linkedAcquisition.id, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'keep' }] } })
  assert.equal(imported.statusCode, 202)
  assert.equal(imported.json().jobId, 'import-job')
  assert.equal(imported.json().importOperationId, 'import-operation-1')
  assert.equal(operations[0].acquisitionId, linkedAcquisition.id)
  assert.equal(linkedAcquisition.state, 'importing')
  assert.deepEqual(operations[0].selections, [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'keep', artist: 'Artist', album: 'Album', trackCount: 1 }])
  assert.equal(operations[0].state, 'submitted')
  const duplicateImport = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'keep' }] } })
  assert.equal(duplicateImport.statusCode, 409)

  session.progress = 40
  session.tasks[0].chosenCandidateId = 'candidate-1'
  session.tasks.push({ id: 'unapproved-task', chosenCandidateId: 'other-candidate', currentMetadata: {}, items: [], candidates: [] })
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })).json().state, 'submitted')
  session.tasks.pop()
  failLibraryRefresh = true
  const refreshFailure = await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })
  assert.equal(refreshFailure.statusCode, 502)
  assert.equal(operations[0].state, 'submitted')
  const providerCompleted = await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })
  assert.equal(providerCompleted.json().state, 'provider-completed')
  assert.equal(libraryRefreshes, 2)
  libraryAlbums = [
    { id: 'album-1', title: 'Album', albumArtist: 'Artist', trackCount: 1, hasArtwork: false },
    { id: 'album-2', title: 'Album', albumArtist: 'Artist', trackCount: 1, hasArtwork: false },
  ]
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })).json().state, 'provider-completed')
  assert.equal(libraryRefreshes, 2)
  libraryAlbums = libraryAlbums.slice(0, 1)
  const confirmed = await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })
  assert.equal(confirmed.json().state, 'library-confirmed')
  assert.deepEqual(confirmed.json().libraryAlbumIds, ['album-1'])
  assert.equal(linkedAcquisition.state, 'completed')
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/imports/operations' })).json(), { configured: true, items: operations })

  session.id = 'session-2'
  session.progress = 20
  delete session.tasks[0].chosenCandidateId
  await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  beets.enqueueImport = async () => { throw new Error('unexpected provider failure') }
  const failedSubmission = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'skip' }] } })
  assert.equal(failedSubmission.statusCode, 503)
  assert.equal(failedSubmission.json().error.providerCode, 'outcome-unknown')
  assert.equal(operations[1].state, 'submission-unknown')

  session.id = 'session-3'
  await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  beets.enqueueImport = async (request, context) => ({ jobId: 'accepted-but-not-persisted', kind: 'import_candidate', providerPath: request.providerPath, hash: request.hash, operationId: context.operationId })
  loseSubmissionCas = true
  const lostDurability = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'skip' }] } })
  assert.equal(lostDurability.statusCode, 503)
  assert.equal(lostDurability.json().error.providerCode, 'outcome-unknown')
  assert.equal(operations[2].state, 'submission-unknown')

  loseSubmissionCas = false
  session.id = 'session-4'
  await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  beets.enqueueImport = async () => { throw new AdapterError({ code: 'invalid-request', adapterId: 'beets', message: 'Rejected before enqueue', retryable: false, providerStatus: 400 }) }
  const rejected = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'skip' }] } })
  assert.equal(rejected.statusCode, 400)
  assert.equal(operations.some(item => item.sessionId === session.id), false)
  beets.enqueueImport = async (request, context) => ({ jobId: 'retry-job', kind: 'import_candidate', providerPath: request.providerPath, hash: request.hash, operationId: context.operationId })
  await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'skip' }] } })).statusCode, 202)

  session.id = 'session-5'
  throwSubmissionCas = true
  await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  const failedDurabilityWrite = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'skip' }] } })
  assert.equal(failedDurabilityWrite.statusCode, 503)
  assert.equal(failedDurabilityWrite.json().error.providerCode, 'outcome-unknown')
  assert.equal(operations.find(item => item.sessionId === session.id)?.state, 'submission-unknown')
  assert.deepEqual(calls.map(([kind]) => kind), ['preview', 'import'])
})

test('acquisition API persists wanted state and starts one exact Lidarr album search', async (t) => {
  const calls = []
  const jobs = []
  const defaults = {
    root: { adapterId: 'lidarr', nativeId: 'root:id:1' },
    qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' },
  }
  const acquisitionRepository = {
    list: () => jobs,
    getDefaults: () => defaults,
    setDefaults: (value) => value,
    wantRelease: (release) => {
      calls.push(['persist', release])
      const job = {
        id: 'job-1',
        state: 'wanted',
        artist: release.artistName,
        release: release.title,
        searchRefs: [release.ref],
        createdAt: '2026-08-08T00:00:00Z',
        updatedAt: '2026-08-08T00:00:00Z',
      }
      jobs.push(job)
      return { job, created: true }
    },
  }
  const installedRef = { adapterId: 'lidarr', nativeId: 'album:id:42' }
  const lidarr = {
    adapterId: 'lidarr',
    ensureRelease: async (request) => {
      calls.push(['ensure', request])
      return { ...request.release, ref: installedRef }
    },
    setReleaseWanted: async (ref, wanted) => { calls.push(['monitor', ref, wanted]) },
    startSearch: async (target) => {
      calls.push(['search', target])
      return { ref: { adapterId: 'lidarr', nativeId: 'command:id:9' }, kind: 'search-release', state: 'queued', rawState: 'queued' }
    },
  }
  const app = buildApp({ acquisitionRepository, lidarr, logger: false })
  t.after(() => app.close())

  const create = await app.inject({
    method: 'POST',
    url: '/api/acquisitions',
    payload: {
      release: {
        ref: { adapterId: 'lidarr', nativeId: 'album:id:42' },
        artistRef: { adapterId: 'lidarr', nativeId: 'artist:id:7' },
        artistName: 'Broadcast',
        title: 'Tender Buttons',
        musicBrainzReleaseGroupId: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
      },
    },
  })
  const list = await app.inject({ method: 'GET', url: '/api/acquisitions' })

  assert.equal(create.statusCode, 201)
  assert.equal(create.json().state, 'wanted')
  assert.equal(list.statusCode, 200)
  assert.equal(list.json().configured, true)
  assert.deepEqual(list.json().items, [create.json()])
  assert.deepEqual(calls.map(([kind]) => kind), ['persist', 'ensure', 'monitor', 'search'])
  assert.deepEqual(calls[0][1].ref, { adapterId: 'lidarr', nativeId: 'album:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
  assert.equal(calls[0][1].musicBrainzReleaseGroupId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  assert.deepEqual(calls[1][1], { release: calls[0][1], ...defaults })
  assert.deepEqual(calls[2].slice(1), [installedRef, true])
  assert.deepEqual(calls[3][1], { kind: 'release', release: installedRef })
})

test('acquisition API requires defaults before persisting or calling Lidarr', async (t) => {
  let persisted = false
  let called = false
  const acquisitionRepository = {
    list: () => [],
    getDefaults: () => null,
    setDefaults: (value) => value,
    wantRelease: () => { persisted = true; throw new Error('unexpected persistence') },
  }
  const lidarr = { adapterId: 'lidarr', ensureRelease: async () => { called = true } }
  const app = buildApp({ acquisitionRepository, lidarr, logger: false })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/acquisitions', payload: { release: {
    ref: { adapterId: 'lidarr', nativeId: 'album:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' },
    title: 'Tender Buttons',
    musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  } } })

  assert.equal(response.statusCode, 400)
  assert.equal(persisted, false)
  assert.equal(called, false)
})

test('acquisition API retains wanted intent and retries a failed Lidarr handoff', async (t) => {
  const releaseGroupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const job = {
    id: 'retry-job', state: 'wanted', release: 'Tender Buttons', musicBrainzReleaseGroupId: releaseGroupId,
    searchRefs: [{ adapterId: 'lidarr', nativeId: `album:mbid:${releaseGroupId}` }],
    createdAt: '2026-08-08T00:00:00Z', updatedAt: '2026-08-08T00:00:00Z',
  }
  let writes = 0
  let ensureAttempts = 0
  let monitored = 0
  let searched = 0
  const acquisitionRepository = {
    list: () => [job],
    getDefaults: () => ({
      root: { adapterId: 'lidarr', nativeId: 'root:id:1' },
      qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' },
    }),
    setDefaults: (value) => value,
    wantRelease: () => ({ job, created: ++writes === 1 }),
  }
  const installedRef = { adapterId: 'lidarr', nativeId: 'album:id:42' }
  const lidarr = {
    adapterId: 'lidarr',
    ensureRelease: async (request) => {
      ensureAttempts += 1
      if (ensureAttempts === 1) throw new AdapterError({ code: 'unavailable', adapterId: 'lidarr', message: 'offline', retryable: true })
      return { ...request.release, ref: installedRef }
    },
    setReleaseWanted: async () => { monitored += 1 },
    startSearch: async () => {
      searched += 1
      return { ref: { adapterId: 'lidarr', nativeId: 'command:id:9' }, kind: 'search-release', state: 'queued', rawState: 'queued' }
    },
  }
  const app = buildApp({ acquisitionRepository, lidarr, logger: false })
  t.after(() => app.close())
  const payload = { release: {
    ref: { adapterId: 'lidarr', nativeId: `album:mbid:${releaseGroupId}` },
    artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' },
    title: 'Tender Buttons',
    musicBrainzReleaseGroupId: releaseGroupId,
  } }

  const failed = await app.inject({ method: 'POST', url: '/api/acquisitions', payload })
  const retried = await app.inject({ method: 'POST', url: '/api/acquisitions', payload })

  assert.equal(failed.statusCode, 502)
  assert.equal(retried.statusCode, 200)
  assert.equal(writes, 2)
  assert.equal(ensureAttempts, 2)
  assert.equal(monitored, 1)
  assert.equal(searched, 1)
})

test('acquisition API does not restart a journey that has moved beyond wanted', async (t) => {
  let providerCalls = 0
  const job = {
    id: 'importing-job', state: 'importing', release: 'Tender Buttons',
    musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }],
    createdAt: '2026-08-08T00:00:00Z', updatedAt: '2026-08-08T00:00:00Z',
  }
  const acquisitionRepository = {
    list: () => [job],
    getDefaults: () => ({
      root: { adapterId: 'lidarr', nativeId: 'root:id:1' },
      qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' },
    }),
    setDefaults: (value) => value,
    wantRelease: () => ({ job, created: false }),
  }
  const lidarr = { adapterId: 'lidarr', ensureRelease: async () => { providerCalls += 1 } }
  const app = buildApp({ acquisitionRepository, lidarr, logger: false })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/acquisitions', payload: { release: {
    ref: { adapterId: 'lidarr', nativeId: 'album:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' },
    title: 'Tender Buttons',
    musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  } } })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().state, 'importing')
  assert.equal(providerCalls, 0)
})

test('acquisition API reports unconfigured state and rejects writes', async (t) => {
  const app = buildApp({ acquisitionRepository: null, lidarr: null, logger: false })
  t.after(() => app.close())

  const list = await app.inject({ method: 'GET', url: '/api/acquisitions' })
  const create = await app.inject({
    method: 'POST',
    url: '/api/acquisitions',
    payload: {
      release: {
        ref: { adapterId: 'lidarr', nativeId: 'album:id:42' },
        artistRef: { adapterId: 'lidarr', nativeId: 'artist:id:7' },
        title: 'Tender Buttons',
      },
    },
  })
  const defaults = await app.inject({
    method: 'PUT',
    url: '/api/acquisition-defaults',
    payload: {
      root: { adapterId: 'lidarr', nativeId: 'root:id:1' },
      qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' },
    },
  })

  assert.deepEqual(list.json(), { configured: false, items: [] })
  assert.equal(create.statusCode, 503)
  assert.equal(create.json().error.code, 'unavailable')
  assert.equal(defaults.statusCode, 503)
  assert.equal(defaults.json().error.code, 'unavailable')
})

test('acquisition defaults API persists explicit provider references', async (t) => {
  let saved = null
  const acquisitionRepository = {
    list: () => [],
    wantRelease: () => { throw new Error('not used') },
    getDefaults: () => saved,
    setDefaults: (defaults) => { saved = defaults; return defaults },
  }
  const lidarr = {
    listRoots: async () => [{ ref: { adapterId: 'lidarr', nativeId: 'root:id:1' }, path: { providerPath: '/staging' } }],
    listProfiles: async () => [
      { ref: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' }, name: 'Lossless', kind: 'quality' },
      { ref: { adapterId: 'lidarr', nativeId: 'profile:metadata:id:3' }, name: 'Standard', kind: 'metadata' },
    ],
  }
  const app = buildApp({ acquisitionRepository, lidarr, logger: false })
  t.after(() => app.close())
  const defaults = {
    root: { adapterId: 'lidarr', nativeId: 'root:id:1' },
    qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' },
    metadataProfile: { adapterId: 'lidarr', nativeId: 'profile:metadata:id:3' },
  }

  const before = await app.inject({ method: 'GET', url: '/api/acquisition-defaults' })
  const update = await app.inject({ method: 'PUT', url: '/api/acquisition-defaults', payload: defaults })
  const after = await app.inject({ method: 'GET', url: '/api/acquisition-defaults' })

  assert.deepEqual(before.json(), { value: null })
  assert.deepEqual(update.json(), { value: defaults })
  assert.deepEqual(after.json(), { value: defaults })
})

test('acquisition defaults API rejects references Lidarr does not expose', async (t) => {
  let writes = 0
  const acquisitionRepository = {
    list: () => [],
    wantRelease: () => { throw new Error('not used') },
    getDefaults: () => null,
    setDefaults: (defaults) => { writes += 1; return defaults },
  }
  const lidarr = {
    listRoots: async () => [{ ref: { adapterId: 'lidarr', nativeId: 'root:id:1' }, path: { providerPath: '/staging' } }],
    listProfiles: async () => [
      { ref: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' }, name: 'Lossless', kind: 'quality' },
    ],
  }
  const app = buildApp({ acquisitionRepository, lidarr, logger: false })
  t.after(() => app.close())

  const response = await app.inject({
    method: 'PUT',
    url: '/api/acquisition-defaults',
    payload: {
      root: { adapterId: 'lidarr', nativeId: 'root:id:999' },
      qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' },
    },
  })

  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error.code, 'invalid-request')
  assert.equal(writes, 0)
})

test('Lidarr read routes validate queries and return normalized adapter data', async (t) => {
  const calls = []
  const lidarr = {
    probe: async () => ({ adapterId: 'lidarr', kind: 'lidarr', state: 'available', checkedAt: '2026-08-08T00:00:00Z', latencyMs: 4, version: '2.14.3' }),
    lookupArtists: async (term) => {
      calls.push(['artists', term])
      return [{ ref: { adapterId: 'lidarr', nativeId: 'artist:mbid:one' }, name: 'Nujabes' }]
    },
    lookupReleases: async (term) => {
      calls.push(['releases', term])
      return [{ ref: { adapterId: 'lidarr', nativeId: 'album:mbid:two' }, artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:one' }, artistName: 'Nujabes', title: 'Modal Soul' }]
    },
    listQueue: async () => ({ items: [], nextCursor: undefined }),
    listHistory: async () => ({ items: [], nextCursor: undefined }),
  }
  const app = buildApp({ lidarr, logger: false })
  t.after(() => app.close())

  const status = await app.inject({ method: 'GET', url: '/api/services/lidarr' })
  const artists = await app.inject({ method: 'GET', url: '/api/services/lidarr/artists?term=Nujabes' })
  const releases = await app.inject({ method: 'GET', url: '/api/services/lidarr/releases?term=Modal%20Soul' })
  const missingTerm = await app.inject({ method: 'GET', url: '/api/services/lidarr/artists' })
  const invalidLimit = await app.inject({ method: 'GET', url: '/api/services/lidarr/queue?limit=101' })

  assert.equal(status.statusCode, 200)
  assert.equal(status.json().health.version, '2.14.3')
  assert.equal(artists.json()[0].name, 'Nujabes')
  assert.equal(releases.json()[0].artistName, 'Nujabes')
  assert.deepEqual(calls, [['artists', 'Nujabes'], ['releases', 'Modal Soul']])
  assert.equal(missingTerm.statusCode, 400)
  assert.equal(invalidLimit.statusCode, 400)
})

test('production app serves static assets and preserves API 404 responses', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'needle-static-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<main>Needle runtime</main>')
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("needle")')
  const app = buildApp({ staticRoot: root, lidarr: null, logger: false })
  t.after(() => app.close())

  const rootResponse = await app.inject({ method: 'GET', url: '/' })
  const assetResponse = await app.inject({ method: 'GET', url: '/assets/app.js' })
  const clientRoute = await app.inject({ method: 'GET', url: '/acquire' })
  const missingApi = await app.inject({ method: 'GET', url: '/api/does-not-exist' })

  assert.equal(rootResponse.statusCode, 200)
  assert.match(rootResponse.body, /Needle runtime/)
  assert.equal(assetResponse.statusCode, 200)
  assert.match(assetResponse.body, /console\.log/)
  assert.equal(clientRoute.statusCode, 200)
  assert.match(clientRoute.body, /Needle runtime/)
  assert.equal(missingApi.statusCode, 404)
  assert.equal(missingApi.json().error.code, 'not-found')
})

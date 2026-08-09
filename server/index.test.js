import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildApp, scanMediaRoot } from './index.ts'

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
    getAlbumArtwork: async () => ({ contentType: 'image/jpeg', data: new TextEncoder().encode('artwork') }),
  }
  const app = buildApp({ jellyfin, lidarr: null, logger: false })
  t.after(() => app.close())

  const albums = await app.inject({ method: 'GET', url: '/api/library/albums?term=Broadcast' })
  const tracks = await app.inject({ method: 'GET', url: `/api/library/albums/${albumId}/tracks` })
  const artwork = await app.inject({ method: 'GET', url: `/api/library/albums/${albumId}/artwork` })

  assert.equal(albums.json().configured, true)
  assert.equal(albums.json().items[0].title, 'Tender Buttons')
  assert.equal(albumQuery.term, 'Broadcast')
  assert.equal(tracks.json().items[0].title, 'I Found the F')
  assert.equal(artwork.headers['content-type'], 'image/jpeg')
  assert.equal(artwork.body, 'artwork')
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
  assert.deepEqual(response.json().sources, { library: 'available', catalog: 'available', wanted: 'available' })
  assert.equal(response.json().items.length, 2)
  assert.equal(response.json().items[0].state, 'in-library')
  assert.equal(response.json().items[0].acquisition.id, 'wanted-1')
  assert.equal(response.json().items[1].state, 'can-request')
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

test('acquisition API records Needle-owned wanted state without calling Lidarr', async (t) => {
  const calls = []
  const jobs = []
  const acquisitionRepository = {
    list: () => jobs,
    getDefaults: () => null,
    setDefaults: (defaults) => defaults,
    wantRelease: (release) => {
      calls.push(release)
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
  const app = buildApp({ acquisitionRepository, lidarr: null, logger: false })
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
      },
    },
  })
  const list = await app.inject({ method: 'GET', url: '/api/acquisitions' })

  assert.equal(create.statusCode, 201)
  assert.equal(create.json().state, 'wanted')
  assert.equal(list.statusCode, 200)
  assert.equal(list.json().configured, true)
  assert.deepEqual(list.json().items, [create.json()])
  assert.equal(calls.length, 1)
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

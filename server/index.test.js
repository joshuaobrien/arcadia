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

test('acquisition API records Needle-owned wanted state without calling Lidarr', async (t) => {
  const calls = []
  const jobs = []
  const acquisitionRepository = {
    list: () => jobs,
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

  assert.deepEqual(list.json(), { configured: false, items: [] })
  assert.equal(create.statusCode, 503)
  assert.equal(create.json().error.code, 'unavailable')
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

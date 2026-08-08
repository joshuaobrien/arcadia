import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildApp, scanMediaRoot } from './index.js'

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

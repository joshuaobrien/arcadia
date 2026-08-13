import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { buildApp, scanMediaRoot } from './index.ts'
import { AcquisitionRepository } from './domain/acquisition-repository.ts'
import { DirectAcquisitionService } from './domain/direct-acquisition.ts'
import { AdapterError } from './integrations/errors.ts'

test('scan and status APIs report media inventory and mounts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'needle-media-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'Artist One', 'Album One'), { recursive: true })
  await mkdir(join(root, 'Artist Two', 'Album Two'), { recursive: true })
  await writeFile(join(root, 'Artist One', 'Album One', '01.flac'), '')
  await writeFile(join(root, 'Artist One', 'Album One', '02.MP3'), '')
  await writeFile(join(root, 'Artist Two', 'Album Two', '01.m4a'), '')
  const scan = await scanMediaRoot(root)
  assert.deepEqual(scan.media, { tracks: 3, albums: 2, artists: 2, formats: { FLAC: 1, M4A: 1, MP3: 1 } })
  assert.equal((await scanMediaRoot()).configured, false)
  assert.equal((await scanMediaRoot(join(root, 'missing'))).mounted, false)
  const app = buildApp({ walkmanPath: root, libraryPath: root, catalog: null, logger: false })
  t.after(() => app.close())
  const body = (await app.inject({ method: 'GET', url: '/api/status' })).json()
  assert.deepEqual(body.device.profile, { manufacturer: 'Sony', model: 'NW-A55' })
  assert.equal(body.device.mounted, true)
  assert.equal(body.library.mounted, true)
})

test('library inventory is stable, canonical, and paginated', async t => {
  const root = await mkdtemp(join(tmpdir(), 'needle-library-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'Artist', 'Album'), { recursive: true })
  await writeFile(join(root, 'Artist', 'Album', '01 First.flac'), 'bad audio')
  await writeFile(join(root, 'Artist', 'Album', '02 Second.mp3'), 'bad audio')
  const app = buildApp({ libraryPath: root, catalog: null, logger: false }); t.after(() => app.close())
  const first = await app.inject({ method: 'GET', url: '/api/library/tracks?limit=1' })
  const second = await app.inject({ method: 'GET', url: `/api/library/tracks?limit=1&cursor=${first.json().nextCursor}` })
  assert.equal(first.json().total, 2)
  assert.equal(first.json().items[0].relativePath, 'Artist/Album/01 First.flac')
  assert.ok(['read', 'unreadable'].includes(first.json().items[0].metadataStatus))
  assert.equal(second.json().items[0].relativePath, 'Artist/Album/02 Second.mp3')
})

test('Jellyfin browsing, artwork, and song streaming are proxied', async t => {
  const albumId = 'a'.repeat(32); const songId = 'b'.repeat(32); const ranges = []
  const jellyfin = {
    listAlbums: async query => ({ items: [{ id: albumId, title: 'Tender Buttons', albumArtist: 'Broadcast', query }], total: 1 }),
    listAlbumTracks: async () => ({ items: [{ id: songId, title: 'I Found the F' }], total: 1 }),
    listArtists: async () => ({ items: [{ name: 'Broadcast', albumCount: 1 }], total: 1 }),
    listTracks: async () => ({ items: [{ id: songId, title: 'Echo', albumId }], total: 1 }),
    getAlbumArtwork: async () => ({ contentType: 'image/jpeg', data: new TextEncoder().encode('art') }),
    getTrackAudio: async (_id, range) => { ranges.push(range); return { status: range ? 206 : 200, contentType: 'audio/flac', contentLength: range ? '4' : '10', ...(range ? { contentRange: 'bytes 2-5/10' } : {}), acceptRanges: 'bytes', body: new Response(range ? '2345' : '0123456789').body } },
  }
  const app = buildApp({ jellyfin, catalog: null, logger: false }); t.after(() => app.close())
  assert.equal((await app.inject({ url: '/api/library/albums?term=Broadcast' })).json().items[0].title, 'Tender Buttons')
  assert.equal((await app.inject({ url: `/api/library/albums/${albumId}/tracks` })).json().items[0].title, 'I Found the F')
  assert.equal((await app.inject({ url: `/api/library/albums/${albumId}/artwork` })).body, 'art')
  assert.equal((await app.inject({ url: '/api/library/artists' })).json().items[0].name, 'Broadcast')
  assert.equal((await app.inject({ url: '/api/library/songs' })).json().items[0].title, 'Echo')
  assert.equal((await app.inject({ url: `/api/library/songs/${songId}/stream` })).body, '0123456789')
  const partial = await app.inject({ url: `/api/library/songs/${songId}/stream`, headers: { range: 'bytes=2-5' } })
  assert.equal(partial.statusCode, 206); assert.equal(partial.body, '2345'); assert.equal(partial.headers['content-range'], 'bytes 2-5/10')
  assert.equal((await app.inject({ url: `/api/library/songs/${songId}/stream`, headers: { range: 'bytes=0-1,4-5' } })).statusCode, 416)
  assert.deepEqual(ranges, [undefined, 'bytes=2-5'])
})

test('song streaming returns 404 when Jellyfin has no track', async t => {
  const app = buildApp({ jellyfin: { getTrackAudio: async () => null }, catalog: null, logger: false }); t.after(() => app.close())
  assert.equal((await app.inject({ url: `/api/library/songs/${'b'.repeat(32)}/stream` })).statusCode, 404)
})

test('unified search combines Jellyfin, MusicBrainz, and wanted identity', async t => {
  const mbid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const wanted = { id: 'wanted', state: 'wanted', artist: 'Broadcast', release: 'Tender Buttons', musicBrainzReleaseGroupId: mbid, searchRefs: [{ adapterId: 'musicbrainz', nativeId: `release-group:mbid:${mbid}` }], createdAt: '', updatedAt: '' }
  const repository = { list: () => [wanted], wantRelease: () => {} }
  const jellyfin = { listAlbums: async () => ({ items: [{ id: 'a'.repeat(32), title: 'Tender Buttons', albumArtist: 'Broadcast', musicBrainzReleaseGroupId: mbid }], total: 1 }), listArtists: async () => ({ items: [{ name: 'Broadcast' }], total: 1 }), listTracks: async () => ({ items: [{ id: 'b'.repeat(32), title: 'Echo' }], total: 1 }) }
  const catalog = { lookupArtists: async () => [], lookupReleases: async () => [{ ref: wanted.searchRefs[0], artistRef: { adapterId: 'musicbrainz', nativeId: 'artist:mbid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' }, artistName: 'Broadcast', title: 'Tender Buttons', musicBrainzReleaseGroupId: mbid }], listArtistReleases: async () => [] }
  const app = buildApp({ jellyfin, catalog, acquisitionRepository: repository, directAcquisition: null, logger: false }); t.after(() => app.close())
  const body = (await app.inject({ url: '/api/music/releases?term=Broadcast' })).json()
  assert.equal(body.items[0].state, 'in-library'); assert.equal(body.items[0].acquisition.id, 'wanted'); assert.equal(body.tracks[0].title, 'Echo')
  assert.deepEqual(body.sources, { library: 'available', artists: 'available', tracks: 'available', catalog: 'available', wanted: 'available' })
})

test('exact MusicBrainz artist search returns discography, not fuzzy releases', async t => {
  const artistId = '6f1a58bf-9b1b-49cf-a44a-6cefad7ae04f'; let fuzzy = 0
  const ref = { adapterId: 'musicbrainz', nativeId: `artist:mbid:${artistId}` }
  const catalog = { lookupArtists: async () => [{ ref, name: 'Dua Lipa' }], lookupReleases: async () => { fuzzy++; return [] }, listArtistReleases: async value => { assert.deepEqual(value, ref); return [{ ref: { adapterId: 'musicbrainz', nativeId: 'release-group:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, artistRef: ref, title: 'Houdini' }] } }
  const app = buildApp({ jellyfin: null, catalog, acquisitionRepository: null, logger: false }); t.after(() => app.close())
  const body = (await app.inject({ url: '/api/music/releases?term=%20DUA%20%20LIPA%20' })).json()
  assert.equal(fuzzy, 0); assert.deepEqual(body.items.map(item => item.title), ['Houdini'])
  assert.equal(body.artists[0].name, 'Dua Lipa'); assert.equal(body.artists[0].albumCount, 0)
})

test('artist page combines exact identity, owned music, catalog discography, and songs', async t => {
  const artistId = '6f1a58bf-9b1b-49cf-a44a-6cefad7ae04f'
  const releaseGroupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const albumId = 'a'.repeat(32); const songId = 'b'.repeat(32)
  const ref = { adapterId: 'musicbrainz', nativeId: `artist:mbid:${artistId}` }
  const jellyfin = {
    listAlbums: async () => ({ items: [
      { id: albumId, title: 'Future Nostalgia', albumArtist: 'Dua Lipa', musicBrainzReleaseGroupId: releaseGroupId, hasArtwork: true },
      { id: 'c'.repeat(32), title: 'Wrong Artist', albumArtist: 'Dua Lipa Tribute', hasArtwork: false },
    ], total: 2 }),
    listTracks: async () => ({ items: [
      { id: songId, title: 'Levitating', artists: ['Dua Lipa'], albumArtist: 'Dua Lipa', albumId },
      { id: 'd'.repeat(32), title: 'Feature', artists: ['Someone Else'], albumArtist: 'Someone Else' },
    ], total: 2 }),
    listAlbumTracks: async id => ({ items: id === albumId ? [{ id: songId, title: 'Levitating', artists: ['Dua Lipa'], albumArtist: 'Dua Lipa', albumId }] : [], total: id === albumId ? 1 : 0 }),
  }
  const catalog = {
    lookupArtists: async () => [{ ref, name: 'Dua Lipa', sortName: 'Lipa, Dua', disambiguation: 'English-Albanian singer', musicBrainzArtistId: artistId }],
    lookupReleases: async () => [],
    listArtistReleases: async value => { assert.deepEqual(value, ref); return [
      { ref: { adapterId: 'musicbrainz', nativeId: `release-group:mbid:${releaseGroupId}` }, artistRef: ref, title: 'Future Nostalgia', releaseType: 'Album', musicBrainzReleaseGroupId: releaseGroupId },
      { ref: { adapterId: 'musicbrainz', nativeId: 'release-group:mbid:eeeeeeee-bbbb-cccc-dddd-eeeeeeeeeeee' }, artistRef: ref, title: 'Houdini', releaseType: 'Single' },
    ] },
  }
  const app = buildApp({ jellyfin, catalog, acquisitionRepository: null, logger: false }); t.after(() => app.close())
  const response = await app.inject({ url: '/api/music/artists?name=Dua%20Lipa' })
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.artist.name, 'Dua Lipa'); assert.equal(body.artist.musicBrainzArtistId, artistId)
  assert.equal(body.artist.representativeAlbumId, albumId); assert.equal(body.artist.albumCount, 1)
  assert.deepEqual(body.releases.map(item => [item.title, item.state]), [['Future Nostalgia', 'in-library'], ['Houdini', 'can-request']])
  assert.deepEqual(body.tracks.map(item => item.title), ['Levitating'])
})

test('ambiguous artist identity retains fuzzy MusicBrainz release lookup', async t => {
  let discographies = 0
  const catalog = { lookupArtists: async () => [{ ref: { adapterId: 'musicbrainz', nativeId: 'artist:mbid:a' }, name: 'Same Name' }, { ref: { adapterId: 'musicbrainz', nativeId: 'artist:mbid:b' }, name: 'Same Name' }], lookupReleases: async () => [{ ref: { adapterId: 'musicbrainz', nativeId: 'release-group:mbid:c' }, artistRef: { adapterId: 'musicbrainz', nativeId: 'artist:mbid:a' }, title: 'A Release' }], listArtistReleases: async () => { discographies++; return [] } }
  const app = buildApp({ jellyfin: null, catalog, acquisitionRepository: null, logger: false }); t.after(() => app.close())
  assert.equal((await app.inject({ url: '/api/music/releases?term=Same%20Name' })).json().items[0].title, 'A Release'); assert.equal(discographies, 0)
})

test('beets read routes expose normalized data and truthful unconfigured errors', async t => {
  const missingApp = buildApp({ beets: null, catalog: null, jellyfin: null, logger: false }); t.after(() => missingApp.close())
  assert.deepEqual((await missingApp.inject({ url: '/api/services/beets' })).json(), { configured: false })
  assert.equal((await missingApp.inject({ url: '/api/imports/inboxes' })).statusCode, 503)
  const beets = { probe: async () => ({ adapterId: 'beets', kind: 'beets', state: 'available', checkedAt: '', latencyMs: 2, version: '2.3.1' }), listInboxes: async () => [{ name: 'Inbox' }], listFolders: async () => [{ name: 'Album', providerPath: '/inbox/Album', hash: 'h', album: true, type: 'directory', children: [] }], listFolderStatuses: async () => [{ providerPath: '/inbox/Album', hash: 'h', status: 'previewed' }] }
  const app = buildApp({ beets, catalog: null, jellyfin: null, logger: false }); t.after(() => app.close())
  assert.equal((await app.inject({ url: '/api/services/beets' })).json().health.version, '2.3.1')
  assert.deepEqual((await app.inject({ url: '/api/imports/inboxes' })).json(), { items: await beets.listInboxes() })
  assert.deepEqual((await app.inject({ url: '/api/imports/folders' })).json(), { items: await beets.listFolders() })
  assert.deepEqual((await app.inject({ url: '/api/imports/status' })).json(), { items: await beets.listFolderStatuses() })
})

test('beets preview and import mutations validate current tree and choices', async t => {
  const calls = []
  const operations = []
  let libraryAlbums = []
  let libraryRefreshes = 0
  let failLibraryRefresh = false
  let loseSubmissionCas = false
  let throwSubmissionCas = false
  const linkedAcquisition = { id: 'direct-completed', state: 'completed', artist: 'Artist', release: 'Album', searchRefs: [{ adapterId: 'musicbrainz', nativeId: 'release-group:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }], createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z' }
  const folder = { name: 'Album', providerPath: '/inbox/Album', hash: 'album-hash', album: true, type: 'directory', children: [] }
  const session = { id: 'session-1', providerPath: folder.providerPath, hash: folder.hash, progress: 20, tasks: [{ id: 'task-1', currentMetadata: { artist: 'Artist', album: 'Album' }, items: [{ title: 'Track' }], candidates: [{ id: 'candidate-1', kind: 'candidate', artist: 'Artist', album: 'Album', distance: 0.1, penalties: [], trackCount: 1, duplicateCount: 0 }] }] }
  const beets = {
    adapterId: 'beets', kind: 'beets',
    probe: async () => ({ adapterId: 'beets', kind: 'beets', state: 'available', checkedAt: '2026-08-09T00:00:00Z', latencyMs: 2 }),
    listInboxes: async () => [], listFolders: async () => [folder], listFolderStatuses: async () => [], getPreview: async () => session,
    enqueuePreview: async (target, context) => { calls.push(['preview', target]); return { jobId: 'preview-job', kind: 'preview', ...target, operationId: context.operationId } },
    enqueueImport: async (request, context) => { calls.push(['import', request]); return { jobId: 'import-job', kind: 'import_candidate', providerPath: request.providerPath, hash: request.hash, operationId: context.operationId } },
  }
  const acquisitionRepository = {
    list: () => [linkedAcquisition], get: id => id === linkedAcquisition.id ? linkedAcquisition : null,
    getDirectWorkflow: id => id === linkedAcquisition.id ? { submissionState: 'submitted' } : null,
    wantRelease: () => { throw new Error('not used') },
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
      if (operation.acquisitionId) Object.assign(linkedAcquisition, { state: 'completed', importRef: undefined })
      return true
    },
    transitionBeetsImportOperation: (id, expectedState, state, update = {}) => {
      const operation = operations.find(item => item.id === id)
      if (!operation) return null
      if (operation.state !== expectedState) return operation
      if (throwSubmissionCas && expectedState === 'submitting' && state === 'submitted') { throwSubmissionCas = false; throw new Error('database write failed') }
      if (loseSubmissionCas && expectedState === 'submitting' && state === 'submitted') { operation.state = 'submission-unknown'; return operation }
      Object.assign(operation, { state, updatedAt: '2026-08-09T00:01:00.000Z' }, update)
      if (operation.acquisitionId && state === 'submission-unknown') linkedAcquisition.state = 'selection-required'
      if (operation.acquisitionId && state === 'library-confirmed') linkedAcquisition.state = 'completed'
      return operation
    },
  }
  const jellyfin = {
    refreshLibrary: async () => { libraryRefreshes += 1; if (failLibraryRefresh) { failLibraryRefresh = false; throw new AdapterError({ code: 'unavailable', adapterId: 'jellyfin', message: 'offline', retryable: true }) } },
    listAlbums: async () => ({ items: libraryAlbums, total: libraryAlbums.length }),
    listAlbumTracks: async albumId => ({ items: albumId === 'album-1' || albumId === 'album-2' ? [{ id: `track-${albumId}`, title: 'Track', artists: ['Artist'] }] : [], total: 1 }),
    getAlbumArtwork: async () => null,
  }
  const app = buildApp({ beets, jellyfin, acquisitionRepository, logger: false }); t.after(() => app.close())

  const portalOrigin = await app.inject({ method: 'POST', url: '/api/imports/preview', headers: { host: '8787-orb.e2b.app', origin: 'https://needle.onamp.dev', 'sec-fetch-site': 'same-origin' }, payload: { providerPath: folder.providerPath, hash: 'stale-hash' } })
  assert.equal(portalOrigin.statusCode, 409); assert.equal(calls.length, 0)
  const crossOrigin = await app.inject({ method: 'POST', url: '/api/imports/preview', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, payload: { providerPath: folder.providerPath, hash: folder.hash } })
  assert.equal(crossOrigin.statusCode, 403); assert.equal(calls.length, 0)
  const stale = await app.inject({ method: 'POST', url: '/api/imports/preview', payload: { providerPath: folder.providerPath, hash: 'stale-hash' } })
  assert.equal(stale.statusCode, 409); assert.equal(calls.length, 0)
  const preview = await app.inject({ method: 'POST', url: '/api/imports/preview', payload: { providerPath: folder.providerPath, hash: folder.hash } })
  assert.equal(preview.statusCode, 202); assert.equal(preview.json().jobId, 'preview-job')
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/preview', payload: { providerPath: folder.providerPath, hash: folder.hash } })).statusCode, 409)
  const review = await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  assert.equal(review.statusCode, 200); assert.deepEqual(review.json(), session)

  const choice = { taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'skip' }
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/import', payload: { providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [choice] } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: 'missing', providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [choice] } })).statusCode, 409)
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ ...choice, candidateId: 'unknown' }] } })).statusCode, 409)
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ ...choice, duplicateAction: 'remove' }] } })).statusCode, 400)
  const imported = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: linkedAcquisition.id, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ ...choice, duplicateAction: 'keep' }] } })
  assert.equal(imported.statusCode, 202); assert.equal(imported.json().jobId, 'import-job'); assert.equal(imported.json().importOperationId, 'import-operation-1')
  assert.equal(operations[0].acquisitionId, linkedAcquisition.id); assert.equal(linkedAcquisition.state, 'importing')
  assert.deepEqual(operations[0].selections, [{ taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'keep', artist: 'Artist', album: 'Album', trackCount: 1 }]); assert.equal(operations[0].state, 'submitted')
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [{ ...choice, duplicateAction: 'keep' }] } })).statusCode, 409)

  session.progress = 40; session.tasks[0].chosenCandidateId = 'candidate-1'; session.tasks.push({ id: 'unapproved-task', chosenCandidateId: 'other-candidate', currentMetadata: {}, items: [], candidates: [] })
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })).json().state, 'submitted')
  session.tasks.pop(); failLibraryRefresh = true
  const refreshFailure = await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })
  assert.equal(refreshFailure.statusCode, 502); assert.equal(operations[0].state, 'submitted')
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })).json().state, 'provider-completed'); assert.equal(libraryRefreshes, 2)
  libraryAlbums = [{ id: 'album-1', title: 'Album', albumArtist: 'Artist', trackCount: 1, hasArtwork: false }, { id: 'album-2', title: 'Album', albumArtist: 'Artist', trackCount: 1, hasArtwork: false }]
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })).json().state, 'provider-completed'); assert.equal(libraryRefreshes, 2)
  libraryAlbums = libraryAlbums.slice(0, 1)
  const confirmed = await app.inject({ method: 'POST', url: '/api/imports/operations/import-operation-1/reconcile', payload: {} })
  assert.equal(confirmed.json().state, 'library-confirmed'); assert.deepEqual(confirmed.json().libraryAlbumIds, ['album-1']); assert.equal(linkedAcquisition.state, 'completed')
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/imports/operations' })).json(), { configured: true, items: operations })

  session.id = 'session-2'; session.progress = 20; delete session.tasks[0].chosenCandidateId
  await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  beets.enqueueImport = async () => { throw new Error('unexpected provider failure') }
  const failedSubmission = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [choice] } })
  assert.equal(failedSubmission.statusCode, 503); assert.equal(failedSubmission.json().error.providerCode, 'outcome-unknown'); assert.equal(operations[1].state, 'submission-unknown')
  session.id = 'session-3'; await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  beets.enqueueImport = async (request, context) => ({ jobId: 'accepted-but-not-persisted', kind: 'import_candidate', providerPath: request.providerPath, hash: request.hash, operationId: context.operationId }); loseSubmissionCas = true
  const lostDurability = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [choice] } })
  assert.equal(lostDurability.statusCode, 503); assert.equal(lostDurability.json().error.providerCode, 'outcome-unknown'); assert.equal(operations[2].state, 'submission-unknown')
  loseSubmissionCas = false; session.id = 'session-4'; await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  beets.enqueueImport = async () => { throw new AdapterError({ code: 'invalid-request', adapterId: 'beets', message: 'Rejected before enqueue', retryable: false, providerStatus: 400 }) }
  const rejected = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [choice] } })
  assert.equal(rejected.statusCode, 400); assert.equal(operations.some(item => item.sessionId === session.id), false)
  beets.enqueueImport = async (request, context) => ({ jobId: 'retry-job', kind: 'import_candidate', providerPath: request.providerPath, hash: request.hash, operationId: context.operationId })
  await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  assert.equal((await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [choice] } })).statusCode, 202)
  session.id = 'session-5'; throwSubmissionCas = true; await app.inject({ method: 'GET', url: `/api/imports/preview?providerPath=${encodeURIComponent(folder.providerPath)}&hash=${folder.hash}` })
  const failedDurabilityWrite = await app.inject({ method: 'POST', url: '/api/imports/import', payload: { acquisitionId: null, providerPath: folder.providerPath, hash: folder.hash, sessionId: session.id, choices: [choice] } })
  assert.equal(failedDurabilityWrite.statusCode, 503); assert.equal(failedDurabilityWrite.json().error.providerCode, 'outcome-unknown'); assert.equal(operations.find(item => item.sessionId === session.id)?.state, 'submission-unknown')
  assert.deepEqual(calls.map(([kind]) => kind), ['preview', 'import'])
})

test('direct acquisition creates a durable journey and exposes candidates', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-direct-')); const repository = new AcquisitionRepository(join(directory, 'needle.sqlite'))
  const files = ['Broadcast\\Tender Buttons\\01 Song 1.flac', 'Broadcast\\Tender Buttons\\02 Song 2.flac']
  const slskd = { search: async () => ({ searchId: 'search', responses: [{ username: 'peer', files: files.map(filename => ({ filename, size: 1000 })) }] }), submitDownloadBatch: async () => 'batch', rollbackBatches: async () => {}, summarizeBatches: async () => ({ state: 'queued', visible: 2, completed: 0, bytesTotal: 2000, bytesTransferred: 0 }) }
  const direct = new DirectAcquisitionService(repository, { listReleaseEditions: async () => [{ id: 'edition', media: [{ position: 1, tracks: [] }], tracks: [{ mediumPosition: 1, position: 1, title: 'Song 1' }, { mediumPosition: 1, position: 2, title: 'Song 2' }] }] }, slskd)
  const app = buildApp({ acquisitionRepository: repository, directAcquisition: direct, slskd: null, catalog: null, logger: false }); t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }) })
  const created = await app.inject({ method: 'POST', url: '/api/acquisitions', payload: { release: { ref: { adapterId: 'musicbrainz', nativeId: 'release-group:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, artistRef: { adapterId: 'musicbrainz', nativeId: 'artist:mbid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' }, artistName: 'Broadcast', title: 'Tender Buttons', musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } } })
  assert.equal(created.statusCode, 201); assert.equal(created.json().state, 'queued')
  const candidates = (await app.inject({ url: `/api/acquisitions/${created.json().id}/candidates` })).json()
  assert.equal(candidates.workflow.submissionState, 'submitted'); assert.equal(candidates.candidates[0].audioFiles.length, 2)
  const journey = (await app.inject({ url: `/api/journeys/${created.json().id}` })).json()
  assert.equal(journey.stage, 'queued'); assert.equal(journey.sources.download, 'available')
})

async function automaticImportFixture(t, candidateUpdate = candidate => [candidate]) {
  const directory = await mkdtemp(join(tmpdir(), 'needle-automatic-import-'))
  const databasePath = join(directory, 'needle.sqlite')
  const repository = new AcquisitionRepository(databasePath)
  const files = ['Broadcast\\Tender Buttons\\01 Song 1.flac', 'Broadcast\\Tender Buttons\\02 Song 2.flac']
  const slskd = {
    search: async () => ({ searchId: 'search', responses: [{ username: 'peer', files: files.map(filename => ({ filename, size: 1000 })) }] }),
    submitDownloadBatch: async () => 'batch', rollbackBatches: async () => {},
    summarizeBatches: async () => ({ state: 'completed', visible: 2, completed: 2, bytesTotal: 2000, bytesTransferred: 2000 }),
  }
  const direct = new DirectAcquisitionService(repository, { listReleaseEditions: async () => [{ id: 'edition', media: [{ position: 1, tracks: [] }], tracks: [{ mediumPosition: 1, position: 1, title: 'Song 1' }, { mediumPosition: 1, position: 2, title: 'Song 2' }] }] }, slskd)
  let status = 'not-started'
  let journeyId
  const previewCalls = []
  const importCalls = []
  const baseCandidate = {
    id: 'beets-candidate', kind: 'candidate', artist: '  BROADCAST ', album: 'Tender   Buttons', year: 2005,
    distance: 0.05, penalties: ['year'], trackCount: 2, duplicateCount: 0,
    tracks: [{ title: 'Song 1' }, { title: 'Song 2' }], trackMapping: { 0: 0, 1: 1 },
  }
  const session = {
    id: 'automatic-session', providerPath: '', hash: 'automatic-hash', progress: 20,
    tasks: [{ id: 'automatic-task', currentMetadata: { artist: 'Broadcast', album: 'Tender Buttons' }, items: [{ title: 'Song 1' }, { title: 'Song 2' }], candidates: candidateUpdate(structuredClone(baseCandidate)) }],
  }
  let folderHash = session.hash
  const folder = () => ({ name: 'Tender Buttons', providerPath: repository.getDirectWorkflow(journeyId)?.outputNeedlePath, hash: folderHash, album: true, type: 'directory', children: [] })
  const beets = {
    listFolders: async () => [folder()], listFolderStatuses: async () => [{ providerPath: folder().providerPath, hash: session.hash, status }],
    enqueuePreview: async target => { previewCalls.push(target); return { jobId: 'preview-job' } },
    getPreview: async () => ({ ...session, providerPath: folder().providerPath }),
    enqueueImport: async request => { importCalls.push(request); return { jobId: 'import-job' } },
  }
  const app = buildApp({ acquisitionRepository: repository, directAcquisition: direct, beets, catalog: null, logger: false })
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }) })
  const created = await app.inject({ method: 'POST', url: '/api/acquisitions', payload: { release: {
    ref: { adapterId: 'musicbrainz', nativeId: 'release-group:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    artistRef: { adapterId: 'musicbrainz', nativeId: 'artist:mbid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' },
    artistName: 'Broadcast', title: 'Tender Buttons', releaseDate: '2005-09-19', trackCount: 2,
    musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  } } })
  assert.equal(created.statusCode, 201)
  journeyId = created.json().id
  return {
    app, repository, journeyId, previewCalls, importCalls,
    setStatus: value => { status = value },
    setFolderHash: value => { folderHash = value },
    markDirectSelectionManual: () => {
      const database = new DatabaseSync(databasePath)
      database.prepare("UPDATE direct_acquisitions SET selection_explanation = 'Manually selected; exact match' WHERE acquisition_id = ?").run(journeyId)
      database.close()
    },
    journey: () => app.inject({ url: `/api/journeys/${journeyId}` }),
  }
}

test('completed direct journey automatically previews and durably imports one conservative exact match once', async t => {
  const fixture = await automaticImportFixture(t)
  const preview = await fixture.journey()
  assert.equal(preview.statusCode, 200); assert.equal(preview.json().stage, 'review'); assert.equal(fixture.previewCalls.length, 1)
  await fixture.journey()
  assert.equal(fixture.previewCalls.length, 1); assert.equal(fixture.importCalls.length, 0)

  fixture.setStatus('previewed')
  const imported = await fixture.journey()
  assert.equal(imported.json().stage, 'importing'); assert.equal(fixture.importCalls.length, 1)
  const operations = fixture.repository.listBeetsImportOperations()
  assert.equal(operations.length, 1); assert.equal(operations[0].state, 'submitted'); assert.equal(operations[0].acquisitionId, fixture.journeyId)
  assert.deepEqual(operations[0].selections, [{ taskId: 'automatic-task', candidateId: 'beets-candidate', duplicateAction: 'skip', artist: '  BROADCAST ', album: 'Tender   Buttons', year: 2005, trackCount: 2 }])
  assert.equal(fixture.repository.get(fixture.journeyId).state, 'importing')
  await fixture.journey(); await fixture.journey()
  assert.equal(fixture.importCalls.length, 1); assert.equal(fixture.repository.listBeetsImportOperations().length, 1)
})

test('automatic beets import prefers an equally confident candidate from the requested release year', async t => {
  const fixture = await automaticImportFixture(t, candidate => [
    { ...candidate, id: 'digital-reissue', year: 2018 },
    { ...candidate, id: 'original-release', year: 2005 },
    { ...candidate, id: 'vinyl-reissue', year: 2008 },
  ])
  fixture.setFolderHash('stale-inbox-tree-hash')
  fixture.setStatus('previewed')
  const imported = await fixture.journey()
  assert.equal(imported.json().stage, 'importing'); assert.equal(fixture.importCalls.length, 1)
  const operation = fixture.repository.listBeetsImportOperations()[0]
  assert.equal(operation.hash, 'automatic-hash'); assert.equal(operation.selections[0].candidateId, 'original-release')
  assert.equal(fixture.importCalls[0].hash, 'automatic-hash')
})

const automaticImportRejections = [
  ['artist conflict', candidate => [{ ...candidate, artist: 'Another Artist' }]],
  ['incomplete mapping', candidate => [{ ...candidate, trackMapping: { 0: 0 } }]],
  ['extra mapping/track count', candidate => [{ ...candidate, trackCount: 3, tracks: [...candidate.tracks, { title: 'Extra' }], trackMapping: { 0: 0, 1: 1, 2: 2 } }]],
  ['blocking penalty', candidate => [{ ...candidate, penalties: ['missing_tracks'] }]],
  ['unknown penalty', candidate => [{ ...candidate, penalties: ['unexpected_penalty'] }]],
  ['distance above five percent', candidate => [{ ...candidate, distance: 0.051 }]],
  ['materially ambiguous tie', candidate => [candidate, { ...candidate, id: 'different-tied-candidate', tracks: [{ title: 'Different Song' }, candidate.tracks[1]] }]],
  ['materially different third candidate after two equivalent candidates', candidate => [
    candidate,
    { ...candidate, id: 'equivalent-candidate' },
    { ...candidate, id: 'different-third-candidate', tracks: [{ title: 'Different Song' }, candidate.tracks[1]] },
  ]],
]

for (const [reason, update] of automaticImportRejections) {
  test(`automatic beets import leaves ${reason} for manual review`, async t => {
    const fixture = await automaticImportFixture(t, update)
    fixture.setStatus('previewed')
    const response = await fixture.journey()
    assert.equal(response.statusCode, 200); assert.equal(response.json().stage, 'review')
    assert.equal(fixture.importCalls.length, 0); assert.deepEqual(fixture.repository.listBeetsImportOperations(), [])
    await fixture.journey()
    assert.equal(fixture.importCalls.length, 0)
  })
}

test('automatic beets import does not run for a manually selected eligible Soulseek candidate', async t => {
  const fixture = await automaticImportFixture(t)
  fixture.markDirectSelectionManual()
  const response = await fixture.journey()
  assert.equal(response.statusCode, 200); assert.equal(response.json().stage, 'review')
  assert.match(fixture.repository.getDirectWorkflow(fixture.journeyId).selectionExplanation, /^Manually selected/)
  assert.equal(fixture.previewCalls.length, 0); assert.equal(fixture.importCalls.length, 0)
  assert.deepEqual(fixture.repository.listBeetsImportOperations(), [])
})

test('acquisition list enriches jobs by exact MusicBrainz identity', async t => {
  const mbid = '325775d4-08d2-411a-b3bb-d7e9e7a0cf92'; const job = { id: 'job', state: 'wanted', artist: 'yeule', release: 'Album', musicBrainzReleaseGroupId: mbid, searchRefs: [{ adapterId: 'musicbrainz', nativeId: `release-group:mbid:${mbid}` }], createdAt: '', updatedAt: '' }
  const other = { ...job, id: 'other', musicBrainzReleaseGroupId: '4292e32e-469a-4c14-a025-3abbef5fd703', searchRefs: [{ adapterId: 'musicbrainz', nativeId: 'release-group:mbid:4292e32e-469a-4c14-a025-3abbef5fd703' }] }
  const repository = { list: () => [job, other], wantRelease: () => {} }
  const catalog = { lookupReleases: async () => [{ ref: job.searchRefs[0], artistRef: { adapterId: 'musicbrainz', nativeId: 'artist:mbid:a' }, title: 'Album', musicBrainzReleaseGroupId: mbid, releaseType: 'Album', releaseDate: '2025-05-30', trackCount: 10 }], lookupArtists: async () => [], listArtistReleases: async () => [] }
  const app = buildApp({ acquisitionRepository: repository, directAcquisition: null, catalog, logger: false }); t.after(() => app.close())
  const item = (await app.inject({ url: '/api/acquisitions' })).json().items[0]
  assert.deepEqual([item.releaseType, item.releaseDate, item.trackCount], ['Album', '2025-05-30', 10])
})

test('production app serves static assets while preserving API 404s', async t => {
  const root = await mkdtemp(join(tmpdir(), 'needle-static-')); t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'assets')); await writeFile(join(root, 'index.html'), '<main>Needle runtime</main>'); await writeFile(join(root, 'assets', 'app.js'), 'console.log("needle")')
  const app = buildApp({ staticRoot: root, catalog: null, logger: false }); t.after(() => app.close())
  assert.match((await app.inject({ url: '/' })).body, /Needle runtime/)
  assert.match((await app.inject({ url: '/assets/app.js' })).body, /console\.log/)
  assert.match((await app.inject({ url: '/acquire' })).body, /Needle runtime/)
  assert.equal((await app.inject({ url: '/api/does-not-exist' })).json().error.code, 'not-found')
})

test('direct acquisition is required and compatibility routes are absent', async t => {
  const repository = { list: () => [], wantRelease: () => { throw new Error('must not persist') } }
  const app = buildApp({ acquisitionRepository: repository, directAcquisition: null, catalog: null, slskd: null, logger: false })
  t.after(() => app.close())
  const release = { ref: { adapterId: 'musicbrainz', nativeId: 'release-group:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, artistRef: { adapterId: 'musicbrainz', nativeId: 'artist:mbid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' }, title: 'Album', musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }
  assert.equal((await app.inject({ method: 'POST', url: '/api/acquisitions', payload: { release } })).statusCode, 503)
  assert.equal((await app.inject({ method: 'GET', url: '/api/acquisition-defaults' })).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: '/api/services/legacy-acquisition' })).statusCode, 404)
})

test('legacy persisted journeys remain stable and need attention', async t => {
  const job = { id: 'legacy', state: 'wanted', release: 'Album', searchRefs: [{ adapterId: 'historical', nativeId: 'album:1' }], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }
  const repository = { list: () => [job], get: () => job, wantRelease: () => { throw new Error('unused') }, listBeetsImportOperations: () => [] }
  const app = buildApp({ acquisitionRepository: repository, directAcquisition: null, beets: null, logger: false })
  t.after(() => app.close())
  const response = await app.inject({ method: 'GET', url: '/api/journeys/legacy' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().stage, 'attention')
  assert.equal(response.json().sources.download, 'unavailable')
})

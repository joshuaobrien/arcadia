import assert from 'node:assert/strict'
import test from 'node:test'
import { AdapterError } from './errors.ts'
import { LidarrAdapter, createLidarrAdapterFromEnv } from './lidarr.ts'

// Shared operation context makes outbound correlation assertions deterministic.
const context = { operationId: 'operation-123' }

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function mockAdapter(handler, options = {}) {
  return new LidarrAdapter({
    baseUrl: 'http://lidarr.test:8686',
    apiKey: 'secret-key',
    fetch: handler,
    ...options,
  })
}

test('Lidarr lookup uses API v1 auth and returns namespaced catalog references', async () => {
  const adapter = mockAdapter(async (input, init) => {
    const url = new URL(input)
    assert.equal(url.pathname, '/api/v1/artist/lookup')
    assert.equal(url.searchParams.get('term'), 'Nujabes')
    assert.equal(init.headers['X-Api-Key'], 'secret-key')
    assert.equal(init.headers['X-Needle-Operation-Id'], context.operationId)
    return json([{
      id: 0,
      artistName: 'Nujabes',
      sortName: 'Nujabes',
      foreignArtistId: '4d23fef3-93e5-4348-b50a-6e20860f23e0',
      images: [{ url: '/MediaCover/poster.jpg', remoteUrl: 'https://images.test/poster.jpg' }],
    }])
  })

  const [artist] = await adapter.lookupArtists('Nujabes', context)

  assert.deepEqual(artist, {
    ref: { adapterId: 'lidarr', nativeId: 'artist:mbid:4d23fef3-93e5-4348-b50a-6e20860f23e0' },
    name: 'Nujabes',
    sortName: 'Nujabes',
    disambiguation: undefined,
    musicBrainzArtistId: '4d23fef3-93e5-4348-b50a-6e20860f23e0',
    images: ['https://images.test/poster.jpg'],
  })
})

test('Lidarr release lookup retains the artist display name', async () => {
  const adapter = mockAdapter(async () => json([{
    id: 0,
    title: 'Modal Soul',
    foreignAlbumId: 'release-group-mbid',
    releaseDate: '2005-11-11T00:00:00Z',
    albumType: 'Album',
    releases: [{ trackCount: 14 }, { trackCount: 16 }],
    artist: {
      id: 0,
      artistName: 'Nujabes',
      foreignArtistId: 'artist-mbid',
    },
  }]))

  const [release] = await adapter.lookupReleases('Modal Soul', context)

  assert.equal(release.artistName, 'Nujabes')
  assert.deepEqual(release.artistRef, { adapterId: 'lidarr', nativeId: 'artist:mbid:artist-mbid' })
  assert.equal(release.releaseType, 'Album')
  assert.equal(release.releaseDate, '2005-11-11T00:00:00Z')
  assert.equal(release.trackCount, 14)
})

test('Lidarr lists an uninstalled artist discography by MusicBrainz identity', async () => {
  const artistId = '6f1a58bf-9b1b-49cf-a44a-6cefad7ae04f'
  const requests = []
  const adapter = mockAdapter(async (input, init) => {
    const url = new URL(input)
    requests.push({ url, init })
    assert.equal(url.origin, 'https://musicbrainz.test')
    assert.equal(url.pathname, '/ws/2/release-group')
    assert.equal(url.searchParams.get('artist'), artistId)
    assert.equal(url.searchParams.get('release-group-status'), 'website-default')
    assert.equal(url.searchParams.get('limit'), '100')
    return json({
      'release-group-count': 1,
      'release-groups': [{
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        title: 'Future Nostalgia',
        'primary-type': 'Album',
        'first-release-date': '2020-03-27',
      }],
    })
  }, { musicBrainzBaseUrl: 'https://musicbrainz.test/ws/2/' })

  const releases = await adapter.listArtistReleases(
    { adapterId: 'lidarr', nativeId: `artist:mbid:${artistId}` },
    context,
  )

  assert.equal(requests.length, 1)
  assert.equal(requests[0].init.headers['X-Api-Key'], undefined)
  assert.match(requests[0].init.headers['User-Agent'], /^Needle\//)
  assert.deepEqual(releases, [{
    ref: { adapterId: 'lidarr', nativeId: 'album:mbid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    artistRef: { adapterId: 'lidarr', nativeId: `artist:mbid:${artistId}` },
    title: 'Future Nostalgia',
    releaseDate: '2020-03-27',
    releaseType: 'Album',
    musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    images: ['https://coverartarchive.org/release-group/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/front-250'],
  }])
})

test('Lidarr reuses an installed release by exact MusicBrainz identity', async () => {
  const releaseGroupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const requests = []
  const adapter = mockAdapter(async (input, init) => {
    const url = new URL(input)
    requests.push({ url, init })
    assert.equal(url.pathname, '/api/v1/album')
    assert.equal(url.searchParams.get('foreignAlbumId'), releaseGroupId)
    return json([{
      id: 9,
      title: 'Tender Buttons',
      foreignAlbumId: releaseGroupId,
      artist: { id: 7, artistName: 'Broadcast', foreignArtistId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' },
    }])
  })

  const installed = await adapter.ensureRelease({
    release: {
      ref: { adapterId: 'lidarr', nativeId: `album:mbid:${releaseGroupId}` },
      artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' },
      artistName: 'Broadcast',
      title: 'Tender Buttons',
      musicBrainzReleaseGroupId: releaseGroupId,
    },
    root: { adapterId: 'lidarr', nativeId: 'root:id:1' },
    qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' },
  }, context)

  assert.deepEqual(installed.ref, { adapterId: 'lidarr', nativeId: 'album:id:9' })
  assert.equal(requests.length, 1)
})

test('Lidarr adds only the exact release without an add-time search', async () => {
  const releaseGroupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const artistId = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
  const requests = []
  const adapter = mockAdapter(async (input, init) => {
    const url = new URL(input)
    requests.push({ url, init })
    if (url.pathname === '/api/v1/album' && init.method === 'GET') return json([])
    if (url.pathname === '/api/v1/album/lookup') return json([{
      id: 0,
      title: 'Tender Buttons',
      foreignAlbumId: releaseGroupId,
      artist: { id: 0, artistName: 'Broadcast', foreignArtistId: artistId },
    }])
    if (url.pathname === '/api/v1/rootfolder/1') return json({ id: 1, path: '/music', defaultMetadataProfileId: 3 })
    if (url.pathname === '/api/v1/album' && init.method === 'POST') return json({
      id: 9,
      title: 'Tender Buttons',
      foreignAlbumId: releaseGroupId,
      artist: { id: 7, artistName: 'Broadcast', foreignArtistId: artistId },
    }, { status: 201 })
    throw new Error(`Unexpected request ${init.method} ${url.pathname}`)
  })

  const installed = await adapter.ensureRelease({
    release: {
      ref: { adapterId: 'lidarr', nativeId: `album:mbid:${releaseGroupId}` },
      artistRef: { adapterId: 'lidarr', nativeId: `artist:mbid:${artistId}` },
      artistName: 'Broadcast',
      title: 'Tender Buttons',
      musicBrainzReleaseGroupId: releaseGroupId,
    },
    root: { adapterId: 'lidarr', nativeId: 'root:id:1' },
    qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' },
  }, context)

  assert.deepEqual(installed.ref, { adapterId: 'lidarr', nativeId: 'album:id:9' })
  assert.equal(requests[1].url.searchParams.get('term'), `lidarr:${releaseGroupId}`)
  const body = JSON.parse(requests[3].init.body)
  assert.equal(body.foreignAlbumId, releaseGroupId)
  assert.equal(body.monitored, false)
  assert.equal(body.anyReleaseOk, true)
  assert.equal(body.addOptions.searchForNewAlbum, false)
  assert.equal(body.artist.foreignArtistId, artistId)
  assert.equal(body.artist.rootFolderPath, '/music')
  assert.equal(body.artist.qualityProfileId, 2)
  assert.equal(body.artist.metadataProfileId, 3)
  assert.equal(body.artist.monitored, false)
  assert.equal(body.artist.monitorNewItems, 'none')
  assert.deepEqual(body.artist.addOptions.albumsToMonitor, [releaseGroupId])
  assert.equal(body.artist.addOptions.searchForMissingAlbums, false)
})

test('Lidarr queue maps paging, states, nested catalog data, and provider paths', async () => {
  const adapter = mockAdapter(async (input) => {
    const url = new URL(input)
    assert.equal(url.pathname, '/api/v1/queue')
    assert.equal(url.searchParams.get('page'), '2')
    assert.equal(url.searchParams.get('pageSize'), '1')
    assert.equal(url.searchParams.get('includeArtist'), 'true')
    return json({
      page: 2,
      pageSize: 1,
      totalRecords: 3,
      records: [{
        id: 41,
        title: 'Modal Soul FLAC',
        size: 1000,
        sizeleft: 250,
        protocol: 'torrent',
        status: 'downloading',
        trackedDownloadState: 'downloading',
        downloadId: 'abc123',
        outputPath: '/data/downloads/Modal Soul',
        statusMessages: [{ title: 'Tracked', messages: ['Waiting for import'] }],
        artist: { id: 7, artistName: 'Nujabes', foreignArtistId: 'artist-mbid' },
        album: {
          id: 9,
          artistId: 7,
          title: 'Modal Soul',
          foreignAlbumId: 'album-mbid',
          monitored: true,
        },
      }],
    })
  }, {
    pathMappings: [{ id: 'downloads', providerPrefix: '/data/downloads', needlePrefix: '/downloads' }],
  })

  const page = await adapter.listQueue({ cursor: 'lidarr-page:2', limit: 1 }, context)

  assert.equal(page.nextCursor, 'lidarr-page:3')
  assert.equal(page.items[0].state, 'downloading')
  assert.deepEqual(page.items[0].ref, { adapterId: 'lidarr', nativeId: 'queue:id:41' })
  assert.deepEqual(page.items[0].output, {
    providerPath: '/data/downloads/Modal Soul',
    needlePath: '/downloads/Modal Soul',
    mappingId: 'downloads',
  })
  assert.deepEqual(page.items[0].statusMessages, ['Tracked', 'Waiting for import'])
})

test('Lidarr factory validates and applies explicit path mappings', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => json({ page: 1, pageSize: 1, totalRecords: 1, records: [{ id: 1, title: 'Album', status: 'queued', eventType: 'downloadFolderImported',
    outputPath: '/data/downloads/music_path/Album', data: { droppedPath: '/data/downloads/music_path/Album' } }] })
  try {
    const adapter = createLidarrAdapterFromEnv({ LIDARR_URL: 'http://lidarr.test', LIDARR_API_KEY: 'key',
      LIDARR_PATH_MAPPINGS: '[{"id":"downloads","providerPrefix":"/data/downloads/music_path","needlePrefix":"/music_path/torrents"}]' })
    const page = await adapter.listQueue({ limit: 1 }, context)
    const history = await adapter.listHistory(undefined, { limit: 1 }, context)
    assert.equal(page.items[0].output.needlePath, '/music_path/torrents/Album')
    assert.equal(history.items[0].output.needlePath, '/music_path/torrents/Album')
    assert.throws(() => createLidarrAdapterFromEnv({ LIDARR_URL: 'http://lidarr.test', LIDARR_API_KEY: 'key', LIDARR_PATH_MAPPINGS: '{bad' }), /valid JSON/)
    assert.throws(() => createLidarrAdapterFromEnv({ LIDARR_URL: 'http://lidarr.test', LIDARR_API_KEY: 'key', LIDARR_PATH_MAPPINGS: '[{"id":"x","providerPrefix":"relative","needlePrefix":"/ok"}]' }), /absolute path/)
  } finally { globalThis.fetch = originalFetch }
})

test('Lidarr sends exact wanted-state and acquisition-search payloads', async () => {
  const requests = []
  const adapter = mockAdapter(async (input, init) => {
    requests.push({ url: new URL(input), init })
    if (new URL(input).pathname.endsWith('/album/monitor')) return json([], { status: 202 })
    return json({ id: 77, name: 'AlbumSearch', status: 'queued', queued: '2026-08-07T00:00:00Z' }, { status: 201 })
  })

  const release = { adapterId: 'lidarr', nativeId: 'album:id:9' }
  await adapter.setReleaseWanted(release, false, context)
  const command = await adapter.startSearch({ kind: 'release', release }, context)

  assert.equal(requests[0].init.method, 'PUT')
  assert.deepEqual(JSON.parse(requests[0].init.body), { albumIds: [9], monitored: false })
  assert.equal(requests[1].init.method, 'POST')
  assert.deepEqual(JSON.parse(requests[1].init.body), { name: 'AlbumSearch', albumIds: [9] })
  assert.deepEqual(command.ref, { adapterId: 'lidarr', nativeId: 'command:id:77' })
  assert.equal(command.state, 'queued')
})

test('Lidarr maps provider failures to typed errors without exposing credentials', async () => {
  const adapter = mockAdapter(async () => json({ message: 'Unauthorized' }, { status: 401 }))

  await assert.rejects(
    () => adapter.lookupArtists('test', context),
    (error) => {
      assert.ok(error instanceof AdapterError)
      assert.equal(error.code, 'authentication')
      assert.equal(error.providerStatus, 401)
      assert.equal(error.message.includes('secret-key'), false)
      return true
    },
  )
})

test('Lidarr rejects invalid cursors without contacting the provider', async () => {
  let requests = 0
  const adapter = mockAdapter(async () => {
    requests += 1
    return new Response(null, { status: 200 })
  })

  await assert.rejects(
    () => adapter.listQueue({ cursor: 'not-a-cursor', limit: 25 }, context),
    (error) => error instanceof AdapterError && error.code === 'invalid-request',
  )

  assert.equal(requests, 0)
})

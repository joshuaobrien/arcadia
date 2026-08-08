import assert from 'node:assert/strict'
import test from 'node:test'
import { AdapterError } from './errors.ts'
import { LidarrAdapter } from './lidarr.ts'

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

test('Lidarr sends exact album monitoring and search command payloads', async () => {
  const requests = []
  const adapter = mockAdapter(async (input, init) => {
    requests.push({ url: new URL(input), init })
    if (new URL(input).pathname.endsWith('/album/monitor')) return json([], { status: 202 })
    return json({ id: 77, name: 'AlbumSearch', status: 'queued', queued: '2026-08-07T00:00:00Z' }, { status: 201 })
  })

  const release = { adapterId: 'lidarr', nativeId: 'album:id:9' }
  await adapter.setReleaseMonitored(release, false, context)
  const command = await adapter.startCommand('search-release', release, context)

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

test('Lidarr accepts successful empty mutation responses and rejects invalid cursors locally', async () => {
  let requests = 0
  const adapter = mockAdapter(async () => {
    requests += 1
    return new Response(null, { status: 200 })
  })

  await adapter.removeQueueItem(
    { adapterId: 'lidarr', nativeId: 'queue:id:4' },
    { removeFromClient: true, blocklist: false },
    context,
  )
  await assert.rejects(
    () => adapter.listQueue({ cursor: 'not-a-cursor', limit: 25 }, context),
    (error) => error instanceof AdapterError && error.code === 'invalid-request',
  )

  assert.equal(requests, 1)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { JellyfinAdapter } from './jellyfin.js'

const context = { operationId: 'operation-123' }
const albumId = 'a'.repeat(32)

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

test('Jellyfin adapter reads albums and tracks with API-key authentication', async () => {
  const calls: URL[] = []
  const adapter = new JellyfinAdapter({
    baseUrl: 'http://jellyfin.test:8096',
    apiKey: 'secret-key',
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      calls.push(url)
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'MediaBrowser Token="secret-key"')
      assert.equal(init?.headers && (init.headers as Record<string, string>)['X-Needle-Operation-Id'], context.operationId)
      if (url.searchParams.get('IncludeItemTypes') === 'MusicAlbum') return json({
        Items: [
          {
            Id: 'c'.repeat(32),
            Name: 'Tender Buttons',
            AlbumArtist: 'Broadcast',
            ProductionYear: 2005,
            ChildCount: 12,
            ImageTags: { Primary: 'image-tag' },
            ProviderIds: { MusicBrainzReleaseGroup: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
          },
          {
            Id: albumId,
            Name: 'Tender Buttons',
            AlbumArtist: 'Broadcast',
            ProductionYear: 2005,
            ChildCount: 12,
            ImageTags: { Primary: 'image-tag' },
            ProviderIds: { MusicBrainzReleaseGroup: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
          },
        ],
        TotalRecordCount: 2,
      })
      return json({
        Items: [{
          Id: 'b'.repeat(32),
          Name: 'I Found the F',
          Artists: ['Broadcast'],
          ParentIndexNumber: 1,
          IndexNumber: 1,
          RunTimeTicks: 1_235_000_000,
          MediaSources: [{ Container: 'flac', Size: 12345 }],
        }],
        TotalRecordCount: 1,
      })
    },
  })

  const albums = await adapter.listAlbums({ limit: 1 }, context)
  const tracks = await adapter.listAlbumTracks(albumId, { limit: 100 }, context)

  assert.deepEqual(albums, {
    items: [{ id: albumId, title: 'Tender Buttons', albumArtist: 'Broadcast', musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', year: 2005, trackCount: 12, hasArtwork: true }],
    total: 2,
    nextCursor: '1',
  })
  assert.deepEqual(tracks.items[0], {
    id: 'b'.repeat(32),
    title: 'I Found the F',
    artists: ['Broadcast'],
    trackNumber: 1,
    discNumber: 1,
    durationSeconds: 123.5,
    format: 'FLAC',
    bytes: 12345,
  })
  assert.equal(calls[0].searchParams.get('StartIndex'), null)
  assert.equal(calls[1].searchParams.get('ParentId'), albumId)
  assert.equal(calls[1].searchParams.get('StartIndex'), null)
})

test('Jellyfin adapter fetches bounded resized artwork', async () => {
  const adapter = new JellyfinAdapter({
    baseUrl: 'http://jellyfin.test:8096',
    apiKey: 'secret-key',
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input)
      assert.equal(url.pathname, `/Items/${albumId}/Images/Primary`)
      assert.equal(url.searchParams.get('maxWidth'), '600')
      assert.equal(url.searchParams.get('format'), 'jpg')
      return new Response('jpeg bytes', { headers: { 'content-type': 'image/jpeg' } })
    },
  })

  const artwork = await adapter.getAlbumArtwork(albumId, context)

  assert.equal(artwork?.contentType, 'image/jpeg')
  assert.equal(new TextDecoder().decode(artwork?.data), 'jpeg bytes')
})

test('Jellyfin adapter filters cached albums by title or album artist before paging', async () => {
  let requests = 0
  const adapter = new JellyfinAdapter({
    baseUrl: 'http://jellyfin.test:8096',
    apiKey: 'secret-key',
    fetch: async () => {
      requests += 1
      return json({ Items: [
        { Id: 'a'.repeat(32), Name: 'Tender Buttons', AlbumArtist: 'Broadcast' },
        { Id: 'b'.repeat(32), Name: 'Dots and Loops', AlbumArtist: 'Stereolab' },
      ] })
    },
  })

  const byTitle = await adapter.listAlbums({ limit: 10, term: 'tender' }, context)
  const byArtist = await adapter.listAlbums({ limit: 10, term: 'STEREOLAB' }, context)

  assert.deepEqual(byTitle.items.map(item => item.title), ['Tender Buttons'])
  assert.deepEqual(byArtist.items.map(item => item.title), ['Dots and Loops'])
  assert.equal(requests, 1)
})

test('Jellyfin adapter groups artists case-insensitively, filters, and pages deterministically', async () => {
  const adapter = new JellyfinAdapter({ baseUrl: 'http://jellyfin.test:8096', apiKey: 'key', fetch: async () => json({ Items: [
    { Id: 'c'.repeat(32), Name: 'Third', AlbumArtist: 'broadcast' },
    { Id: 'a'.repeat(32), Name: 'First', AlbumArtist: 'Broadcast' },
    { Id: 'b'.repeat(32), Name: 'Second', AlbumArtist: 'Stereolab' },
  ] }) })

  const first = await adapter.listArtists({ limit: 1 }, context)
  const second = await adapter.listArtists({ limit: 1, cursor: first.nextCursor }, context)
  const filtered = await adapter.listArtists({ limit: 10, term: 'CAST' }, context)

  assert.deepEqual(first, { items: [{ name: 'Broadcast', albumCount: 2, representativeAlbumId: 'a'.repeat(32) }], total: 2, nextCursor: '1' })
  assert.deepEqual(second.items, [{ name: 'Stereolab', albumCount: 1, representativeAlbumId: 'b'.repeat(32) }])
  assert.deepEqual(filtered.items, first.items)
})

test('Jellyfin adapter pages and searches songs server-side and maps their parent albums', async () => {
  let requested: URL | undefined
  const adapter = new JellyfinAdapter({ baseUrl: 'http://jellyfin.test:8096', apiKey: 'key', fetch: async input => {
    requested = new URL(input instanceof Request ? input.url : input)
    return json({ Items: [{ Id: 'd'.repeat(32), Name: 'Song', Artists: ['Artist'], AlbumId: albumId,
      Album: 'Album', AlbumArtists: [{ Name: 'Album Artist' }], MediaSources: [{ Container: 'flac' }] }], TotalRecordCount: 7 })
  } })

  const result = await adapter.listTracks({ limit: 2, cursor: '4', term: 'Song' }, context)

  assert.equal(requested?.searchParams.get('IncludeItemTypes'), 'Audio')
  assert.equal(requested?.searchParams.get('SearchTerm'), 'Song')
  assert.equal(requested?.searchParams.get('StartIndex'), '4')
  assert.equal(requested?.searchParams.get('Limit'), '2')
  assert.equal(requested?.searchParams.get('Fields'), 'MediaSources')
  assert.equal(result.nextCursor, '5')
  assert.deepEqual(result.items[0], { id: 'd'.repeat(32), title: 'Song', artists: ['Artist'], albumId,
    album: 'Album', albumArtist: 'Album Artist', trackNumber: undefined, discNumber: undefined,
    durationSeconds: undefined, format: 'FLAC', bytes: undefined })
})

test('Jellyfin adapter freshness queries bypass cached albums and tracks', async () => {
  let generation = 1
  let albumRequests = 0
  let trackRequests = 0
  const adapter = new JellyfinAdapter({
    baseUrl: 'http://jellyfin.test:8096',
    apiKey: 'secret-key',
    fetch: async input => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.searchParams.get('IncludeItemTypes') === 'MusicAlbum') {
        albumRequests += 1
        return json({ Items: [{ Id: albumId, Name: `Album ${generation}`, AlbumArtist: 'Artist' }] })
      }
      trackRequests += 1
      return json({ Items: [{ Id: 'b'.repeat(31) + generation, Name: `Track ${generation}`, Artists: ['Artist'] }] })
    },
  })

  assert.equal((await adapter.listAlbums({ limit: 10 }, context)).items[0].title, 'Album 1')
  assert.equal((await adapter.listAlbumTracks(albumId, { limit: 10 }, context)).items[0].title, 'Track 1')
  generation = 2
  assert.equal((await adapter.listAlbums({ limit: 10 }, context)).items[0].title, 'Album 1')
  assert.equal((await adapter.listAlbumTracks(albumId, { limit: 10 }, context)).items[0].title, 'Track 1')
  assert.equal((await adapter.listAlbums({ limit: 10, fresh: true }, context)).items[0].title, 'Album 2')
  assert.equal((await adapter.listAlbumTracks(albumId, { limit: 10, fresh: true }, context)).items[0].title, 'Track 2')
  assert.equal(albumRequests, 2)
  assert.equal(trackRequests, 2)
})

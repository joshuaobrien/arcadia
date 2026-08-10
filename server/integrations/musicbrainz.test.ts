import assert from 'node:assert/strict'
import test from 'node:test'
import { AdapterError } from './errors.js'
import { MusicBrainzAdapter } from './musicbrainz.js'

const context = { operationId: 'mb-test' }
const artistId = '11111111-2222-3333-4444-555555555555'
const groupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

test('MusicBrainz searches encode terms and map artist and release-group identity', async () => {
  const urls: URL[] = []
  const adapter = new MusicBrainzAdapter({ baseUrl: 'https://mb.test/ws/2/', fetch: async (input, init) => {
    const url = new URL(String(input)); urls.push(url)
    assert.match(String((init?.headers as Record<string, string>)['User-Agent']), /^Needle\//)
    if (url.pathname.endsWith('/artist')) return json({ artists: [{ id: artistId, name: 'A&B', 'sort-name': 'B, A', disambiguation: 'test' }] })
    return json({ 'release-groups': [{ id: groupId, title: 'One', 'primary-type': 'Album', 'secondary-types': ['Compilation'], 'first-release-date': '2020-01-02', 'artist-credit': [{ name: 'A&B', artist: { id: artistId, name: 'A&B' } }] }] })
  } })
  const [artist] = await adapter.lookupArtists('A&B / C', context)
  const [release] = await adapter.lookupReleases('One + Two', context)
  assert.equal(urls[0].searchParams.get('query'), 'A&B / C')
  assert.equal(urls[1].searchParams.get('query'), 'One + Two')
  assert.equal(artist.ref.adapterId, 'musicbrainz')
  assert.deepEqual(release.secondaryTypes, ['Compilation'])
  assert.equal(release.artistName, 'A&B')
  assert.equal(release.images?.length, 2)
  assert.equal(urls.length, 2)
})

test('MusicBrainz exact artist discography uses website-default pagination', async () => {
  const offsets: string[] = []
  const adapter = new MusicBrainzAdapter({ fetch: async input => {
    const url = new URL(String(input)); offsets.push(url.searchParams.get('offset')!)
    assert.equal(url.searchParams.get('artist'), artistId)
    assert.equal(url.searchParams.get('release-group-status'), 'website-default')
    return json({ 'release-group-count': 2, 'release-groups': [{ id: offsets.length === 1 ? groupId : 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee', title: `Page ${offsets.length}` }] })
  } })
  const releases = await adapter.listArtistReleases({ adapterId: 'musicbrainz', nativeId: `artist:mbid:${artistId}` }, context)
  assert.deepEqual(offsets, ['0', '1'])
  assert.equal(releases.length, 2)
  assert.ok(releases.every(release => release.artistRef.nativeId.endsWith(artistId)))
})

test('MusicBrainz health and provider errors are defensive', async () => {
  const unavailable = new MusicBrainzAdapter({ fetch: async () => { throw new Error('offline') } })
  assert.equal((await unavailable.probe(context)).state, 'unavailable')
  const limited = new MusicBrainzAdapter({ fetch: async () => new Response('', { status: 503, headers: { 'retry-after': '4' } }) })
  await assert.rejects(() => limited.lookupArtists('x', context), (error: unknown) => error instanceof AdapterError && error.code === 'rate-limited' && error.retryAfterSeconds === 4)
  const malformed = new MusicBrainzAdapter({ fetch: async () => json({ artists: [{ name: 'missing id' }] }) })
  await assert.rejects(() => malformed.lookupArtists('x', context), (error: unknown) => error instanceof AdapterError && error.code === 'transient-provider-failure')
})

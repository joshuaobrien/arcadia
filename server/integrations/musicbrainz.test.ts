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
  const adapter = new MusicBrainzAdapter({ baseUrl: 'https://mb.test/ws/2/', requestIntervalMs: 0, fetch: async (input, init) => {
    const url = new URL(String(input)); urls.push(url)
    assert.match(String((init?.headers as Record<string, string>)['User-Agent']), /^Arcadia\//)
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
  const adapter = new MusicBrainzAdapter({ requestIntervalMs: 0, fetch: async input => {
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
  const unavailable = new MusicBrainzAdapter({ requestIntervalMs: 0, fetch: async () => { throw new Error('offline') } })
  assert.equal((await unavailable.probe(context)).state, 'unavailable')
  const limited = new MusicBrainzAdapter({ requestIntervalMs: 0, fetch: async () => new Response('', { status: 503, headers: { 'retry-after': '0' } }) })
  await assert.rejects(() => limited.lookupArtists('x', context), (error: unknown) => error instanceof AdapterError && error.code === 'rate-limited' && error.retryAfterSeconds === 0)
  let attempts = 0
  const recovered = new MusicBrainzAdapter({ requestIntervalMs: 0, fetch: async () => ++attempts === 1
    ? new Response('', { status: 503 })
    : json({ artists: [{ id: artistId, name: 'Recovered' }] }) })
  assert.equal((await recovered.lookupArtists('Recovered', context))[0].name, 'Recovered')
  assert.equal(attempts, 2)
  const malformed = new MusicBrainzAdapter({ requestIntervalMs: 0, fetch: async () => json({ artists: [{ name: 'missing id' }] }) })
  await assert.rejects(() => malformed.lookupArtists('x', context), (error: unknown) => error instanceof AdapterError && error.code === 'transient-provider-failure')
})

test('MusicBrainz lists paginated concrete editions and tolerates omitted browse fields', async () => {
  const releaseId = '12345678-1234-1234-1234-123456789abc'; let page = 0
  const adapter = new MusicBrainzAdapter({ requestIntervalMs: 0, fetch: async input => { const url = new URL(String(input)); assert.equal(url.searchParams.get('inc'), 'media+recordings+artist-credits+labels+release-groups'); page++; return json({ 'release-count': 2, releases: [{ id: page === 1 ? releaseId : '22345678-1234-1234-1234-123456789abc', title: 'Edition', date: '2020', country: 'GB', status: 'Official', barcode: '1', 'label-info': [{ 'catalog-number': 'CAT', label: { name: 'Label' } }], media: page === 1 ? [{ position: 1, format: 'CD', tracks: [{ position: 1, number: '1', title: 'Song', length: 123000, recording: { id: artistId, title: 'Song', 'artist-credit': [{ name: 'Artist' }] } }] }] : undefined }] }) } })
  const editions = await adapter.listReleaseEditions(groupId, context)
  assert.equal(editions.length, 2); assert.equal(editions[0].tracks[0].durationMs, 123000); assert.equal(editions[0].label, 'Label'); assert.deepEqual(editions[1].tracks, [])
})

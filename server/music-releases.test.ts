import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeMusicReleases } from './music-releases.js'

const mbid = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'

test('unified releases merge exact MusicBrainz identities and preserve distinct uncertain matches', () => {
  const items = mergeMusicReleases([
    { id: 'local-1', title: 'Tender Buttons', albumArtist: 'Broadcast', hasArtwork: true, musicBrainzReleaseGroupId: mbid },
    { id: 'local-2', title: 'Same Name', albumArtist: 'Other Artist', hasArtwork: false },
  ], [
    {
      ref: { adapterId: 'lidarr', nativeId: 'album:mbid:a' },
      artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:b' },
      artistName: 'Broadcast',
      title: 'Tender Buttons',
      musicBrainzReleaseGroupId: mbid.toLowerCase(),
    },
    {
      ref: { adapterId: 'lidarr', nativeId: 'album:mbid:c' },
      artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:d' },
      artistName: 'Other Artist',
      title: 'Same Name',
    },
  ], [{
    id: 'wanted-1',
    state: 'wanted',
    artist: 'Broadcast',
    release: 'Tender Buttons',
    musicBrainzReleaseGroupId: mbid,
    searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:mbid:a' }],
    createdAt: '2026-08-09T00:00:00Z',
    updatedAt: '2026-08-09T00:00:00Z',
  }], 'tender')

  assert.equal(items.length, 3)
  const present = items.find(item => item.musicBrainzReleaseGroupId === mbid.toLowerCase())
  assert.equal(present?.state, 'in-library')
  assert.equal(present?.libraryAlbum?.id, 'local-1')
  assert.equal(present?.catalogRelease?.ref.nativeId, 'album:mbid:a')
  assert.equal(present?.acquisition?.id, 'wanted-1')
  assert.equal(items.filter(item => item.title === 'Same Name').length, 2)
})

test('unified releases retain wanted records when catalog lookup is unavailable', () => {
  const [item] = mergeMusicReleases([], [], [{
    id: 'wanted-1',
    state: 'wanted',
    artist: 'Broadcast',
    release: 'Tender Buttons',
    searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:mbid:a' }],
    createdAt: '2026-08-09T00:00:00Z',
    updatedAt: '2026-08-09T00:00:00Z',
  }], 'broadcast')

  assert.equal(item.state, 'wanted')
  assert.equal(item.title, 'Tender Buttons')
})

test('same-title catalog results preserve editions and rank albums before singles', () => {
  const releases = mergeMusicReleases([], [
    {
      ref: { adapterId: 'lidarr', nativeId: 'album:mbid:single' },
      artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:yeule' },
      artistName: 'yeule', title: 'Evangelic Girl Is a Gun', releaseType: 'Single', trackCount: 3,
      releaseDate: '2025-04-08T00:00:00Z', musicBrainzReleaseGroupId: '4292e32e-469a-4c14-a025-3abbef5fd703',
    },
    {
      ref: { adapterId: 'lidarr', nativeId: 'album:mbid:album' },
      artistRef: { adapterId: 'lidarr', nativeId: 'artist:mbid:yeule' },
      artistName: 'yeule', title: 'Evangelic Girl Is a Gun', releaseType: 'Album', trackCount: 10,
      releaseDate: '2025-05-30T00:00:00Z', musicBrainzReleaseGroupId: '325775d4-08d2-411a-b3bb-d7e9e7a0cf92',
    },
  ], [], 'Evangelic Girl Is a Gun')

  assert.equal(releases.length, 2)
  assert.deepEqual(releases.map(item => [item.catalogRelease?.releaseType, item.catalogRelease?.trackCount]), [
    ['Album', 10],
    ['Single', 3],
  ])
})

test('catalog search prioritizes exact artists and albums over covers and remixes', () => {
  const catalog = [
    { ref: { adapterId: 'lidarr', nativeId: 'cover' }, artistRef: { adapterId: 'lidarr', nativeId: 'artist:cover' },
      artistName: 'Piano Dreamers', title: 'Piano Dreamers Play Dua Lipa', releaseType: 'Album' },
    { ref: { adapterId: 'lidarr', nativeId: 'remix' }, artistRef: { adapterId: 'lidarr', nativeId: 'artist:remix' },
      artistName: 'KRAS', title: 'Dua Lipa - Houdini (Remix)', releaseType: 'Single' },
    { ref: { adapterId: 'lidarr', nativeId: 'album' }, artistRef: { adapterId: 'lidarr', nativeId: 'artist:dua' },
      artistName: 'Dua Lipa', title: 'Future Nostalgia', releaseType: 'Album', releaseDate: '2020-03-27' },
    { ref: { adapterId: 'lidarr', nativeId: 'single' }, artistRef: { adapterId: 'lidarr', nativeId: 'artist:dua' },
      artistName: 'Dua Lipa', title: 'Houdini', releaseType: 'Single', releaseDate: '2023-11-09' },
  ]
  const releases = mergeMusicReleases([], catalog, [], 'dua lipa')

  assert.deepEqual(releases.map(item => item.catalogRelease?.ref.nativeId), ['album', 'single', 'cover', 'remix'])
})

test('unified releases project linked import lifecycle without fuzzy identity', () => {
  const base = {
    id: 'wanted-1', artist: 'Broadcast', release: 'Tender Buttons',
    searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:mbid:a' }],
    createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
  }
  assert.equal(mergeMusicReleases([], [], [{ ...base, state: 'importing' }], 'broadcast')[0].state, 'importing')
  assert.equal(mergeMusicReleases([], [], [{ ...base, state: 'selection-required' }], 'broadcast')[0].state, 'selection-required')
  assert.equal(mergeMusicReleases([], [], [{ ...base, state: 'completed' }], 'broadcast')[0].state, 'in-library')
})

test('invalid MusicBrainz values and delimiter-bearing refs cannot collide', () => {
  const items = mergeMusicReleases([], [
    {
      ref: { adapterId: 'a', nativeId: 'b:c' },
      artistRef: { adapterId: 'a', nativeId: 'artist:1' },
      title: 'First',
      musicBrainzReleaseGroupId: 'unknown',
    },
    {
      ref: { adapterId: 'a:b', nativeId: 'c' },
      artistRef: { adapterId: 'a:b', nativeId: 'artist:2' },
      title: 'Second',
      musicBrainzReleaseGroupId: 'unknown',
    },
  ], [], 'release')

  assert.equal(items.length, 2)
  assert.notEqual(items[0].key, items[1].key)
  assert.equal(items.every(item => item.musicBrainzReleaseGroupId === undefined), true)
})

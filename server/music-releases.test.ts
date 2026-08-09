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

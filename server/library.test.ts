import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { IAudioMetadata } from 'music-metadata'
import { listLibraryAlbums, readCanonicalLibrary } from './library.js'

test('canonical library inventory reads tags and retains unreadable audio files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'needle-library-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'Broadcast', 'Tender Buttons'), { recursive: true })
  await writeFile(join(root, 'Broadcast', 'Tender Buttons', '01 I Found the F.flac'), 'audio')
  await writeFile(join(root, 'Broadcast', 'Tender Buttons', '02 Black Cat.mp3'), 'broken')
  await writeFile(join(root, 'Broadcast', 'Tender Buttons', 'cover.jpg'), 'image')

  const readerOptions: unknown[] = []
  const inventory = await readCanonicalLibrary(root, async (path, options) => {
    readerOptions.push(options)
    if (path.endsWith('.mp3')) throw new Error('invalid tags')
    return {
      common: {
        title: 'I Found the F',
        artists: ['Broadcast'],
        albumartist: 'Broadcast',
        album: 'Tender Buttons',
        track: { no: 1, of: 12 },
        disk: { no: 1, of: 1 },
        year: 2005,
      },
      format: {
        duration: 123.5,
        codec: 'FLAC',
        lossless: true,
        sampleRate: 44100,
        numberOfChannels: 2,
      },
      native: {},
      quality: { warnings: [] },
    } as unknown as IAudioMetadata
  })

  assert.equal(inventory.configured, true)
  assert.equal(inventory.mounted, true)
  assert.equal(inventory.tracks.length, 2)
  assert.deepEqual(inventory.tracks[0], {
    relativePath: 'Broadcast/Tender Buttons/01 I Found the F.flac',
    bytes: 5,
    modifiedAt: inventory.tracks[0].modifiedAt,
    format: 'FLAC',
    metadataStatus: 'read',
    title: 'I Found the F',
    artists: ['Broadcast'],
    albumArtist: 'Broadcast',
    album: 'Tender Buttons',
    trackNumber: 1,
    discNumber: 1,
    year: 2005,
    durationSeconds: 123.5,
    codec: 'FLAC',
    bitrate: undefined,
    sampleRate: 44100,
    channels: 2,
    lossless: true,
  })
  assert.equal(inventory.tracks[1].metadataStatus, 'unreadable')
  assert.equal(inventory.tracks[1].title, '02 Black Cat')
  assert.deepEqual(readerOptions, [{ skipCovers: true }, { skipCovers: true }])
  assert.deepEqual(listLibraryAlbums(inventory.tracks), [{
    id: listLibraryAlbums(inventory.tracks)[0].id,
    title: 'Tender Buttons',
    albumArtist: 'Broadcast',
    year: 2005,
    trackCount: 2,
    totalBytes: 11,
    formats: ['FLAC', 'MP3'],
  }])
})

test('canonical library inventory distinguishes unconfigured and missing roots', async () => {
  const unconfigured = await readCanonicalLibrary()
  const missing = await readCanonicalLibrary(join(tmpdir(), 'needle-library-missing'))

  assert.deepEqual(unconfigured, { configured: false, mounted: false, scannedAt: null, tracks: [] })
  assert.deepEqual(missing, { configured: true, mounted: false, scannedAt: null, tracks: [] })
})

test('album grouping joins disc folders but keeps separate album directories distinct', () => {
  const track = {
    bytes: 10,
    modifiedAt: '2026-08-08T00:00:00.000Z',
    format: 'FLAC',
    metadataStatus: 'read' as const,
    title: 'Track',
    albumArtist: 'Artist',
    album: 'Album',
  }
  const albums = listLibraryAlbums([
    { ...track, relativePath: 'Artist/Album/CD 1/01 Track.flac' },
    { ...track, relativePath: 'Artist/Album/CD 2/01 Track.flac' },
    { ...track, relativePath: 'Artist/Album Deluxe/01 Track.flac' },
  ])

  assert.equal(albums.length, 2)
  assert.deepEqual(albums.map(album => album.trackCount).sort(), [1, 2])
})

import { resolve } from 'node:path'
import { buildApp } from '../server/index.js'
import type { LibraryAudioResponse, LibraryCatalogPort, LibraryCatalogTrack } from '../server/integrations/library-catalog.js'

const albumId = 'a'.repeat(32)
const tracks: LibraryCatalogTrack[] = [
  { id: 'b'.repeat(32), title: 'Signal One', artists: ['Arcadia Test Ensemble'], albumId, album: 'Static Bloom', albumArtist: 'Arcadia Test Ensemble', trackNumber: 1, discNumber: 1, durationSeconds: 1, format: 'WAV' },
  { id: 'c'.repeat(32), title: 'Signal Two', artists: ['Arcadia Test Ensemble'], albumId, album: 'Static Bloom', albumArtist: 'Arcadia Test Ensemble', trackNumber: 2, discNumber: 1, durationSeconds: 1, format: 'WAV' },
]

function wavFixture(): Uint8Array {
  const sampleRate = 8_000
  const samples = sampleRate
  const bytes = Buffer.alloc(44 + samples)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + samples, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate, 28)
  bytes.writeUInt16LE(1, 32)
  bytes.writeUInt16LE(8, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples, 40)
  for (let index = 0; index < samples; index += 1) {
    bytes[44 + index] = 128 + Math.round(Math.sin(index / sampleRate * Math.PI * 440) * 18)
  }
  return bytes
}

const audio = wavFixture()

function audioResponse(range: string | undefined): LibraryAudioResponse {
  if (!range) return {
    status: 200,
    contentType: 'audio/wav',
    contentLength: String(audio.byteLength),
    acceptRanges: 'bytes',
    body: new Response(audio).body!,
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range)
  if (!match) return { status: 416, contentRange: `bytes */${audio.byteLength}`, acceptRanges: 'bytes' }
  const start = Number(match[1])
  const end = Math.min(match[2] ? Number(match[2]) : audio.byteLength - 1, audio.byteLength - 1)
  if (start > end || start >= audio.byteLength) return { status: 416, contentRange: `bytes */${audio.byteLength}`, acceptRanges: 'bytes' }
  const body = audio.slice(start, end + 1)
  return {
    status: 206,
    contentType: 'audio/wav',
    contentLength: String(body.byteLength),
    contentRange: `bytes ${start}-${end}/${audio.byteLength}`,
    acceptRanges: 'bytes',
    body: new Response(body).body!,
  }
}

const jellyfin: LibraryCatalogPort = {
  async listAlbums() {
    return { items: [{ id: albumId, title: 'Static Bloom', albumArtist: 'Arcadia Test Ensemble', year: 2026, trackCount: tracks.length, hasArtwork: false }], total: 1 }
  },
  async listArtists() {
    return { items: [{ name: 'Arcadia Test Ensemble', albumCount: 1, representativeAlbumId: albumId }], total: 1 }
  },
  async listTracks() {
    return { items: tracks, total: tracks.length }
  },
  async listAlbumTracks(requestedAlbumId) {
    return requestedAlbumId === albumId ? { items: tracks, total: tracks.length } : { items: [], total: 0 }
  },
  async getAlbumArtwork() {
    return null
  },
  async getTrackAudio(trackId, range) {
    return tracks.some(track => track.id === trackId) ? audioResponse(range) : null
  },
}

const app = buildApp({
  logger: false,
  staticRoot: resolve('dist'),
  publicUrl: 'http://127.0.0.1:8790',
  catalog: null,
  jellyfin,
  beets: null,
  acquisitionRepository: { list: () => [], wantRelease: () => { throw new Error('Not available in browser fixtures') } },
  directAcquisition: null,
  slskd: null,
  visualScores: null,
})

await app.listen({ host: '127.0.0.1', port: 8790 })

async function stop() {
  await app.close()
  process.exit(0)
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)

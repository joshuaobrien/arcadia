import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, relative, resolve, sep } from 'node:path'
import { parseFile } from 'music-metadata'
import type { IAudioMetadata, IOptions } from 'music-metadata'

const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.aiff',
  '.alac',
  '.ape',
  '.dsf',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
  '.wma',
])

export interface LibraryTrack {
  relativePath: string
  bytes: number
  modifiedAt: string
  format: string
  metadataStatus: 'read' | 'unreadable'
  title?: string
  artists?: readonly string[]
  albumArtist?: string
  album?: string
  trackNumber?: number
  discNumber?: number
  year?: number
  durationSeconds?: number
  codec?: string
  bitrate?: number
  sampleRate?: number
  channels?: number
  lossless?: boolean
}

export interface LibraryInventory {
  configured: boolean
  mounted: boolean
  scannedAt: string | null
  tracks: readonly LibraryTrack[]
}

export interface LibraryAlbum {
  id: string
  title: string
  albumArtist: string
  year?: number
  trackCount: number
  totalBytes: number
  formats: readonly string[]
}

type MetadataReader = (path: string, options?: IOptions) => Promise<IAudioMetadata>

export async function readCanonicalLibrary(
  configuredPath?: string,
  readMetadata: MetadataReader = parseFile,
): Promise<LibraryInventory> {
  if (!configuredPath) return { configured: false, mounted: false, scannedAt: null, tracks: [] }
  const root = resolve(configuredPath)

  try {
    const paths = await collectAudioPaths(root)
    const tracks = new Array<LibraryTrack | null>(paths.length)
    let cursor = 0
    const workers = Array.from({ length: Math.min(8, paths.length) }, async () => {
      while (cursor < paths.length) {
        const index = cursor++
        tracks[index] = await readTrack(root, paths[index], readMetadata)
      }
    })
    await Promise.all(workers)
    return {
      configured: true,
      mounted: true,
      scannedAt: new Date().toISOString(),
      tracks: tracks.filter(track => track !== null),
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) {
      return { configured: true, mounted: false, scannedAt: null, tracks: [] }
    }
    throw error
  }
}

export function listLibraryAlbums(tracks: readonly LibraryTrack[]): LibraryAlbum[] {
  const albums = new Map<string, LibraryAlbum & { formatSet: Set<string> }>()
  for (const track of tracks) {
    const id = libraryAlbumId(track)
    const existing = albums.get(id)
    if (existing) {
      existing.trackCount += 1
      existing.totalBytes += track.bytes
      existing.formatSet.add(track.format)
      if (!existing.year && track.year) existing.year = track.year
      continue
    }
    const directory = libraryAlbumDirectory(track).split('/')
    albums.set(id, {
      id,
      title: track.album ?? directory.at(-1) ?? 'Unfiled',
      albumArtist: track.albumArtist ?? track.artists?.[0] ?? directory.at(-2) ?? 'Unknown artist',
      year: track.year,
      trackCount: 1,
      totalBytes: track.bytes,
      formats: [],
      formatSet: new Set([track.format]),
    })
  }
  return [...albums.values()]
    .map(({ formatSet, ...album }) => ({ ...album, formats: [...formatSet].sort() }))
    .sort((left, right) => {
      const leftKey = `${left.albumArtist}\0${left.title}\0${left.year ?? 0}`
      const rightKey = `${right.albumArtist}\0${right.title}\0${right.year ?? 0}`
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
}

export function libraryAlbumId(track: LibraryTrack): string {
  return createHash('sha256').update(libraryAlbumDirectory(track)).digest('hex')
}

function libraryAlbumDirectory(track: LibraryTrack): string {
  const segments = track.relativePath.split('/')
  segments.pop()
  if (/^(disc|cd)[ _-]*\d+$/i.test(segments.at(-1) ?? '')) segments.pop()
  return segments.join('/') || track.relativePath
}

async function collectAudioPaths(root: string): Promise<string[]> {
  const paths: string[] = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()!
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (directory !== root && (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR'))) continue
      throw error
    }
    for (const entry of entries) {
      const entryPath = resolve(directory, entry.name)
      if (entry.isDirectory()) pending.push(entryPath)
      else if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) paths.push(entryPath)
    }
  }
  return paths.sort()
}

async function readTrack(root: string, path: string, readMetadata: MetadataReader): Promise<LibraryTrack | null> {
  let file
  try {
    file = await stat(path)
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) return null
    throw error
  }
  const relativePath = relative(root, path).split(sep).join('/')
  const extension = extname(path)
  const base = {
    relativePath,
    bytes: file.size,
    modifiedAt: file.mtime.toISOString(),
    format: extension.slice(1).toUpperCase(),
  }

  try {
    const metadata = await readMetadata(path, { skipCovers: true })
    const { common, format } = metadata
    return {
      ...base,
      metadataStatus: 'read',
      title: common.title ?? basename(path, extension),
      artists: common.artists ?? (common.artist ? [common.artist] : undefined),
      albumArtist: common.albumartist,
      album: common.album,
      trackNumber: common.track.no ?? undefined,
      discNumber: common.disk.no ?? undefined,
      year: common.year,
      durationSeconds: format.duration,
      codec: format.codec,
      bitrate: format.bitrate,
      sampleRate: format.sampleRate,
      channels: format.numberOfChannels,
      lossless: format.lossless,
    }
  } catch {
    return { ...base, metadataStatus: 'unreadable', title: basename(path, extension) }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

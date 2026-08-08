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

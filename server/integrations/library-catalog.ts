import type { OperationContext, Page, PageRequest } from './common.js'

export interface LibraryAlbum {
  id: string
  title: string
  albumArtist: string
  musicBrainzReleaseGroupId?: string
  year?: number
  trackCount?: number
  hasArtwork: boolean
}

export interface LibraryArtist {
  name: string
  albumCount: number
  representativeAlbumId?: string
}

export interface LibraryCatalogTrack {
  id: string
  title: string
  artists: readonly string[]
  albumId?: string
  album?: string
  albumArtist?: string
  trackNumber?: number
  discNumber?: number
  durationSeconds?: number
  format?: string
  bytes?: number
}

export interface LibraryArtwork {
  contentType: string
  data: Uint8Array
}

export type LibraryAudioResponse = {
  status: 200 | 206
  contentType: string
  contentLength?: string
  contentRange?: string
  acceptRanges?: string
  body: ReadableStream<Uint8Array>
} | {
  status: 416
  contentRange?: string
  acceptRanges?: string
}

export interface LibraryCatalogQuery extends PageRequest {
  term?: string
  fresh?: boolean
}

export type LibraryAlbumQuery = LibraryCatalogQuery

export interface LibraryTrackPageRequest extends PageRequest {
  fresh?: boolean
}

/** Read-only metadata projection. Canonical audio bytes remain on the filesystem. */
export interface LibraryCatalogPort {
  listAlbums(query: LibraryAlbumQuery, context: OperationContext): Promise<Page<LibraryAlbum> & { total: number }>
  listArtists(query: LibraryCatalogQuery, context: OperationContext): Promise<Page<LibraryArtist> & { total: number }>
  listTracks(query: LibraryCatalogQuery, context: OperationContext): Promise<Page<LibraryCatalogTrack> & { total: number }>
  listAlbumTracks(albumId: string, page: LibraryTrackPageRequest, context: OperationContext): Promise<Page<LibraryCatalogTrack> & { total: number }>
  getAlbumArtwork(albumId: string, context: OperationContext): Promise<LibraryArtwork | null>
  getTrackAudio(trackId: string, range: string | undefined, context: OperationContext): Promise<LibraryAudioResponse | null>
}

export interface LibraryCatalogRefreshPort {
  refreshLibrary(context: OperationContext): Promise<void>
}

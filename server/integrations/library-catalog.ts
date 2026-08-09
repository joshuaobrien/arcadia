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

export interface LibraryCatalogTrack {
  id: string
  title: string
  artists: readonly string[]
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

export interface LibraryAlbumQuery extends PageRequest {
  term?: string
  fresh?: boolean
}

export interface LibraryTrackPageRequest extends PageRequest {
  fresh?: boolean
}

/** Read-only metadata projection. Canonical audio bytes remain on the filesystem. */
export interface LibraryCatalogPort {
  listAlbums(query: LibraryAlbumQuery, context: OperationContext): Promise<Page<LibraryAlbum> & { total: number }>
  listAlbumTracks(albumId: string, page: LibraryTrackPageRequest, context: OperationContext): Promise<Page<LibraryCatalogTrack> & { total: number }>
  getAlbumArtwork(albumId: string, context: OperationContext): Promise<LibraryArtwork | null>
}

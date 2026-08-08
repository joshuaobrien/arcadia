import type { OperationContext, Page, PageRequest } from './common.js'

export interface LibraryAlbum {
  id: string
  title: string
  albumArtist: string
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

/** Read-only metadata projection. Canonical audio bytes remain on the filesystem. */
export interface LibraryCatalogPort {
  listAlbums(page: PageRequest, context: OperationContext): Promise<Page<LibraryAlbum> & { total: number }>
  listAlbumTracks(albumId: string, page: PageRequest, context: OperationContext): Promise<Page<LibraryCatalogTrack> & { total: number }>
  getAlbumArtwork(albumId: string, context: OperationContext): Promise<LibraryArtwork | null>
}

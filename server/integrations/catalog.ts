import type { OperationContext, ProviderRef, ServiceAdapter } from './common.js'

export interface CatalogArtist {
  ref: ProviderRef
  name: string
  sortName?: string
  disambiguation?: string
  musicBrainzArtistId?: string
  images?: readonly string[]
}

export interface CatalogRelease {
  ref: ProviderRef
  artistRef: ProviderRef
  artistName?: string
  title: string
  releaseDate?: string
  releaseType?: string
  secondaryTypes?: readonly string[]
  trackCount?: number
  musicBrainzReleaseGroupId?: string
  monitored?: boolean
  images?: readonly string[]
}

export interface CatalogLookupPort extends ServiceAdapter {
  lookupArtists(term: string, context: OperationContext): Promise<readonly CatalogArtist[]>
  lookupReleases(term: string, context: OperationContext): Promise<readonly CatalogRelease[]>
  listArtistReleases(artist: ProviderRef, context: OperationContext): Promise<readonly CatalogRelease[]>
}

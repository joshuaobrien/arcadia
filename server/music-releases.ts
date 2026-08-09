import type { AcquisitionJob } from './domain/acquisition.js'
import type { CatalogRelease } from './integrations/catalog.js'
import type { LibraryAlbum } from './integrations/library-catalog.js'

export type MusicReleaseState = 'in-library' | 'wanted' | 'importing' | 'selection-required' | 'can-request'

export interface MusicRelease {
  key: string
  title: string
  artist: string
  year?: number
  state: MusicReleaseState
  musicBrainzReleaseGroupId?: string
  libraryAlbum?: LibraryAlbum
  catalogRelease?: CatalogRelease
  acquisition?: AcquisitionJob
}

/** Combines provider projections only when their stable MusicBrainz identity agrees. */
export function mergeMusicReleases(
  libraryAlbums: readonly LibraryAlbum[],
  catalogReleases: readonly CatalogRelease[],
  acquisitions: readonly AcquisitionJob[],
  term: string,
): MusicRelease[] {
  const result = new Map<string, MusicRelease>()
  const wantedByMbid = indexByMbid(acquisitions)
  const wantedByRef = new Map(acquisitions.flatMap(job => job.searchRefs.map(ref => [refKey(ref), job])))

  for (const album of libraryAlbums) {
    const identity = normalizedMbid(album.musicBrainzReleaseGroupId)
    const acquisition = identity ? wantedByMbid.get(identity) : undefined
    const key = identity ? `mbid:${identity}` : `library:${album.id}`
    result.set(key, {
      key,
      title: album.title,
      artist: album.albumArtist,
      year: album.year,
      state: releaseState(acquisition, true),
      musicBrainzReleaseGroupId: identity,
      libraryAlbum: album,
      acquisition,
    })
  }

  for (const release of catalogReleases) {
    const identity = normalizedMbid(release.musicBrainzReleaseGroupId)
    const key = identity ? `mbid:${identity}` : `catalog:${refKey(release.ref)}`
    const existing = result.get(key)
    const acquisition = (identity ? wantedByMbid.get(identity) : undefined) ?? wantedByRef.get(refKey(release.ref))
    result.set(key, {
      key,
      title: existing?.title ?? release.title,
      artist: existing?.artist ?? release.artistName ?? 'Unknown artist',
      year: existing?.year ?? releaseYear(release.releaseDate),
      state: acquisition ? releaseState(acquisition, Boolean(existing?.libraryAlbum)) : existing?.libraryAlbum ? 'in-library' : 'can-request',
      musicBrainzReleaseGroupId: identity,
      libraryAlbum: existing?.libraryAlbum,
      catalogRelease: release,
      acquisition,
    })
  }

  const normalizedTerm = term.trim().toLowerCase()
  for (const acquisition of acquisitions) {
    const identity = normalizedMbid(acquisition.musicBrainzReleaseGroupId)
    const key = identity ? `mbid:${identity}` : `acquisition:${acquisition.id}`
    if (result.has(key) || !matches(acquisition.release, acquisition.artist, normalizedTerm)) continue
    result.set(key, {
      key,
      title: acquisition.release ?? 'Unknown release',
      artist: acquisition.artist ?? 'Unknown artist',
      state: releaseState(acquisition, false),
      musicBrainzReleaseGroupId: identity,
      acquisition,
    })
  }

  return [...result.values()].sort((left, right) => compareTuple(
    [left.artist, left.year?.toString() ?? '', left.title, left.key],
    [right.artist, right.year?.toString() ?? '', right.title, right.key],
  ))
}

function releaseState(acquisition: AcquisitionJob | undefined, inLibrary: boolean): MusicReleaseState {
  if (inLibrary || acquisition?.state === 'completed') return 'in-library'
  if (acquisition?.state === 'importing') return 'importing'
  if (acquisition?.state === 'selection-required') return 'selection-required'
  return 'wanted'
}

function indexByMbid(acquisitions: readonly AcquisitionJob[]): Map<string, AcquisitionJob> {
  const result = new Map<string, AcquisitionJob>()
  for (const acquisition of acquisitions) {
    const identity = normalizedMbid(acquisition.musicBrainzReleaseGroupId)
    if (identity) result.set(identity, acquisition)
  }
  return result
}

function normalizedMbid(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : undefined
}

function refKey(ref: { adapterId: string; nativeId: string }): string {
  return JSON.stringify([ref.adapterId, ref.nativeId])
}

function releaseYear(value?: string): number | undefined {
  const year = value?.match(/^\d{4}/)?.[0]
  return year ? Number(year) : undefined
}

function matches(release: string | undefined, artist: string | undefined, term: string): boolean {
  return !term || release?.toLowerCase().includes(term) === true || artist?.toLowerCase().includes(term) === true
}

function compareTuple(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const comparison = left[index].localeCompare(right[index])
    if (comparison) return comparison
  }
  return 0
}

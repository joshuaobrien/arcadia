import type { OperationContext, PageRequest } from './common.js'
import { AdapterError } from './errors.js'
import type { LibraryAlbum, LibraryAlbumQuery, LibraryArtist, LibraryArtwork, LibraryAudioResponse, LibraryCatalogPort, LibraryCatalogQuery, LibraryCatalogRefreshPort, LibraryCatalogTrack, LibraryTrackPageRequest } from './library-catalog.js'

type JsonObject = Record<string, unknown>
type Fetch = typeof globalThis.fetch
const MAX_ARTWORK_BYTES = 5 * 1024 * 1024

interface JellyfinOptions {
  baseUrl: string
  apiKey: string
  fetch?: Fetch
  timeoutMs?: number
}

interface JellyfinPage {
  Items?: JsonObject[]
  TotalRecordCount?: number
  StartIndex?: number
}

export class JellyfinAdapter implements LibraryCatalogPort, LibraryCatalogRefreshPort {
  readonly #baseUrl: URL
  readonly #apiKey: string
  readonly #fetch: Fetch
  readonly #timeoutMs: number
  #albumsCache?: { expiresAt: number; value: Promise<LibraryAlbum[]> }
  readonly #tracksCache = new Map<string, { expiresAt: number; value: Promise<LibraryCatalogTrack[]> }>()

  constructor(options: JellyfinOptions) {
    if (!options.apiKey.trim()) throw new Error('Jellyfin API key is required')
    const baseUrl = new URL(options.baseUrl)
    if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('Jellyfin URL must use HTTP or HTTPS')
    this.#baseUrl = new URL(`${baseUrl.toString().replace(/\/$/, '')}/`)
    this.#apiKey = options.apiKey
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? 10_000
  }

  async listAlbums(query: LibraryAlbumQuery, context: OperationContext) {
    const offset = pageOffset(query)
    const albums = await this.#allAlbums(context, query.fresh)
    const term = query.term?.trim().toLowerCase()
    const matches = term
      ? albums.filter(item => item.title.toLowerCase().includes(term) || item.albumArtist.toLowerCase().includes(term))
      : albums
    const end = Math.min(matches.length, offset + query.limit)
    return { items: matches.slice(offset, end), total: matches.length, ...(end < matches.length ? { nextCursor: String(end) } : {}) }
  }

  async listArtists(query: LibraryCatalogQuery, context: OperationContext) {
    const offset = pageOffset(query)
    const groups = new Map<string, { names: string[], albumIds: string[] }>()
    for (const item of await this.#allAlbums(context, query.fresh)) {
      const key = item.albumArtist.toLowerCase()
      const group = groups.get(key) ?? { names: [], albumIds: [] }
      group.names.push(item.albumArtist)
      group.albumIds.push(item.id)
      groups.set(key, group)
    }
    const term = query.term?.trim().toLowerCase()
    const matches: LibraryArtist[] = [...groups.values()].map(group => {
      group.names.sort()
      group.albumIds.sort()
      return { name: group.names[0], albumCount: group.albumIds.length, representativeAlbumId: group.albumIds[0] }
    }).filter(item => !term || item.name.toLowerCase().includes(term))
      .sort((left, right) => compareTuple([left.name.toLowerCase(), left.name], [right.name.toLowerCase(), right.name]))
    const end = Math.min(matches.length, offset + query.limit)
    return { items: matches.slice(offset, end), total: matches.length, ...(end < matches.length ? { nextCursor: String(end) } : {}) }
  }

  async listTracks(query: LibraryCatalogQuery, context: OperationContext) {
    const offset = pageOffset(query)
    const term = query.term?.trim()
    const response = await this.#json<JellyfinPage>('Items', {
      IncludeItemTypes: 'Audio',
      Recursive: 'true',
      EnableImages: 'false',
      EnableUserData: 'false',
      Fields: 'MediaSources',
      SortBy: 'SortName,IndexNumber',
      SortOrder: 'Ascending',
      StartIndex: offset,
      Limit: query.limit,
      ...(term ? { SearchTerm: term } : {}),
    }, context)
    const items = (response.Items ?? []).map(track)
    const total = response.TotalRecordCount ?? items.length
    const end = offset + items.length
    return { items, total, ...(items.length > 0 && end < total ? { nextCursor: String(end) } : {}) }
  }

  async listAlbumTracks(albumId: string, page: LibraryTrackPageRequest, context: OperationContext) {
    assertItemId(albumId)
    const offset = pageOffset(page)
    const tracks = await this.#allAlbumTracks(albumId, context, page.fresh)
    const end = Math.min(tracks.length, offset + page.limit)
    return { items: tracks.slice(offset, end), total: tracks.length, ...(end < tracks.length ? { nextCursor: String(end) } : {}) }
  }

  async getAlbumArtwork(albumId: string, context: OperationContext): Promise<LibraryArtwork | null> {
    assertItemId(albumId)
    const response = await this.#request(`Items/${albumId}/Images/Primary`, {
      maxWidth: 600,
      maxHeight: 600,
      quality: 88,
      format: 'jpg',
    }, context, 'image/*')
    if (response.status === 404) return null
    if (!response.ok) throw this.#responseError(response.status)
    const data = await readBounded(response, MAX_ARTWORK_BYTES)
    const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? ''
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) {
      throw new AdapterError({
        code: 'transient-provider-failure',
        adapterId: 'jellyfin',
        message: 'Jellyfin returned an unsupported artwork format',
        retryable: false,
      })
    }
    return { contentType, data }
  }

  async getTrackAudio(trackId: string, range: string | undefined, context: OperationContext): Promise<LibraryAudioResponse | null> {
    assertItemId(trackId)
    if (range !== undefined && !isSingleByteRange(range)) throw new Error('Invalid byte range')
    const response = await this.#request(`Audio/${trackId}/stream`, { static: 'true' }, context, 'audio/*',
      range === undefined ? undefined : { Range: range })
    if (response.status === 404) return null
    if (response.status === 416) {
      await response.body?.cancel()
      return {
        status: 416,
        ...optionalHeader(response, 'content-range', 'contentRange'),
        ...optionalHeader(response, 'accept-ranges', 'acceptRanges'),
      }
    }
    if (response.status !== 200 && response.status !== 206) throw this.#responseError(response.status)
    if (!response.body) throw this.#responseError(response.status)
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      ...optionalHeader(response, 'content-length', 'contentLength'),
      ...optionalHeader(response, 'content-range', 'contentRange'),
      ...optionalHeader(response, 'accept-ranges', 'acceptRanges'),
      body: response.body,
    }
  }

  async refreshLibrary(context: OperationContext): Promise<void> {
    const response = await this.#request('Library/Refresh', {}, context, 'application/json', undefined, 'POST')
    if (!response.ok) throw this.#responseError(response.status)
    this.#albumsCache = undefined
    this.#tracksCache.clear()
  }

  async #allAlbums(context: OperationContext, fresh = false): Promise<LibraryAlbum[]> {
    if (fresh) this.#albumsCache = undefined
    if (this.#albumsCache && this.#albumsCache.expiresAt > Date.now()) return this.#albumsCache.value
    const value = this.#json<JellyfinPage>('Items', {
      IncludeItemTypes: 'MusicAlbum',
      Recursive: 'true',
      EnableImages: 'true',
      EnableImageTypes: 'Primary',
      ImageTypeLimit: 1,
      EnableUserData: 'false',
      Fields: 'ChildCount,ProviderIds',
    }, context).then(response => (response.Items ?? []).map(album).sort(compareAlbums))
    const entry = { expiresAt: Date.now() + 5 * 60_000, value }
    this.#albumsCache = entry
    value.catch(() => {
      if (this.#albumsCache === entry) this.#albumsCache = undefined
    })
    return value
  }

  async #allAlbumTracks(albumId: string, context: OperationContext, fresh = false): Promise<LibraryCatalogTrack[]> {
    if (fresh) this.#tracksCache.delete(albumId)
    const hit = this.#tracksCache.get(albumId)
    if (hit && hit.expiresAt > Date.now()) return hit.value
    for (const [id, entry] of this.#tracksCache) {
      if (entry.expiresAt <= Date.now()) this.#tracksCache.delete(id)
    }
    if (this.#tracksCache.size >= 100) {
      const oldest = this.#tracksCache.keys().next().value
      if (oldest) this.#tracksCache.delete(oldest)
    }
    const value = this.#json<JellyfinPage>('Items', {
      ParentId: albumId,
      IncludeItemTypes: 'Audio',
      Recursive: 'true',
      EnableImages: 'false',
      EnableUserData: 'false',
      Fields: 'MediaSources',
    }, context).then(response => (response.Items ?? []).map(track).sort(compareTracks))
    const entry = { expiresAt: Date.now() + 5 * 60_000, value }
    this.#tracksCache.set(albumId, entry)
    value.catch(() => {
      if (this.#tracksCache.get(albumId) === entry) this.#tracksCache.delete(albumId)
    })
    return value
  }

  async #json<T>(path: string, query: Record<string, string | number>, context: OperationContext): Promise<T> {
    const response = await this.#request(path, query, context, 'application/json')
    if (!response.ok) throw this.#responseError(response.status)
    try {
      return await response.json() as T
    } catch (error) {
      throw new AdapterError({
        code: 'transient-provider-failure',
        adapterId: 'jellyfin',
        message: 'Jellyfin returned an invalid response',
        retryable: true,
        providerStatus: response.status,
      }, { cause: error })
    }
  }

  async #request(
    path: string,
    query: Record<string, string | number>,
    context: OperationContext,
    accept: string,
    extraHeaders?: Record<string, string>,
    method = 'GET',
  ): Promise<Response> {
    const url = new URL(path, this.#baseUrl)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), this.#timeoutMs)
    timer.unref()
    const signal = context.signal ? AbortSignal.any([context.signal, timeout.signal]) : timeout.signal
    try {
      return await this.#fetch(url, {
        method,
        signal,
        headers: {
          Accept: accept,
          Authorization: `MediaBrowser Token="${this.#apiKey}"`,
          'X-Needle-Operation-Id': context.operationId,
          ...extraHeaders,
        },
      })
    } catch (error) {
      throw new AdapterError({
        code: 'unavailable',
        adapterId: 'jellyfin',
        message: 'Jellyfin is unavailable',
        retryable: true,
      }, { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }

  #responseError(status: number): AdapterError {
    return new AdapterError({
      code: status === 401 || status === 403 ? 'authentication' : status === 404 ? 'not-found' : 'transient-provider-failure',
      adapterId: 'jellyfin',
      message: `Jellyfin request failed with status ${status}`,
      retryable: status >= 500 || status === 429,
      providerStatus: status,
    })
  }
}

function isSingleByteRange(value: string): boolean {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return false
  if (match[1] && match[2] && BigInt(match[1]) > BigInt(match[2])) return false
  return true
}

function optionalHeader(response: Response, header: string, property: string): Record<string, string> {
  const value = response.headers.get(header)
  return value === null ? {} : { [property]: value }
}

export function createJellyfinAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): JellyfinAdapter | null {
  if (!env.JELLYFIN_URL || !env.JELLYFIN_API_KEY) return null
  return new JellyfinAdapter({ baseUrl: env.JELLYFIN_URL, apiKey: env.JELLYFIN_API_KEY })
}

function album(value: JsonObject): LibraryAlbum {
  const imageTags = object(value.ImageTags)
  const providerIds = object(value.ProviderIds)
  const musicBrainzReleaseGroupId = optionalString(providerIds.MusicBrainzReleaseGroup)
  return {
    id: string(value.Id),
    title: string(value.Name),
    albumArtist: string(value.AlbumArtist) || string(array(value.AlbumArtists)[0]?.Name) || 'Unknown artist',
    ...(musicBrainzReleaseGroupId ? { musicBrainzReleaseGroupId } : {}),
    year: optionalNumber(value.ProductionYear),
    trackCount: optionalNumber(value.ChildCount),
    hasArtwork: typeof imageTags.Primary === 'string' && imageTags.Primary.length > 0,
  }
}

function track(value: JsonObject): LibraryCatalogTrack {
  const source = object(array(value.MediaSources)[0])
  const runtimeTicks = optionalNumber(value.RunTimeTicks)
  const albumId = optionalString(value.AlbumId)
  const albumTitle = optionalString(value.Album)
  const albumArtist = optionalString(value.AlbumArtist) ?? optionalString(array(value.AlbumArtists)[0]?.Name)
  return {
    id: string(value.Id),
    title: string(value.Name),
    artists: stringArray(value.Artists),
    ...(albumId ? { albumId } : {}),
    ...(albumTitle ? { album: albumTitle } : {}),
    ...(albumArtist ? { albumArtist } : {}),
    trackNumber: optionalNumber(value.IndexNumber),
    discNumber: optionalNumber(value.ParentIndexNumber),
    durationSeconds: runtimeTicks === undefined ? undefined : runtimeTicks / 10_000_000,
    format: string(source.Container).toUpperCase() || undefined,
    bytes: optionalNumber(source.Size),
  }
}

function compareAlbums(left: LibraryAlbum, right: LibraryAlbum): number {
  return compareTuple([left.albumArtist, left.title, left.id], [right.albumArtist, right.title, right.id])
}

function compareTracks(left: LibraryCatalogTrack, right: LibraryCatalogTrack): number {
  return compareTuple([
    String(left.discNumber ?? 0).padStart(6, '0'),
    String(left.trackNumber ?? 0).padStart(6, '0'),
    left.title,
    left.id,
  ], [
    String(right.discNumber ?? 0).padStart(6, '0'),
    String(right.trackNumber ?? 0).padStart(6, '0'),
    right.title,
    right.id,
  ])
}

function compareTuple(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1
    if (left[index] > right[index]) return 1
  }
  return 0
}

function pageOffset(page: PageRequest): number {
  if (page.limit < 1 || page.limit > 100) throw new Error('Page limit must be between 1 and 100')
  if (!page.cursor) return 0
  if (!/^(0|[1-9]\d*)$/.test(page.cursor)) throw new Error('Invalid page cursor')
  return Number(page.cursor)
}

function assertItemId(value: string): void {
  if (!/^[a-fA-F0-9-]{32,36}$/.test(value)) throw new Error('Invalid Jellyfin item ID')
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Jellyfin artwork exceeds the size limit')
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Jellyfin artwork exceeds the size limit')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function number(value: unknown): number {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function optionalNumber(value: unknown): number | undefined {
  const result = Number(value)
  return value !== undefined && value !== null && Number.isFinite(result) ? result : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function array(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(object) : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(string).filter(Boolean) : []
}

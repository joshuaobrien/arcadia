import type {
  AcquisitionAutomationPort,
  AcquisitionHistoryItem,
  AcquisitionProfile,
  AcquisitionQueueItem,
  AcquisitionQueueState,
  AcquisitionRoot,
  AcquisitionSearchTarget,
  AddArtistRequest,
  EnsureReleaseRequest,
  RemoteJob,
} from './acquisition.js'
import type {
  CatalogArtist,
  CatalogLookupPort,
  CatalogRelease,
} from './catalog.js'
import type {
  AdapterHealth,
  OperationContext,
  Page,
  PageRequest,
  ProviderRef,
  ServicePath,
} from './common.js'
import { AdapterError } from './errors.js'

type JsonObject = Record<string, unknown>
type Fetch = typeof globalThis.fetch

export interface LidarrOptions {
  adapterId?: string
  baseUrl: string
  apiKey: string
  fetch?: Fetch
  timeoutMs?: number
  musicBrainzBaseUrl?: string
  pathMappings?: readonly {
    id: string
    providerPrefix: string
    needlePrefix: string
  }[]
}

interface PagingResource {
  page: number
  pageSize: number
  totalRecords: number
  records: JsonObject[]
}

interface MusicBrainzReleaseGroupPage {
  'release-group-count': number
  'release-groups': JsonObject[]
}

export class LidarrAdapter implements CatalogLookupPort, AcquisitionAutomationPort {
  readonly adapterId: string
  readonly kind = 'lidarr' as const

  readonly #baseUrl: URL
  readonly #apiKey: string
  readonly #fetch: Fetch
  readonly #timeoutMs: number
  readonly #musicBrainzBaseUrl: URL
  readonly #pathMappings: LidarrOptions['pathMappings']

  constructor(options: LidarrOptions) {
    if (!options.apiKey.trim()) throw new Error('Lidarr API key is required')

    const baseUrl = new URL(options.baseUrl)
    if (!['http:', 'https:'].includes(baseUrl.protocol)) {
      throw new Error('Lidarr URL must use HTTP or HTTPS')
    }

    this.adapterId = options.adapterId ?? 'lidarr'
    this.#baseUrl = new URL(`${baseUrl.toString().replace(/\/$/, '')}/api/v1/`)
    this.#apiKey = options.apiKey
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? 10_000
    this.#musicBrainzBaseUrl = new URL(options.musicBrainzBaseUrl ?? 'https://musicbrainz.org/ws/2/')
    this.#pathMappings = options.pathMappings ?? []
  }

  async probe(context: OperationContext): Promise<AdapterHealth> {
    const started = performance.now()
    try {
      const status = await this.#request<JsonObject>('system/status', {}, context)
      return {
        adapterId: this.adapterId,
        kind: this.kind,
        state: 'available',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        version: string(status.version),
        apiVersion: 'v1',
      }
    } catch (error) {
      if (error instanceof AdapterError && error.code !== 'authentication') {
        return {
          adapterId: this.adapterId,
          kind: this.kind,
          state: 'unavailable',
          checkedAt: new Date().toISOString(),
          latencyMs: Math.round(performance.now() - started),
          apiVersion: 'v1',
          message: error.message,
        }
      }
      throw error
    }
  }

  async lookupArtists(term: string, context: OperationContext): Promise<readonly CatalogArtist[]> {
    if (!term.trim()) throw this.#error('invalid-request', 'Artist search term is required', false)
    const artists = await this.#request<JsonObject[]>('artist/lookup', { term }, context)
    return artists.map((artist) => this.#artist(artist))
  }

  async lookupReleases(term: string, context: OperationContext): Promise<readonly CatalogRelease[]> {
    if (!term.trim()) throw this.#error('invalid-request', 'Release search term is required', false)
    const albums = await this.#request<JsonObject[]>('album/lookup', { term }, context)
    return albums.map((album) => this.#album(album))
  }

  async listArtistReleases(artist: ProviderRef, context: OperationContext): Promise<readonly CatalogRelease[]> {
    this.#assertAdapter(artist)
    if (artist.nativeId.startsWith('artist:id:')) {
      const albums = await this.#request<JsonObject[]>('album', { artistId: this.#numericId(artist, 'artist') }, context)
      return albums.map((album) => this.#album(album))
    }

    const artistMbid = this.#foreignId(artist, 'artist').toLowerCase()
    if (!isMusicBrainzId(artistMbid)) {
      throw this.#error('invalid-request', 'artist requires a valid MusicBrainz ID', false)
    }
    const releases: CatalogRelease[] = []
    let offset = 0
    do {
      const page = await this.#musicBrainzRequest(artistMbid, offset, context)
      releases.push(...page['release-groups'].map(release => this.#musicBrainzRelease(release, artistMbid)))
      offset += page['release-groups'].length
      if (page['release-groups'].length === 0 || offset >= page['release-group-count']) break
    } while (true)
    return releases
  }

  async listProfiles(context: OperationContext): Promise<readonly AcquisitionProfile[]> {
    const [quality, metadata] = await Promise.all([
      this.#request<JsonObject[]>('qualityprofile', {}, context),
      this.#request<JsonObject[]>('metadataprofile', {}, context),
    ])
    return [
      ...quality.map((profile) => this.#profile(profile, 'quality')),
      ...metadata.map((profile) => this.#profile(profile, 'metadata')),
    ]
  }

  async listRoots(context: OperationContext): Promise<readonly AcquisitionRoot[]> {
    const roots = await this.#request<JsonObject[]>('rootfolder', {}, context)
    return roots.map((root) => ({
      ref: this.#ref('root', number(root.id)),
      path: this.#path(string(root.path)),
      freeBytes: optionalNumber(root.freeSpace),
    }))
  }

  async addArtist(request: AddArtistRequest, context: OperationContext): Promise<CatalogArtist> {
    const rootId = this.#numericId(request.root, 'root')
    const root = await this.#request<JsonObject>(`rootfolder/${rootId}`, {}, context)
    const qualityProfileId = this.#numericId(request.qualityProfile, 'profile:quality')
    const metadataProfileId = request.metadataProfile
      ? this.#numericId(request.metadataProfile, 'profile:metadata')
      : number(root.defaultMetadataProfileId)
    const foreignArtistId = request.artist.musicBrainzArtistId ?? this.#foreignId(request.artist.ref, 'artist')

    const artist = await this.#request<JsonObject>('artist', {
      method: 'POST',
      body: {
        artistName: request.artist.name,
        foreignArtistId,
        qualityProfileId,
        metadataProfileId,
        rootFolderPath: string(root.path),
        monitored: request.monitored,
        monitorNewItems: request.monitorMode,
        tags: [],
        addOptions: {
          monitor: request.monitorMode,
          albumsToMonitor: [],
          monitored: request.monitored,
          searchForMissingAlbums: request.searchAfterAdd,
        },
      },
    }, context)
    return this.#artist(artist)
  }

  async ensureRelease(request: EnsureReleaseRequest, context: OperationContext): Promise<CatalogRelease> {
    this.#assertAdapter(request.release.ref)
    this.#assertAdapter(request.release.artistRef)
    const foreignAlbumId = request.release.musicBrainzReleaseGroupId?.trim().toLowerCase()
    if (!foreignAlbumId || !isMusicBrainzId(foreignAlbumId)) {
      throw this.#error('invalid-request', 'Release requires a MusicBrainz release-group ID', false)
    }

    const existing = await this.#findAlbumByForeignId(foreignAlbumId, context)
    if (existing) return this.#installedAlbum(existing)

    const matches = await this.#request<JsonObject[]>('album/lookup', { term: `lidarr:${foreignAlbumId}` }, context)
    const exact = matches.filter(album => optionalString(album.foreignAlbumId)?.toLowerCase() === foreignAlbumId)
    if (exact.length !== 1) {
      throw this.#error('not-found', 'Lidarr did not return one exact release-group match', false)
    }
    const artist = object(exact[0].artist)
    const foreignArtistId = optionalString(artist?.foreignArtistId)?.toLowerCase()
    if (!foreignArtistId || !isMusicBrainzId(foreignArtistId)) {
      throw this.#error('transient-provider-failure', 'Lidarr returned the release without an exact artist ID', true)
    }

    const rootId = this.#numericId(request.root, 'root')
    const root = await this.#request<JsonObject>(`rootfolder/${rootId}`, {}, context)
    const qualityProfileId = this.#numericId(request.qualityProfile, 'profile:quality')
    const metadataProfileId = request.metadataProfile
      ? this.#numericId(request.metadataProfile, 'profile:metadata')
      : number(root.defaultMetadataProfileId)

    let added: JsonObject
    try {
      added = await this.#request<JsonObject>('album', {
        method: 'POST',
        body: {
          foreignAlbumId,
          monitored: false,
          anyReleaseOk: true,
          artist: {
            artistName: optionalString(artist?.artistName) ?? request.release.artistName,
            foreignArtistId,
            qualityProfileId,
            metadataProfileId,
            rootFolderPath: string(root.path),
            monitored: false,
            monitorNewItems: 'none',
            tags: [],
            addOptions: {
              monitor: 'none',
              albumsToMonitor: [foreignAlbumId],
              monitored: false,
              searchForMissingAlbums: false,
            },
          },
          addOptions: { addType: 'manual', searchForNewAlbum: false },
        },
      }, context)
    } catch (error) {
      if (!(error instanceof AdapterError) || (error.providerStatus !== 400 && error.providerStatus !== 409)) throw error
      const raced = await this.#findAlbumByForeignId(foreignAlbumId, context)
      if (!raced) throw error
      added = raced
    }
    return this.#installedAlbum(added)
  }

  async setReleaseWanted(release: ProviderRef, wanted: boolean, context: OperationContext): Promise<void> {
    const albumId = this.#numericId(release, 'album')
    await this.#request('album/monitor', {
      method: 'PUT',
      body: { albumIds: [albumId], monitored: wanted },
    }, context)
  }

  async startSearch(target: AcquisitionSearchTarget, context: OperationContext): Promise<RemoteJob> {
    const kind = target.kind === 'release' ? 'search-release' : 'search-artist'
    const body: JsonObject = target.kind === 'release'
      ? { name: 'AlbumSearch', albumIds: [this.#numericId(target.release, 'album')] }
      : { name: 'ArtistSearch', artistId: this.#numericId(target.artist, 'artist') }

    const command = await this.#request<JsonObject>('command', { method: 'POST', body }, context)
    return this.#command(command, kind)
  }

  async getCommand(job: ProviderRef, context: OperationContext): Promise<RemoteJob> {
    const id = this.#numericId(job, 'command')
    const command = await this.#request<JsonObject>(`command/${id}`, {}, context)
    return this.#command(command)
  }

  async listQueue(page: PageRequest, context: OperationContext): Promise<Page<AcquisitionQueueItem>> {
    const pageNumber = this.#pageNumber(page)
    const response = await this.#request<PagingResource>('queue', {
      page: pageNumber,
      pageSize: page.limit,
      sortKey: 'timeleft',
      sortDirection: 'ascending',
      includeUnknownArtistItems: true,
      includeArtist: true,
      includeAlbum: true,
    }, context)
    return {
      items: response.records.map((record) => this.#queueItem(record)),
      nextCursor: nextCursor(response),
    }
  }

  async listHistory(since: string | undefined, page: PageRequest, context: OperationContext): Promise<Page<AcquisitionHistoryItem>> {
    const pageNumber = this.#pageNumber(page)
    const response = await this.#request<PagingResource>('history', {
      page: pageNumber,
      pageSize: page.limit,
      sortKey: 'date',
      sortDirection: 'descending',
      includeArtist: true,
      includeAlbum: true,
    }, context)
    const records = since ? response.records.filter((record) => string(record.date) >= since) : response.records
    const reachedSince = since !== undefined && records.length < response.records.length
    return {
      items: records.map((record) => this.#historyItem(record)),
      nextCursor: reachedSince ? undefined : nextCursor(response),
    }
  }

  #artist(value: JsonObject): CatalogArtist {
    const mbid = optionalString(value.foreignArtistId) ?? optionalString(value.mbId)
    return {
      ref: number(value.id) > 0 ? this.#ref('artist', number(value.id)) : this.#foreignRef('artist', mbid),
      name: string(value.artistName),
      sortName: optionalString(value.sortName),
      disambiguation: optionalString(value.disambiguation),
      musicBrainzArtistId: mbid,
      images: imageUrls(value),
    }
  }

  #album(value: JsonObject): CatalogRelease {
    const artist = object(value.artist)
    const artistId = optionalNumber(value.artistId) ?? optionalNumber(artist?.id)
    const artistMbid = optionalString(artist?.foreignArtistId) ?? optionalString(artist?.mbId)
    const albumMbid = optionalString(value.foreignAlbumId)
    const releaseTrackCounts = Array.isArray(value.releases)
      ? value.releases.flatMap(release => {
        const trackCount = optionalNumber(object(release)?.trackCount)
        return trackCount && trackCount > 0 ? [trackCount] : []
      })
      : []
    return {
      ref: number(value.id) > 0 ? this.#ref('album', number(value.id)) : this.#foreignRef('album', albumMbid),
      artistRef: artistId && artistId > 0
        ? this.#ref('artist', artistId)
        : this.#foreignRef('artist', artistMbid),
      artistName: optionalString(artist?.artistName),
      title: string(value.title),
      releaseDate: optionalString(value.releaseDate),
      releaseType: optionalString(value.albumType),
      trackCount: releaseTrackCounts.length ? Math.min(...releaseTrackCounts) : undefined,
      musicBrainzReleaseGroupId: albumMbid,
      monitored: optionalBoolean(value.monitored),
      images: imageUrls(value),
    }
  }

  #musicBrainzRelease(value: JsonObject, artistMbid: string): CatalogRelease {
    const releaseMbid = string(value.id).toLowerCase()
    if (!isMusicBrainzId(releaseMbid)) {
      throw this.#error('transient-provider-failure', 'MusicBrainz returned a release without an identifier', true)
    }
    return {
      ref: this.#foreignRef('album', releaseMbid),
      artistRef: this.#foreignRef('artist', artistMbid),
      title: string(value.title),
      releaseDate: optionalString(value['first-release-date']),
      releaseType: optionalString(value['primary-type']),
      musicBrainzReleaseGroupId: releaseMbid,
      images: [`https://coverartarchive.org/release-group/${releaseMbid}/front-250`],
    }
  }

  #profile(value: JsonObject, kind: AcquisitionProfile['kind']): AcquisitionProfile {
    return {
      ref: this.#ref(`profile:${kind}`, number(value.id)),
      name: string(value.name),
      kind,
    }
  }

  #queueItem(value: JsonObject): AcquisitionQueueItem {
    const size = optionalNumber(value.size)
    const sizeleft = optionalNumber(value.sizeleft)
    const messages = array(value.statusMessages).flatMap((message) => {
      const title = optionalString(object(message)?.title)
      const texts = array(object(message)?.messages).map(string)
      return title ? [title, ...texts] : texts
    })
    return {
      ref: this.#ref('queue', number(value.id)),
      underlyingDownloadRef: optionalString(value.downloadId),
      artist: object(value.artist) ? this.#artist(object(value.artist)!) : undefined,
      release: object(value.album) ? this.#album(object(value.album)!) : undefined,
      title: optionalString(value.title) ?? optionalString(value.errorMessage) ?? 'Untitled transfer',
      protocol: protocol(value.protocol),
      state: transferState(value),
      rawState: optionalString(value.trackedDownloadState) ?? optionalString(value.status) ?? 'unknown',
      bytesTotal: size,
      bytesRemaining: sizeleft,
      etaSeconds: etaSeconds(value.estimatedCompletionTime),
      output: optionalString(value.outputPath) ? this.#path(string(value.outputPath)) : undefined,
      statusMessages: messages,
    }
  }

  #historyItem(value: JsonObject): AcquisitionHistoryItem {
    const data = object(value.data) ?? {}
    // Lidarr's droppedPath is the completed download path. Do not guess from
    // other history metadata, titles, or download IDs.
    const droppedPath = optionalString(data.droppedPath)
    return {
      ref: this.#ref('history', number(value.id)),
      eventType: string(value.eventType),
      occurredAt: string(value.date),
      artist: object(value.artist) ? this.#artist(object(value.artist)!) : undefined,
      release: object(value.album) ? this.#album(object(value.album)!) : undefined,
      underlyingDownloadRef: optionalString(value.downloadId),
      output: droppedPath ? this.#path(droppedPath) : undefined,
      data,
    }
  }

  #command(value: JsonObject, requestedKind?: RemoteJob['kind']): RemoteJob {
    const rawName = optionalString(value.name) ?? ''
    const kind = requestedKind ?? commandKind(rawName)
    const rawState = optionalString(value.status) ?? 'unknown'
    return {
      ref: this.#ref('command', number(value.id)),
      kind,
      state: remoteJobState(rawState),
      rawState,
      startedAt: optionalString(value.started),
      completedAt: optionalString(value.ended),
      message: optionalString(value.message) ?? optionalString(value.exception),
    }
  }

  async #findAlbumByForeignId(foreignAlbumId: string, context: OperationContext): Promise<JsonObject | undefined> {
    const albums = await this.#request<JsonObject[]>('album', { foreignAlbumId }, context)
    if (albums.length > 1) throw this.#error('transient-provider-failure', 'Lidarr returned duplicate releases for one MusicBrainz ID', true)
    return albums[0]
  }

  #installedAlbum(value: JsonObject): CatalogRelease {
    const release = this.#album(value)
    this.#numericId(release.ref, 'album')
    return release
  }

  #pageNumber(page: PageRequest): number {
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100) {
      throw this.#error('invalid-request', 'Page limit must be between 1 and 100', false)
    }
    if (!page.cursor) return 1
    const match = /^lidarr-page:(\d+)$/.exec(page.cursor)
    const pageNumber = Number(match?.[1])
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      throw this.#error('invalid-request', 'Invalid Lidarr page cursor', false)
    }
    return pageNumber
  }

  #ref(resource: string, id: number): ProviderRef {
    return { adapterId: this.adapterId, nativeId: `${resource}:id:${id}` }
  }

  #foreignRef(resource: string, id: string | undefined): ProviderRef {
    if (!id) throw this.#error('transient-provider-failure', `Lidarr returned ${resource} without an identifier`, true)
    return { adapterId: this.adapterId, nativeId: `${resource}:mbid:${id}` }
  }

  #numericId(ref: ProviderRef, resource: string): number {
    this.#assertAdapter(ref)
    const prefix = `${resource}:id:`
    if (!ref.nativeId.startsWith(prefix)) {
      throw this.#error('invalid-request', `${resource} requires a local Lidarr ID`, false)
    }
    const id = Number(ref.nativeId.slice(prefix.length))
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw this.#error('invalid-request', `Invalid Lidarr ${resource} ID`, false)
    }
    return id
  }

  #foreignId(ref: ProviderRef, resource: string): string {
    this.#assertAdapter(ref)
    const prefix = `${resource}:mbid:`
    if (!ref.nativeId.startsWith(prefix) || ref.nativeId.length === prefix.length) {
      throw this.#error('invalid-request', `${resource} requires a MusicBrainz ID`, false)
    }
    return ref.nativeId.slice(prefix.length)
  }

  #assertAdapter(ref: ProviderRef): void {
    if (ref.adapterId !== this.adapterId) {
      throw this.#error('invalid-request', `Reference belongs to ${ref.adapterId}, not ${this.adapterId}`, false)
    }
  }

  #path(providerPath: string): ServicePath {
    const mapping = [...(this.#pathMappings ?? [])]
      .sort((a, b) => b.providerPrefix.length - a.providerPrefix.length)
      .find(({ providerPrefix }) => pathMatches(providerPath, providerPrefix))
    if (!mapping) return { providerPath }
    return {
      providerPath,
      needlePath: `${mapping.needlePrefix.replace(/\/$/, '')}${providerPath.slice(mapping.providerPrefix.replace(/\/$/, '').length)}`,
      mappingId: mapping.id,
    }
  }

  async #request<T = unknown>(
    path: string,
    options: JsonObject & { method?: string; body?: unknown },
    context: OperationContext,
  ): Promise<T> {
    const url = new URL(path, this.#baseUrl)
    const method = optionalString(options.method) ?? 'GET'
    const body = options.body
    for (const [key, value] of Object.entries(options)) {
      if (key === 'method' || key === 'body' || value === undefined) continue
      url.searchParams.set(key, String(value))
    }

    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.#fetch(url, {
        method,
        signal,
        headers: {
          Accept: 'application/json',
          'X-Api-Key': this.#apiKey,
          'X-Needle-Operation-Id': context.operationId,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'Lidarr request timed out or was cancelled'
        : 'Lidarr is unavailable'
      throw this.#error('unavailable', message, true, undefined, error)
    }

    if (!response.ok) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      throw this.#error(
        statusCode(response.status),
        `Lidarr request failed with status ${response.status}`,
        response.status >= 500 || response.status === 429,
        response.status,
        undefined,
        retryAfter,
      )
    }
    if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T
    const text = await response.text()
    if (text.length === 0) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw this.#error('transient-provider-failure', 'Lidarr returned an invalid response', true, response.status, error)
    }
  }

  async #musicBrainzRequest(artistMbid: string, offset: number, context: OperationContext): Promise<MusicBrainzReleaseGroupPage> {
    const url = new URL('release-group', this.#musicBrainzBaseUrl)
    url.searchParams.set('artist', artistMbid)
    url.searchParams.set('release-group-status', 'website-default')
    url.searchParams.set('limit', '100')
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('fmt', 'json')
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.#fetch(url, {
        signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Needle/0.1 (https://github.com/joshuaobrien/needle)',
          'X-Needle-Operation-Id': context.operationId,
        },
      })
    } catch (error) {
      throw this.#error('unavailable', 'MusicBrainz is unavailable', true, undefined, error)
    }
    if (!response.ok) {
      throw this.#error(
        statusCode(response.status),
        `MusicBrainz request failed with status ${response.status}`,
        response.status >= 500 || response.status === 429,
        response.status,
        undefined,
        parseRetryAfter(response.headers.get('retry-after')),
      )
    }
    try {
      return await response.json() as MusicBrainzReleaseGroupPage
    } catch (error) {
      throw this.#error('transient-provider-failure', 'MusicBrainz returned an invalid response', true, response.status, error)
    }
  }

  #error(
    code: ConstructorParameters<typeof AdapterError>[0]['code'],
    message: string,
    retryable: boolean,
    providerStatus?: number,
    cause?: unknown,
    retryAfterSeconds?: number,
  ): AdapterError {
    return new AdapterError({
      code,
      adapterId: this.adapterId,
      message,
      retryable,
      providerStatus,
      retryAfterSeconds,
    }, { cause })
  }
}

export function createLidarrAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): LidarrAdapter | null {
  if (!env.LIDARR_URL || !env.LIDARR_API_KEY) return null
  const pathMappings = parsePathMappings(env.LIDARR_PATH_MAPPINGS)
  return new LidarrAdapter({
    baseUrl: env.LIDARR_URL,
    apiKey: env.LIDARR_API_KEY,
    pathMappings,
  })
}

function parsePathMappings(raw: string | undefined): LidarrOptions['pathMappings'] {
  if (!raw) return []
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('LIDARR_PATH_MAPPINGS must be valid JSON') }
  if (!Array.isArray(value) || !value.every(item => {
    const mapping = object(item)
    return mapping && Object.keys(mapping).every(key => ['id', 'providerPrefix', 'needlePrefix'].includes(key))
      && [mapping.id, mapping.providerPrefix, mapping.needlePrefix].every(part => typeof part === 'string' && part.length > 0)
      && string(mapping.providerPrefix).startsWith('/') && string(mapping.needlePrefix).startsWith('/')
  })) throw new Error('LIDARR_PATH_MAPPINGS must be an array of absolute path mappings')
  return value as NonNullable<LidarrOptions['pathMappings']>
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isMusicBrainzId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
}

function number(value: unknown): number {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function optionalNumber(value: unknown): number | undefined {
  const result = Number(value)
  return value !== undefined && value !== null && Number.isFinite(result) ? result : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function imageUrls(value: JsonObject): string[] {
  return array(value.images).flatMap((image) => {
    const media = object(image)
    const url = optionalString(media?.remoteUrl) ?? optionalString(media?.url)
    return url ? [url] : []
  })
}

function protocol(value: unknown): 'torrent' | 'usenet' | undefined {
  const normalized = optionalString(value)?.toLowerCase()
  if (normalized === 'torrent') return 'torrent'
  if (normalized === 'usenet') return 'usenet'
  return undefined
}

function transferState(value: JsonObject): AcquisitionQueueState {
  const state = `${optionalString(value.trackedDownloadState) ?? ''} ${optionalString(value.status) ?? ''}`.toLowerCase()
  if (state.includes('importpending') || state.includes('import pending')) return 'post-processing'
  if (state.includes('importing')) return 'post-processing'
  if (state.includes('failed') || state.includes('warning')) return 'failed'
  if (state.includes('paused')) return 'paused'
  if (state.includes('completed')) return 'completed'
  if (state.includes('downloading')) return 'downloading'
  if (state.includes('queued')) return 'queued'
  return 'unknown'
}

function remoteJobState(value: string): RemoteJob['state'] {
  switch (value.toLowerCase()) {
    case 'queued': return 'queued'
    case 'started': return 'running'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'aborted':
    case 'cancelled': return 'cancelled'
    default: return 'unknown'
  }
}

function commandKind(value: string): RemoteJob['kind'] {
  switch (value.toLowerCase()) {
    case 'artistsearch': return 'search-artist'
    case 'albumsearch': return 'search-release'
    default: return 'unknown'
  }
}

function etaSeconds(value: unknown): number | undefined {
  const time = Date.parse(string(value))
  if (!Number.isFinite(time)) return undefined
  return Math.max(0, Math.round((time - Date.now()) / 1000))
}

function nextCursor(page: PagingResource): string | undefined {
  return page.page * page.pageSize < page.totalRecords ? `lidarr-page:${page.page + 1}` : undefined
}

function pathMatches(path: string, prefix: string): boolean {
  const normalized = prefix.replace(/\/$/, '')
  return path === normalized || path.startsWith(`${normalized}/`)
}

function statusCode(status: number): ConstructorParameters<typeof AdapterError>[0]['code'] {
  if (status === 401 || status === 403) return 'authentication'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'transient-provider-failure'
  return 'invalid-request'
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds : undefined
}

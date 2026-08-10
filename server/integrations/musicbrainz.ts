import type { CatalogArtist, CatalogLookupPort, CatalogRelease } from './catalog.js'
import type { AdapterHealth, OperationContext, ProviderRef } from './common.js'
import { AdapterError } from './errors.js'

type Fetch = typeof globalThis.fetch
type JsonObject = Record<string, unknown>

export interface MusicBrainzOptions {
  baseUrl?: string
  fetch?: Fetch
  timeoutMs?: number
  userAgent?: string
}

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export class MusicBrainzAdapter implements CatalogLookupPort {
  readonly adapterId = 'musicbrainz'
  readonly kind = 'musicbrainz' as const
  readonly #baseUrl: URL
  readonly #fetch: Fetch
  readonly #timeoutMs: number
  readonly #userAgent: string

  constructor(options: MusicBrainzOptions = {}) {
    this.#baseUrl = new URL(options.baseUrl ?? 'https://musicbrainz.org/ws/2/')
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? 10_000
    this.#userAgent = options.userAgent ?? 'Needle/0.1 (https://github.com/joshuaobrien/needle)'
  }

  async probe(context: OperationContext): Promise<AdapterHealth> {
    const started = performance.now()
    try {
      await this.#request('artist', { query: 'artist:Needle', limit: 1 }, context)
      return { adapterId: this.adapterId, kind: this.kind, state: 'available', checkedAt: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), apiVersion: 'ws/2' }
    } catch (error) {
      if (!(error instanceof AdapterError)) throw error
      return { adapterId: this.adapterId, kind: this.kind, state: 'unavailable', checkedAt: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), apiVersion: 'ws/2', message: error.message }
    }
  }

  async lookupArtists(term: string, context: OperationContext): Promise<readonly CatalogArtist[]> {
    if (!term.trim()) throw this.#error('invalid-request', 'Artist search term is required', false)
    const payload = await this.#request('artist', { query: term, limit: 25 }, context)
    return array(payload.artists).map(value => {
      const artist = requiredObject(value, this)
      const id = this.#id(artist.id, 'artist')
      return { ref: this.#ref('artist', id), name: requiredString(artist.name, this), sortName: optionalString(artist['sort-name']), disambiguation: optionalString(artist.disambiguation), musicBrainzArtistId: id }
    })
  }

  async lookupReleases(term: string, context: OperationContext): Promise<readonly CatalogRelease[]> {
    if (!term.trim()) throw this.#error('invalid-request', 'Release search term is required', false)
    const payload = await this.#request('release-group', { query: term, limit: 25 }, context)
    return array(payload['release-groups']).map(value => this.#release(requiredObject(value, this)))
  }

  async listArtistReleases(ref: ProviderRef, context: OperationContext): Promise<readonly CatalogRelease[]> {
    const artistId = this.#refId(ref, 'artist')
    const result: CatalogRelease[] = []
    let offset = 0
    while (true) {
      const payload = await this.#request('release-group', { artist: artistId, 'release-group-status': 'website-default', limit: 100, offset }, context)
      const groups = array(payload['release-groups'])
      const count = requiredNumber(payload['release-group-count'], this)
      result.push(...groups.map(value => this.#release(requiredObject(value, this), { id: artistId })))
      offset += groups.length
      if (!groups.length || offset >= count) return result
    }
  }

  #release(group: JsonObject, fallbackArtist?: JsonObject): CatalogRelease {
    const id = this.#id(group.id, 'release-group')
    const credit = object(array(group['artist-credit'])[0])
    const artist = object(credit?.artist) ?? fallbackArtist
    if (!artist) throw this.#error('transient-provider-failure', 'MusicBrainz returned a release without artist credit', true)
    const artistId = this.#id(artist.id, 'artist')
    const artistName = optionalString(credit?.name) ?? optionalString(artist.name)
    return {
      ref: this.#ref('release-group', id), artistRef: this.#ref('artist', artistId), artistName,
      title: requiredString(group.title, this), releaseDate: optionalString(group['first-release-date']),
      releaseType: optionalString(group['primary-type']), secondaryTypes: array(group['secondary-types']).filter((x): x is string => typeof x === 'string'),
      musicBrainzReleaseGroupId: id,
      images: [`https://coverartarchive.org/release-group/${id}/front-250`, `https://coverartarchive.org/release-group/${id}/front-500`],
    }
  }

  async #request(path: string, query: Record<string, string | number>, context: OperationContext): Promise<JsonObject> {
    const url = new URL(path, this.#baseUrl)
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)))
    url.searchParams.set('fmt', 'json')
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.#fetch(url, { signal, headers: { Accept: 'application/json', 'User-Agent': this.#userAgent, 'X-Needle-Operation-Id': context.operationId } })
    } catch (cause) {
      throw this.#error('unavailable', signal.aborted ? 'MusicBrainz request timed out or was cancelled' : 'MusicBrainz is unavailable', true, undefined, cause)
    }
    if (!response.ok) {
      const retryAfterHeader = response.headers.get('retry-after')
      const retryAfter = retryAfterHeader === null ? undefined : Number(retryAfterHeader)
      const code = response.status === 429 || response.status === 503 ? 'rate-limited' : response.status === 404 ? 'not-found' : response.status >= 500 ? 'transient-provider-failure' : 'invalid-request'
      throw new AdapterError({ code, adapterId: this.adapterId, message: `MusicBrainz request failed with status ${response.status}`, retryable: response.status === 429 || response.status >= 500, providerStatus: response.status, ...(retryAfter !== undefined && Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter } : {}) })
    }
    try { return requiredObject(await response.json(), this) } catch (cause) {
      if (cause instanceof AdapterError) throw cause
      throw this.#error('transient-provider-failure', 'MusicBrainz returned an invalid response', true, response.status, cause)
    }
  }

  #id(value: unknown, resource: string): string { const id = optionalString(value)?.toLowerCase(); if (!id || !MBID.test(id)) throw this.#error('transient-provider-failure', `MusicBrainz returned ${resource} without a valid identifier`, true); return id }
  #ref(resource: string, id: string): ProviderRef { return { adapterId: this.adapterId, nativeId: `${resource}:mbid:${id}` } }
  #refId(ref: ProviderRef, resource: string): string { if (ref.adapterId !== this.adapterId) throw this.#error('invalid-request', `Reference belongs to ${ref.adapterId}, not ${this.adapterId}`, false); const prefix = `${resource}:mbid:`; const id = ref.nativeId.startsWith(prefix) ? ref.nativeId.slice(prefix.length).toLowerCase() : ''; if (!MBID.test(id)) throw this.#error('invalid-request', `${resource} requires a valid MusicBrainz ID`, false); return id }
  #error(code: ConstructorParameters<typeof AdapterError>[0]['code'], message: string, retryable: boolean, providerStatus?: number, cause?: unknown) { return new AdapterError({ code, adapterId: this.adapterId, message, retryable, providerStatus }, { cause }) }
}

function object(value: unknown): JsonObject | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined }
function requiredObject(value: unknown, adapter: MusicBrainzAdapter): JsonObject { const result = object(value); if (!result) throw new AdapterError({ code: 'transient-provider-failure', adapterId: adapter.adapterId, message: 'MusicBrainz returned a malformed response', retryable: true }); return result }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value.length ? value : undefined }
function requiredString(value: unknown, adapter: MusicBrainzAdapter): string { const result = optionalString(value); if (!result) throw new AdapterError({ code: 'transient-provider-failure', adapterId: adapter.adapterId, message: 'MusicBrainz returned a malformed response', retryable: true }); return result }
function requiredNumber(value: unknown, adapter: MusicBrainzAdapter): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AdapterError({ code: 'transient-provider-failure', adapterId: adapter.adapterId, message: 'MusicBrainz returned a malformed response', retryable: true }); return value }

export type AdapterKind = 'lidarr' | 'musicbrainz' | 'beets' | 'slskd'
export type Protocol = 'torrent' | 'usenet' | 'soulseek'
export type IsoDateTime = string

export interface OperationContext {
  /** Needle-generated ID used to correlate logs and remote operations. */
  operationId: string
  signal?: AbortSignal
}

export interface PageRequest {
  cursor?: string
  limit: number
}

export interface Page<T> {
  items: readonly T[]
  nextCursor?: string
}

export type AdapterErrorCode =
  | 'authentication'
  | 'conflict'
  | 'invalid-request'
  | 'not-found'
  | 'rate-limited'
  | 'transient-provider-failure'
  | 'unavailable'
  | 'unsupported'

export interface AdapterErrorDetails {
  code: AdapterErrorCode
  adapterId: string
  message: string
  retryable: boolean
  retryAfterSeconds?: number
  providerStatus?: number
  providerCode?: string
}

export interface ProviderRef {
  adapterId: string
  nativeId: string
}

export interface ServicePath {
  /** Path as seen inside the provider's host or container. */
  providerPath: string
  /** Resolved path in Needle's filesystem namespace, when a mapping exists. */
  needlePath?: string
  mappingId?: string
}

export type AdapterHealthState = 'available' | 'degraded' | 'unavailable'

export interface AdapterHealth {
  adapterId: string
  kind: AdapterKind
  state: AdapterHealthState
  checkedAt: IsoDateTime
  latencyMs: number
  version?: string
  apiVersion?: string
  message?: string
}

export interface ServiceAdapter {
  readonly adapterId: string
  readonly kind: AdapterKind
  probe(context: OperationContext): Promise<AdapterHealth>
}

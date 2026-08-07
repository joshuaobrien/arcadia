export type AdapterKind =
  | 'beets'
  | 'lidarr'
  | 'musicbrainz'
  | 'ntfy'
  | 'prowlarr'
  | 'qbittorrent'
  | 'sabnzbd'
  | 'slskd'

export type Protocol = 'soulseek' | 'torrent' | 'usenet'
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
  title: string
  releaseDate?: string
  releaseType?: string
  musicBrainzReleaseGroupId?: string
  monitored?: boolean
  images?: readonly string[]
}

export interface CatalogLookupPort extends ServiceAdapter {
  lookupArtists(term: string, context: OperationContext): Promise<readonly CatalogArtist[]>
  lookupReleases(term: string, context: OperationContext): Promise<readonly CatalogRelease[]>
  listArtistReleases(artist: ProviderRef, context: OperationContext): Promise<readonly CatalogRelease[]>
}

export interface AutomationProfile {
  ref: ProviderRef
  name: string
  kind: 'metadata' | 'quality'
}

export interface AutomationRoot {
  ref: ProviderRef
  path: ServicePath
  freeBytes?: number
}

export interface AddArtistRequest {
  artist: CatalogArtist
  monitored: boolean
  monitorMode: 'all' | 'existing' | 'future' | 'missing' | 'none'
  qualityProfile: ProviderRef
  metadataProfile?: ProviderRef
  root: ProviderRef
  searchAfterAdd: boolean
}

export type AutomationCommandKind =
  | 'refresh-artist'
  | 'rescan-artist'
  | 'scan-download-folder'
  | 'search-artist'
  | 'search-release'

export type RemoteJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface RemoteJob {
  ref: ProviderRef
  kind: AutomationCommandKind | 'unknown'
  state: RemoteJobState
  rawState: string
  startedAt?: IsoDateTime
  completedAt?: IsoDateTime
  message?: string
}

export interface AutomationQueueItem {
  ref: ProviderRef
  underlyingDownloadRef?: string
  artist?: CatalogArtist
  release?: CatalogRelease
  title: string
  protocol?: Protocol
  state: TransferState
  rawState: string
  bytesTotal?: number
  bytesRemaining?: number
  etaSeconds?: number
  output?: ServicePath
  statusMessages: readonly string[]
}

export interface AutomationHistoryItem {
  ref: ProviderRef
  eventType: string
  occurredAt: IsoDateTime
  artist?: CatalogArtist
  release?: CatalogRelease
  underlyingDownloadRef?: string
  data: Readonly<Record<string, unknown>>
}

export interface MusicAutomationPort extends ServiceAdapter {
  listProfiles(context: OperationContext): Promise<readonly AutomationProfile[]>
  listRoots(context: OperationContext): Promise<readonly AutomationRoot[]>
  addArtist(request: AddArtistRequest, context: OperationContext): Promise<CatalogArtist>
  setReleaseMonitored(release: ProviderRef, monitored: boolean, context: OperationContext): Promise<void>
  startCommand(kind: AutomationCommandKind, target: ProviderRef | ServicePath, context: OperationContext): Promise<RemoteJob>
  getCommand(job: ProviderRef, context: OperationContext): Promise<RemoteJob>
  listQueue(page: PageRequest, context: OperationContext): Promise<Page<AutomationQueueItem>>
  listHistory(since: IsoDateTime | undefined, page: PageRequest, context: OperationContext): Promise<Page<AutomationHistoryItem>>
  removeQueueItem(item: ProviderRef, options: { removeFromClient: boolean; blocklist: boolean }, context: OperationContext): Promise<void>
}

export interface SearchCapabilities {
  retainedJobs: boolean
  incrementalResults: boolean
  cancellation: boolean
  resultExpiry: boolean
}

export type SearchState = 'running' | 'completed' | 'cancelled' | 'failed' | 'expired'

export interface SearchRequest {
  query: string
  artist?: string
  release?: string
  categories?: readonly string[]
  protocols?: readonly Protocol[]
  limit?: number
}

export interface SoulseekFileSelection {
  filename: string
  size: number
}

export type CandidateSource =
  | { protocol: 'torrent'; magnetUri?: string; downloadUrl?: string; infoHash?: string }
  | { protocol: 'usenet'; downloadUrl: string }
  | { protocol: 'soulseek'; username: string; files: readonly SoulseekFileSelection[] }

export interface ReleaseCandidate {
  ref: ProviderRef
  searchRef?: ProviderRef
  title: string
  source: CandidateSource
  size?: number
  publishedAt?: IsoDateTime
  ageSeconds?: number
  seeders?: number
  leechers?: number
  peerHasFreeSlot?: boolean
  bitrateKbps?: number
  durationSeconds?: number
  categories: readonly string[]
  expiresAt?: IsoDateTime
  raw: Readonly<Record<string, unknown>>
}

export interface SearchSnapshot {
  providerSearchRef?: ProviderRef
  state: SearchState
  rawState: string
  results: readonly ReleaseCandidate[]
  startedAt: IsoDateTime
  completedAt?: IsoDateTime
  expiresAt?: IsoDateTime
  error?: string
}

export interface ReleaseSearchPort extends ServiceAdapter {
  readonly searchCapabilities: SearchCapabilities
  startSearch(request: SearchRequest, context: OperationContext): Promise<SearchSnapshot>
  getSearch(search: ProviderRef, context: OperationContext): Promise<SearchSnapshot>
  cancelSearch(search: ProviderRef, context: OperationContext): Promise<void>
  forgetSearch(search: ProviderRef, context: OperationContext): Promise<void>
}

export interface TransferCapabilities {
  pause: boolean
  resume: boolean
  cancel: boolean
  remove: boolean
  deleteData: boolean
  retry: boolean
  recheck: boolean
  move: boolean
  durableHistory: boolean
  incrementalUpdates: boolean
}

export type TransferState =
  | 'queued'
  | 'resolving-metadata'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'post-processing'
  | 'seeding'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'missing'
  | 'unknown'

export type TransferPayload =
  | { protocol: 'torrent'; kind: 'magnet'; magnetUri: string }
  | { protocol: 'torrent'; kind: 'url'; url: string }
  | { protocol: 'torrent'; kind: 'metainfo'; filename: string; bytes: Uint8Array }
  | { protocol: 'usenet'; kind: 'url'; url: string }
  | { protocol: 'usenet'; kind: 'nzb'; filename: string; bytes: Uint8Array }
  | { protocol: 'soulseek'; kind: 'files'; username: string; files: readonly SoulseekFileSelection[]; searchRef?: ProviderRef }

export interface EnqueueTransferRequest {
  payload: TransferPayload
  displayName: string
  category?: string
  tags?: readonly string[]
  destination?: ServicePath
  paused?: boolean
}

export interface TransferRecord {
  ref: ProviderRef
  protocol: Protocol
  displayName: string
  state: TransferState
  rawState: string
  progress?: number
  bytesTotal?: number
  bytesCompleted?: number
  bytesRemaining?: number
  downloadBytesPerSecond?: number
  uploadBytesPerSecond?: number
  etaSeconds?: number
  createdAt?: IsoDateTime
  startedAt?: IsoDateTime
  completedAt?: IsoDateTime
  source?: ServicePath
  destination?: ServicePath
  category?: string
  tags: readonly string[]
  error?: string
  raw: Readonly<Record<string, unknown>>
}

export type TransferControl =
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'cancel' }
  | { action: 'retry' }
  | { action: 'recheck' }
  | { action: 'move'; destination: ServicePath }

export interface TransferClientPort extends ServiceAdapter {
  readonly transferCapabilities: TransferCapabilities
  enqueue(request: EnqueueTransferRequest, context: OperationContext): Promise<TransferRecord>
  getTransfer(transfer: ProviderRef, context: OperationContext): Promise<TransferRecord>
  listTransfers(options: { includeCompleted: boolean }, page: PageRequest, context: OperationContext): Promise<Page<TransferRecord>>
  control(transfer: ProviderRef, command: TransferControl, context: OperationContext): Promise<TransferRecord>
  /** Removes the provider record. Payload deletion is always an explicit choice. */
  remove(transfer: ProviderRef, options: { deleteData: boolean }, context: OperationContext): Promise<void>
}

export type AcquisitionState =
  | 'wanted'
  | 'searching'
  | 'selection-required'
  | 'queued'
  | 'transferring'
  | 'importing'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Needle-owned workflow record. Provider records may disappear without deleting this job. */
export interface AcquisitionJob {
  id: string
  state: AcquisitionState
  artist?: string
  release?: string
  searchRefs: readonly ProviderRef[]
  selectedCandidateRef?: ProviderRef
  transferRef?: ProviderRef
  importRef?: ProviderRef
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  error?: AdapterErrorDetails
}

export interface ImportInspection {
  ref: ProviderRef
  source: ServicePath
  artist?: string
  release?: string
  tracks: number
  confidence?: number
  warnings: readonly string[]
  raw: Readonly<Record<string, unknown>>
}

export interface ImportResult {
  ref: ProviderRef
  state: 'completed' | 'needs-review' | 'failed'
  source: ServicePath
  destination?: ServicePath
  warnings: readonly string[]
  error?: string
}

export interface LibraryImportPort extends ServiceAdapter {
  inspect(source: ServicePath, context: OperationContext): Promise<ImportInspection>
  import(inspection: ProviderRef, context: OperationContext): Promise<ImportResult>
}

export interface NotificationMessage {
  title: string
  body: string
  priority?: 'min' | 'low' | 'default' | 'high' | 'max'
  tags?: readonly string[]
  actionUrl?: string
}

export interface NotificationPort extends ServiceAdapter {
  publish(message: NotificationMessage, context: OperationContext): Promise<void>
}

export type SecretRef = string

export type ServiceAuth =
  | { kind: 'api-key-header'; header: string; secret: SecretRef }
  | { kind: 'api-key-query'; parameter: string; secret: SecretRef }
  | { kind: 'basic'; username: string; password: SecretRef }
  | { kind: 'login-cookie'; username: string; password: SecretRef }
  | { kind: 'none' }

export interface ServiceConnection {
  adapterId: string
  kind: AdapterKind
  baseUrl: string
  auth: ServiceAuth
  enabled: boolean
  pathMappings: readonly {
    id: string
    providerPrefix: string
    needlePrefix: string
  }[]
}

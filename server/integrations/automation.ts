import type { CatalogArtist, CatalogRelease } from './catalog.js'
import type {
  IsoDateTime,
  OperationContext,
  Page,
  PageRequest,
  Protocol,
  ProviderRef,
  ServiceAdapter,
  ServicePath,
} from './common.js'

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

export type AutomationQueueState =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'post-processing'
  | 'completed'
  | 'failed'
  | 'unknown'

export interface AutomationQueueItem {
  ref: ProviderRef
  underlyingDownloadRef?: string
  artist?: CatalogArtist
  release?: CatalogRelease
  title: string
  protocol?: Protocol
  state: AutomationQueueState
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

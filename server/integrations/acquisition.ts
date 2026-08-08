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

export interface AcquisitionProfile {
  ref: ProviderRef
  name: string
  kind: 'metadata' | 'quality'
}

export interface AcquisitionRoot {
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

export type AcquisitionSearchTarget =
  | { kind: 'artist'; artist: ProviderRef }
  | { kind: 'release'; release: ProviderRef }

export type RemoteJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface RemoteJob {
  ref: ProviderRef
  kind: 'search-artist' | 'search-release' | 'unknown'
  state: RemoteJobState
  rawState: string
  startedAt?: IsoDateTime
  completedAt?: IsoDateTime
  message?: string
}

export type AcquisitionQueueState =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'post-processing'
  | 'completed'
  | 'failed'
  | 'unknown'

export interface AcquisitionQueueItem {
  ref: ProviderRef
  underlyingDownloadRef?: string
  artist?: CatalogArtist
  release?: CatalogRelease
  title: string
  protocol?: Protocol
  state: AcquisitionQueueState
  rawState: string
  bytesTotal?: number
  bytesRemaining?: number
  etaSeconds?: number
  output?: ServicePath
  statusMessages: readonly string[]
}

export interface AcquisitionHistoryItem {
  ref: ProviderRef
  eventType: string
  occurredAt: IsoDateTime
  artist?: CatalogArtist
  release?: CatalogRelease
  underlyingDownloadRef?: string
  data: Readonly<Record<string, unknown>>
}

/** Acquisition control only. This port never imports, moves, retags, or deletes media files. */
export interface AcquisitionAutomationPort extends ServiceAdapter {
  listProfiles(context: OperationContext): Promise<readonly AcquisitionProfile[]>
  listRoots(context: OperationContext): Promise<readonly AcquisitionRoot[]>
  addArtist(request: AddArtistRequest, context: OperationContext): Promise<CatalogArtist>
  setReleaseWanted(release: ProviderRef, wanted: boolean, context: OperationContext): Promise<void>
  startSearch(target: AcquisitionSearchTarget, context: OperationContext): Promise<RemoteJob>
  getCommand(job: ProviderRef, context: OperationContext): Promise<RemoteJob>
  listQueue(page: PageRequest, context: OperationContext): Promise<Page<AcquisitionQueueItem>>
  listHistory(since: IsoDateTime | undefined, page: PageRequest, context: OperationContext): Promise<Page<AcquisitionHistoryItem>>
}

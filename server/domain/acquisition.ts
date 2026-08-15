import type { AdapterErrorDetails, IsoDateTime, ProviderRef } from '../integrations/common.js'

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

/** Arcadia-owned workflow record. Provider records may disappear without deleting this job. */
export interface AcquisitionJob {
  id: string
  state: AcquisitionState
  artist?: string
  release?: string
  releaseDate?: string
  releaseType?: string
  trackCount?: number
  musicBrainzReleaseGroupId?: string
  searchRefs: readonly ProviderRef[]
  selectedCandidateRef?: ProviderRef
  transferRef?: ProviderRef
  importRef?: ProviderRef
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  error?: AdapterErrorDetails
}

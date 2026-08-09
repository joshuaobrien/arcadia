import type { OperationContext, ServiceAdapter } from './common.js'

export interface BeetsInboxStats {
  name: string
  providerPath: string
  taggedCount: number
  importedCount: number
  bytes: number | null
  fileCount: number | null
  lastCreatedAt?: string
}

export type BeetsInboxEntryType = 'directory' | 'file'

export interface BeetsInboxFolder {
  name: string
  providerPath: string
  hash: string
  album: boolean
  type: BeetsInboxEntryType
  children: readonly BeetsInboxFolder[]
}

export type BeetsFolderImportStatus =
  | 'unknown' | 'failed' | 'not-started' | 'pending' | 'previewing'
  | 'previewed' | 'importing' | 'imported' | 'deleting' | 'deleted'

export interface BeetsFolderStatus {
  providerPath: string
  hash: string
  status: BeetsFolderImportStatus
}

export interface BeetsJobAcknowledgement {
  jobId: string
  kind: 'preview' | 'import_candidate'
  providerPath: string
  hash: string
  operationId: string
}

export interface BeetsImportChoice {
  taskId: string
  candidateId: string
  duplicateAction: 'skip' | 'keep'
}

export interface BeetsPreviewCandidate {
  id: string
  kind: 'candidate' | 'as-is'
  artist?: string
  album?: string
  year?: number
  source?: string
  distance: number
  penalties: readonly string[]
  trackCount: number
  duplicateCount: number
}

export interface BeetsPreviewSession {
  id: string
  providerPath: string
  hash: string
  progress: number
  tasks: readonly {
    id: string
    chosenCandidateId?: string
    currentMetadata: { artist?: string, album?: string, year?: number }
    items: readonly { title?: string, artist?: string, length?: number, format?: string }[]
    candidates: readonly BeetsPreviewCandidate[]
  }[]
}

export interface BeetsImportPort extends ServiceAdapter {
  listInboxes(context: OperationContext): Promise<readonly BeetsInboxStats[]>
  listFolders(context: OperationContext): Promise<readonly BeetsInboxFolder[]>
  listFolderStatuses(context: OperationContext): Promise<readonly BeetsFolderStatus[]>
  enqueuePreview(folder: { providerPath: string, hash: string }, context: OperationContext): Promise<BeetsJobAcknowledgement>
  getPreview(folder: { providerPath: string, hash: string }, context: OperationContext): Promise<BeetsPreviewSession>
  enqueueImport(folder: { providerPath: string, hash: string, sessionId: string, choices: readonly BeetsImportChoice[] }, context: OperationContext): Promise<BeetsJobAcknowledgement>
}

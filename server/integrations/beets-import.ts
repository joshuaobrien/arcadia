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

/** Read-only projection of beets-flask's inbox and import session state. */
export interface BeetsImportPort extends ServiceAdapter {
  listInboxes(context: OperationContext): Promise<readonly BeetsInboxStats[]>
  listFolders(context: OperationContext): Promise<readonly BeetsInboxFolder[]>
  listFolderStatuses(context: OperationContext): Promise<readonly BeetsFolderStatus[]>
}

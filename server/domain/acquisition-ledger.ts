import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CatalogRelease } from '../integrations/catalog.js'
import type { AcquisitionJob } from './acquisition.js'

interface LedgerDocument {
  schemaVersion: 1
  jobs: AcquisitionJob[]
}

export interface WantReleaseResult {
  job: AcquisitionJob
  created: boolean
}

/** Durable single-process ledger for Needle-owned acquisition intent. */
export class AcquisitionLedger {
  readonly #path: string
  #document: LedgerDocument | undefined
  #operations: Promise<void> = Promise.resolve()

  constructor(path: string) {
    this.#path = resolve(path)
  }

  list(): Promise<readonly AcquisitionJob[]> {
    return this.#serialize(async () => {
      const document = await this.#load()
      return structuredClone(document.jobs)
    })
  }

  wantRelease(release: CatalogRelease): Promise<WantReleaseResult> {
    return this.#serialize(async () => {
      const document = await this.#load()
      const existing = document.jobs.find((job) => job.searchRefs.some((ref) => sameRef(ref, release.ref)))
      if (existing) return { job: structuredClone(existing), created: false }

      const now = new Date().toISOString()
      const job: AcquisitionJob = {
        id: randomUUID(),
        state: 'wanted',
        artist: release.artistName,
        release: release.title,
        searchRefs: [release.ref],
        createdAt: now,
        updatedAt: now,
      }
      const nextDocument: LedgerDocument = {
        ...document,
        jobs: [job, ...document.jobs],
      }
      await this.#persist(nextDocument)
      this.#document = nextDocument
      return { job: structuredClone(job), created: true }
    })
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operations.then(operation, operation)
    this.#operations = result.then(() => undefined, () => undefined)
    return result
  }

  async #load(): Promise<LedgerDocument> {
    if (this.#document) return this.#document

    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, 'utf8'))
      if (!isLedgerDocument(parsed)) {
        throw new Error(`Unsupported or invalid acquisition ledger at ${this.#path}`)
      }
      this.#document = parsed
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) {
        this.#document = { schemaVersion: 1, jobs: [] }
      } else {
        throw error
      }
    }
    return this.#document
  }

  async #persist(document: LedgerDocument): Promise<void> {
    const directory = dirname(this.#path)
    const temporaryPath = `${this.#path}.${randomUUID()}.tmp`
    let replaced = false
    await mkdir(directory, { recursive: true })

    try {
      const file = await open(temporaryPath, 'wx', 0o600)
      try {
        await file.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporaryPath, this.#path)
      replaced = true
      await syncDirectory(directory)
    } catch (error) {
      if (replaced) this.#document = undefined
      await unlink(temporaryPath).catch((unlinkError) => {
        if (!isErrorCode(unlinkError, 'ENOENT')) throw unlinkError
      })
      throw error
    }
  }
}

function sameRef(left: { adapterId: string; nativeId: string }, right: { adapterId: string; nativeId: string }): boolean {
  return left.adapterId === right.adapterId && left.nativeId === right.nativeId
}

function isLedgerDocument(value: unknown): value is LedgerDocument {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<LedgerDocument>
  return document.schemaVersion === 1
    && Array.isArray(document.jobs)
    && document.jobs.every(isAcquisitionJob)
}

function isAcquisitionJob(value: unknown): value is AcquisitionJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Partial<AcquisitionJob>
  const allowedKeys = new Set(['id', 'state', 'artist', 'release', 'searchRefs', 'createdAt', 'updatedAt'])
  return Object.keys(job).every((key) => allowedKeys.has(key))
    && typeof job.id === 'string' && job.id.length > 0
    && job.state === 'wanted'
    && (job.artist === undefined || typeof job.artist === 'string')
    && typeof job.release === 'string' && job.release.length > 0
    && typeof job.createdAt === 'string' && job.createdAt.length > 0
    && typeof job.updatedAt === 'string' && job.updatedAt.length > 0
    && Array.isArray(job.searchRefs)
    && job.searchRefs.length === 1
    && job.searchRefs.every((ref) => Boolean(
      ref
      && typeof ref === 'object'
      && typeof ref.adapterId === 'string' && ref.adapterId.length > 0
      && typeof ref.nativeId === 'string' && ref.nativeId.length > 0,
    ))
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } catch (error) {
    if (!isErrorCode(error, 'EINVAL') && !isErrorCode(error, 'ENOTSUP')) throw error
  } finally {
    await handle.close()
  }
}

import { basename } from 'node:path'
import type { BeetsFolderImportStatus, BeetsFolderStatus, BeetsImportChoice, BeetsImportPort, BeetsInboxFolder, BeetsInboxStats, BeetsJobAcknowledgement, BeetsPreviewCandidate, BeetsPreviewSession } from './beets-import.js'
import type { AdapterHealth, OperationContext } from './common.js'
import { AdapterError } from './errors.js'

type JsonObject = Record<string, unknown>
type Fetch = typeof globalThis.fetch

export interface BeetsFlaskOptions {
  adapterId?: string
  baseUrl: string
  fetch?: Fetch
  timeoutMs?: number
}

const STATUS: Readonly<Record<number, BeetsFolderImportStatus>> = {
  [-2]: 'unknown', [-1]: 'failed', 0: 'not-started', 1: 'pending', 2: 'previewing',
  3: 'previewed', 4: 'importing', 5: 'imported', 6: 'deleting', 7: 'deleted',
}

export class BeetsFlaskAdapter implements BeetsImportPort {
  readonly adapterId: string
  readonly kind = 'beets' as const
  readonly #baseUrl: URL
  readonly #fetch: Fetch
  readonly #timeoutMs: number

  constructor(options: BeetsFlaskOptions) {
    const baseUrl = new URL(options.baseUrl)
    if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('beets-flask URL must use HTTP or HTTPS')
    this.adapterId = options.adapterId ?? 'beets'
    const path = baseUrl.pathname.replace(/\/$/, '')
    baseUrl.pathname = `${path.endsWith('/api_v1') ? path : `${path}/api_v1`}/`
    baseUrl.search = ''
    baseUrl.hash = ''
    this.#baseUrl = baseUrl
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? 10_000
  }

  async probe(context: OperationContext): Promise<AdapterHealth> {
    const started = performance.now()
    try {
      const config = object(await this.#json('config/', context), 'config')
      const version = requiredString(config.beets_version, 'config.beets_version')
      return { adapterId: this.adapterId, kind: this.kind, state: 'available', checkedAt: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), version, apiVersion: 'v1' }
    } catch (error) {
      if (error instanceof AdapterError && error.code !== 'authentication') {
        return { adapterId: this.adapterId, kind: this.kind, state: 'unavailable', checkedAt: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), apiVersion: 'v1', message: error.message }
      }
      throw error
    }
  }

  async listInboxes(context: OperationContext): Promise<readonly BeetsInboxStats[]> {
    return array(await this.#json('inbox/stats', context), 'inbox stats').map((item, index) => {
      const value = object(item, `inbox stats[${index}]`)
      const lastCreatedAt = optionalIso(value.last_created, `inbox stats[${index}].last_created`)
      return {
        name: requiredString(value.name, `inbox stats[${index}].name`),
        providerPath: requiredString(value.path, `inbox stats[${index}].path`),
        taggedCount: nonnegativeNumber(value.tagged_via_gui, `inbox stats[${index}].tagged_via_gui`),
        importedCount: nonnegativeNumber(value.imported_via_gui, `inbox stats[${index}].imported_via_gui`),
        bytes: statNumber(value.size, `inbox stats[${index}].size`),
        fileCount: statNumber(value.nFiles, `inbox stats[${index}].nFiles`),
        ...(lastCreatedAt ? { lastCreatedAt } : {}),
      }
    })
  }

  async listFolders(context: OperationContext): Promise<readonly BeetsInboxFolder[]> {
    return array(await this.#json('inbox/tree', context), 'inbox tree').map((item, index) => folder(item, `inbox tree[${index}]`))
  }

  async listFolderStatuses(context: OperationContext): Promise<readonly BeetsFolderStatus[]> {
    return array(await this.#json('session/status', context), 'session status').map((item, index) => {
      const value = object(item, `session status[${index}]`)
      const numericStatus = integer(value.status, `session status[${index}].status`)
      const status = STATUS[numericStatus]
      if (!status) invalid(`session status[${index}].status is not recognized`)
      return { providerPath: requiredString(value.path, `session status[${index}].path`), hash: requiredString(value.hash, `session status[${index}].hash`), status }
    })
  }

  async enqueuePreview(folder: { providerPath: string, hash: string }, context: OperationContext): Promise<BeetsJobAcknowledgement> {
    const body = { kind: 'preview', folder_hashes: [folder.hash], folder_paths: [folder.providerPath], job_frontend_refs: [context.operationId], group_albums: false, autotag: true }
    const response = await this.#json('session/enqueue', context, body, true)
    try { return this.#ack(response, folder, context, 'preview') } catch (error) { throw this.#unknownOutcome(error) }
  }

  async getPreview(folder: { providerPath: string, hash: string }, context: OperationContext): Promise<BeetsPreviewSession> {
    const value = object(await this.#json('session/by_folder', context, { folder_hashes: [folder.hash], folder_paths: [folder.providerPath] }), 'session')
    const tasks = array(value.tasks, 'session.tasks').map((input, taskIndex) => {
      const task = object(input, `session.tasks[${taskIndex}]`)
      const metadata = object(task.current_metadata, `session.tasks[${taskIndex}].current_metadata`)
      const normalizeCandidate = (input: unknown, kind: 'candidate' | 'as-is', index: number): BeetsPreviewCandidate => {
        const candidate = object(input, `session.tasks[${taskIndex}].${kind}[${index}]`)
        const info = object(candidate.info, `candidate.info`)
        const tracks = array(candidate.tracks, 'candidate.tracks').map((raw, trackIndex) => {
          const track = object(raw, `candidate.tracks[${trackIndex}]`)
          return {
            ...(optionalString(track.title) ? { title: optionalString(track.title) } : {}),
            ...(optionalString(track.artist) ? { artist: optionalString(track.artist) } : {}),
            ...(optionalNumber(track.length) === undefined ? {} : { length: optionalNumber(track.length) }),
            ...(optionalNumber(track.index) === undefined ? {} : { index: optionalNumber(track.index) }),
            ...(optionalNumber(track.medium) === undefined ? {} : { medium: optionalNumber(track.medium) }),
          }
        })
        return {
          id: requiredString(candidate.id, 'candidate.id'),
          kind,
          ...optionalTextFields(info),
          ...(optionalNumber(info.year) === undefined ? {} : { year: optionalNumber(info.year) }),
          ...(optionalString(info.data_source) ? { source: optionalString(info.data_source) } : {}),
          ...(optionalString(info.country) ? { country: optionalString(info.country) } : {}),
          ...(optionalString(info.label) ? { label: optionalString(info.label) } : {}),
          ...(optionalString(info.catalognum) ? { catalogNumber: optionalString(info.catalognum) } : {}),
          ...(optionalString(info.media) ? { media: optionalString(info.media) } : {}),
          ...(optionalNumber(info.mediums) === undefined ? {} : { mediumCount: optionalNumber(info.mediums) }),
          distance: nonnegativeNumber(candidate.distance, 'candidate.distance'),
          penalties: array(candidate.penalties, 'candidate.penalties').map((p, i) => requiredString(p, `candidate.penalties[${i}]`)),
          trackCount: tracks.length,
          tracks,
          trackMapping: numberMapping(candidate.mapping),
          duplicateCount: array(candidate.duplicate_ids, 'candidate.duplicate_ids').length,
        }
      }
      const candidates = array(task.candidates, 'task.candidates').map((candidate, index) => normalizeCandidate(candidate, 'candidate', index))
      candidates.push(normalizeCandidate(task.asis_candidate, 'as-is', candidates.length))
      return { id: requiredString(task.id, 'task.id'), ...(optionalString(task.chosen_candidate_id) ? { chosenCandidateId: optionalString(task.chosen_candidate_id) } : {}), currentMetadata: { ...optionalTextFields(metadata), ...(optionalNumber(metadata.year) === undefined ? {} : { year: optionalNumber(metadata.year) }) }, items: array(task.items, 'task.items').map((raw, index) => { const item = object(raw, `task.items[${index}]`); return { ...(optionalString(item.title) ? { title: optionalString(item.title) } : {}), ...(optionalString(item.artist) ? { artist: optionalString(item.artist) } : {}), ...(optionalNumber(item.length) === undefined ? {} : { length: optionalNumber(item.length) }), ...(optionalString(item.format) ? { format: optionalString(item.format) } : {}) } }), candidates }
    })
    const status = object(value.status, 'session.status')
    const session = { id: requiredString(value.id, 'session.id'), providerPath: requiredString(value.folder_path, 'session.folder_path'), hash: requiredString(value.folder_hash, 'session.folder_hash'), progress: integer(status.progress, 'session.status.progress'), tasks }
    if (session.providerPath === folder.providerPath && session.hash !== folder.hash) {
      throw new AdapterError({ code: 'not-found', adapterId: this.adapterId, message: 'No preview session exists for the current folder revision', retryable: false })
    }
    if (session.providerPath !== folder.providerPath || session.hash !== folder.hash) invalid('session does not match the requested folder path and hash')
    return session
  }

  async enqueueImport(folder: { providerPath: string, hash: string, sessionId: string, choices: readonly BeetsImportChoice[] }, context: OperationContext): Promise<BeetsJobAcknowledgement> {
    const candidate_ids = Object.fromEntries(folder.choices.map(choice => [choice.taskId, choice.candidateId]))
    const duplicate_actions = Object.fromEntries(folder.choices.map(choice => [choice.taskId, choice.duplicateAction]))
    const body = { kind: 'import_candidate', folder_hashes: [folder.hash], folder_paths: [folder.providerPath], job_frontend_refs: [context.operationId], candidate_ids, duplicate_actions }
    const response = await this.#json('session/enqueue', context, body, true)
    try { return this.#ack(response, folder, context, 'import_candidate') } catch (error) { throw this.#unknownOutcome(error) }
  }

  #ack(input: unknown, folder: { providerPath: string, hash: string }, context: OperationContext, kind: 'preview' | 'import_candidate'): BeetsJobAcknowledgement {
    const value = object(input, 'enqueue acknowledgement')
    if (integer(value.num_jobs, 'enqueue acknowledgement.num_jobs') !== 1) invalid('enqueue acknowledgement.num_jobs must be 1')
    const metas = array(value.job_metas, 'enqueue acknowledgement.job_metas')
    if (metas.length !== 1) invalid('enqueue acknowledgement.job_metas must contain one item')
    const meta = object(metas[0], 'enqueue acknowledgement.job_metas[0]')
    if (requiredString(meta.folder_path, 'job_meta.folder_path') !== folder.providerPath || requiredString(meta.folder_hash, 'job_meta.folder_hash') !== folder.hash || requiredString(meta.job_frontend_ref, 'job_meta.job_frontend_ref') !== context.operationId || requiredString(meta.job_kind, 'job_meta.job_kind') !== kind) invalid('enqueue acknowledgement does not match the request')
    return { jobId: requiredString(meta.job_id, 'job_meta.job_id'), kind, providerPath: folder.providerPath, hash: folder.hash, operationId: context.operationId }
  }

  async #json(path: string, context: OperationContext, body?: unknown, mutation = false): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), { method: body === undefined ? 'GET' : 'POST', signal, headers: { Accept: 'application/json', 'X-Arcadia-Operation-Id': context.operationId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    } catch (error) {
      if (mutation) throw this.#unknownOutcome(error)
      throw new AdapterError({ code: 'unavailable', adapterId: this.adapterId, message: 'beets-flask is unavailable', retryable: true }, { cause: error })
    }
    if (mutation && response.status >= 500) throw this.#unknownOutcome(this.#responseError(response.status))
    if (!response.ok) throw this.#responseError(response.status)
    try { const value: unknown = await response.json(); throwProviderException(value, this.adapterId); return value } catch (error) {
      if (mutation) throw this.#unknownOutcome(error)
      if (error instanceof AdapterError) throw error
      throw new AdapterError({ code: 'transient-provider-failure', adapterId: this.adapterId, message: 'beets-flask returned invalid JSON', retryable: true, providerStatus: response.status }, { cause: error })
    }
  }

  #unknownOutcome(cause: unknown): AdapterError {
    return new AdapterError({ code: 'unavailable', adapterId: this.adapterId, message: 'The beets-flask submission outcome is unknown; do not retry automatically', retryable: false, providerCode: 'outcome-unknown' }, { cause })
  }

  #responseError(status: number): AdapterError {
    return new AdapterError({ code: status === 401 || status === 403 ? 'authentication' : status === 404 ? 'not-found' : status === 429 ? 'rate-limited' : 'transient-provider-failure', adapterId: this.adapterId, message: `beets-flask request failed with status ${status}`, retryable: status === 429 || status >= 500, providerStatus: status })
  }
}

function throwProviderException(input: unknown, adapterId: string): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  const value = input as JsonObject
  const exception = value.exc ?? (typeof value.type === 'string' && typeof value.message === 'string' ? value : undefined)
  if (exception === null || exception === undefined) return
  const details = typeof exception === 'object' && !Array.isArray(exception) ? exception as JsonObject : {}
  const message = typeof details.message === 'string' ? details.message : typeof exception === 'string' ? exception : 'unknown provider exception'
  const type = typeof details.type === 'string' ? details.type : typeof value.type === 'string' ? value.type : ''
  throw new AdapterError({ code: /not.?found/i.test(type) ? 'not-found' : 'transient-provider-failure', adapterId, message: `beets-flask exception: ${message}`, retryable: false })
}

function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined }
function optionalNumber(value: unknown): number | undefined { if (value === null || value === undefined || value === '') return undefined; const number = typeof value === 'string' ? Number(value) : value; return typeof number === 'number' && Number.isFinite(number) ? number : undefined }
function optionalTextFields(value: JsonObject): { artist?: string, album?: string } { return { ...(optionalString(value.artist) ? { artist: optionalString(value.artist) } : {}), ...(optionalString(value.album) ? { album: optionalString(value.album) } : {}) } }
function numberMapping(value: unknown): Record<string, number> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) invalid('candidate.mapping must be an object')
  return Object.fromEntries(Object.entries(value as JsonObject).map(([key, mapped]) => {
    if (!/^\d+$/.test(key) || !Number.isInteger(mapped) || Number(mapped) < 0) invalid('candidate.mapping must contain non-negative track indexes')
    return [key, Number(mapped)]
  }))
}

export function createBeetsFlaskAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): BeetsFlaskAdapter | null {
  return env.BEETS_URL ? new BeetsFlaskAdapter({ baseUrl: env.BEETS_URL }) : null
}

function folder(input: unknown, location: string): BeetsInboxFolder {
  const value = object(input, location)
  const providerPath = requiredString(value.full_path, `${location}.full_path`)
  const providerType = requiredString(value.type, `${location}.type`)
  if (!['directory', 'file', 'archive'].includes(providerType)) invalid(`${location}.type is not recognized`)
  const children = value.children === undefined ? [] : array(value.children, `${location}.children`).map((child, index) => folder(child, `${location}.children[${index}]`))
  return { name: basename(providerPath), providerPath, hash: string(value.hash, `${location}.hash`), album: boolean(value.is_album, `${location}.is_album`), type: providerType === 'directory' ? 'directory' : 'file', children }
}

function invalid(message: string): never { throw new AdapterError({ code: 'transient-provider-failure', adapterId: 'beets', message: `beets-flask returned an invalid response: ${message}`, retryable: false }) }
function object(value: unknown, location: string): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${location} must be an object`); return value as JsonObject }
function array(value: unknown, location: string): unknown[] { if (!Array.isArray(value)) invalid(`${location} must be an array`); return value }
function string(value: unknown, location: string): string { if (typeof value !== 'string') invalid(`${location} must be a string`); return value }
function requiredString(value: unknown, location: string): string { if (typeof value !== 'string' || !value) invalid(`${location} must be a non-empty string`); return value }
function nonnegativeNumber(value: unknown, location: string): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(`${location} must be a non-negative number`); return value }
function statNumber(value: unknown, location: string): number | null { if (value === -1) return null; return nonnegativeNumber(value, location) }
function integer(value: unknown, location: string): number { if (typeof value !== 'number' || !Number.isInteger(value)) invalid(`${location} must be an integer`); return value }
function boolean(value: unknown, location: string): boolean { if (typeof value !== 'boolean') invalid(`${location} must be a boolean`); return value }
function optionalIso(value: unknown, location: string): string | undefined { if (value === null || value === undefined) return undefined; if (typeof value !== 'string' || !value) invalid(`${location} must be an ISO date-time`); const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`; if (Number.isNaN(Date.parse(timestamp))) invalid(`${location} must be an ISO date-time`); return new Date(timestamp).toISOString() }

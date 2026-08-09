import { basename } from 'node:path'
import type { BeetsFolderImportStatus, BeetsFolderStatus, BeetsImportPort, BeetsInboxFolder, BeetsInboxStats } from './beets-import.js'
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

  async #json(path: string, context: OperationContext): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), { signal, headers: { Accept: 'application/json', 'X-Needle-Operation-Id': context.operationId } })
    } catch (error) {
      throw new AdapterError({ code: 'unavailable', adapterId: this.adapterId, message: 'beets-flask is unavailable', retryable: true }, { cause: error })
    }
    if (!response.ok) throw this.#responseError(response.status)
    try { return await response.json() } catch (error) {
      throw new AdapterError({ code: 'transient-provider-failure', adapterId: this.adapterId, message: 'beets-flask returned invalid JSON', retryable: true, providerStatus: response.status }, { cause: error })
    }
  }

  #responseError(status: number): AdapterError {
    return new AdapterError({ code: status === 401 || status === 403 ? 'authentication' : status === 404 ? 'not-found' : status === 429 ? 'rate-limited' : 'transient-provider-failure', adapterId: this.adapterId, message: `beets-flask request failed with status ${status}`, retryable: status === 429 || status >= 500, providerStatus: status })
  }
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

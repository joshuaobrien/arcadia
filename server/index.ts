import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import type { FastifyReply, FastifyServerOptions } from 'fastify'
import { readdir, statfs } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLidarrAdapterFromEnv } from './integrations/lidarr.js'
import { isAdapterError } from './integrations/errors.js'
import { AcquisitionLedger } from './domain/acquisition-ledger.js'
import type { AcquisitionAutomationPort } from './integrations/acquisition.js'
import type { CatalogLookupPort, CatalogRelease } from './integrations/catalog.js'
import type { OperationContext } from './integrations/common.js'

const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.aiff',
  '.alac',
  '.ape',
  '.dsf',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
  '.wma',
])

interface MediaSummary {
  tracks: number
  albums: number
  artists: number
  formats: Record<string, number>
}

interface MediaScan {
  configured: boolean
  mounted: boolean
  path: string | null
  capacity: { totalBytes: number; freeBytes: number; usedBytes: number } | null
  media: MediaSummary
  scannedAt: string | null
}

type LidarrReadAdapter = CatalogLookupPort & Pick<
  AcquisitionAutomationPort,
  'listProfiles' | 'listRoots' | 'listQueue' | 'listHistory'
>

interface AcquisitionLedgerPort {
  list: AcquisitionLedger['list']
  wantRelease: AcquisitionLedger['wantRelease']
}

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger']
  walkmanPath?: string
  libraryPath?: string
  lidarr?: LidarrReadAdapter | null
  acquisitionLedger?: AcquisitionLedgerPort | null
  staticRoot?: string | null
}

interface PageQuery {
  cursor?: string
  limit?: number
}

interface HistoryQuery extends PageQuery {
  since?: string
}

const cache = new Map<string, { createdAt: number; value: MediaScan }>()
const CACHE_TTL_MS = 30_000
const serverDirectory = dirname(fileURLToPath(import.meta.url))

function emptyMedia(): MediaSummary {
  return { tracks: 0, albums: 0, artists: 0, formats: {} }
}

export async function scanMediaRoot(configuredPath?: string): Promise<MediaScan> {
  if (!configuredPath) {
    return {
      configured: false,
      mounted: false,
      path: null,
      capacity: null,
      media: emptyMedia(),
      scannedAt: null,
    }
  }

  const root = resolve(configuredPath)
  const artists = new Set<string>()
  const albums = new Set<string>()
  const formats = new Map<string, number>()
  let tracks = 0

  try {
    const filesystem = await statfs(root, { bigint: true })
    const pending: string[] = [root]

    while (pending.length > 0) {
      const directory = pending.pop()!
      const entries = await readdir(directory, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = resolve(directory, entry.name)
        if (entry.isDirectory()) {
          pending.push(entryPath)
          continue
        }
        if (!entry.isFile()) continue

        const extension = extname(entry.name).toLowerCase()
        if (!AUDIO_EXTENSIONS.has(extension)) continue

        tracks += 1
        formats.set(extension.slice(1).toUpperCase(), (formats.get(extension.slice(1).toUpperCase()) ?? 0) + 1)

        const segments = relative(root, entryPath).split(sep)
        if (segments.length >= 2) artists.add(segments[0])
        if (segments.length >= 3) albums.add(`${segments[0]}${sep}${segments[1]}`)
      }
    }

    const totalBytes = filesystem.blocks * filesystem.bsize
    const freeBytes = filesystem.bavail * filesystem.bsize

    return {
      configured: true,
      mounted: true,
      path: root,
      capacity: {
        totalBytes: Number(totalBytes),
        freeBytes: Number(freeBytes),
        usedBytes: Number(totalBytes - freeBytes),
      },
      media: {
        tracks,
        albums: albums.size,
        artists: artists.size,
        formats: Object.fromEntries([...formats.entries()].sort()),
      },
      scannedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) {
      return {
        configured: true,
        mounted: false,
        path: root,
        capacity: null,
        media: emptyMedia(),
        scannedAt: null,
      }
    }
    throw error
  }
}

async function cachedScan(path?: string): Promise<MediaScan> {
  const key = path || '__unconfigured__'
  const hit = cache.get(key)
  if (hit && Date.now() - hit.createdAt < CACHE_TTL_MS) return hit.value

  const value = await scanMediaRoot(path)
  cache.set(key, { createdAt: Date.now(), value })
  return value
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true })
  const walkmanPath = options.walkmanPath ?? process.env.WALKMAN_PATH
  const libraryPath = options.libraryPath ?? process.env.MUSIC_LIBRARY_PATH
  const lidarr = options.lidarr === undefined ? createLidarrAdapterFromEnv() : options.lidarr
  const acquisitionLedger = options.acquisitionLedger === undefined
    ? process.env.NEEDLE_STATE_PATH ? new AcquisitionLedger(process.env.NEEDLE_STATE_PATH) : null
    : options.acquisitionLedger
  const staticRoot = options.staticRoot === undefined
    ? process.env.NODE_ENV === 'production' ? resolve(serverDirectory, '../dist') : null
    : options.staticRoot

  if (staticRoot) {
    app.register(fastifyStatic, { root: resolve(staticRoot) })
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: { code: 'not-found', message: 'Route not found' } })
    })
  }

  async function lidarrRoute<T>(
    reply: FastifyReply,
    operation: (adapter: LidarrReadAdapter, context: OperationContext) => Promise<T>,
  ): Promise<T | undefined> {
    if (!lidarr) {
      reply.code(503).send({
        error: {
          code: 'unavailable',
          adapterId: 'lidarr',
          message: 'Lidarr is not configured',
          retryable: false,
        },
      })
      return undefined
    }
    try {
      return await operation(lidarr, {
        operationId: crypto.randomUUID(),
      })
    } catch (error) {
      if (!isAdapterError(error)) throw error
      const status = error.code === 'authentication' ? 502
        : error.code === 'invalid-request' ? 400
          : error.code === 'not-found' ? 404
            : error.code === 'unsupported' ? 501
              : 502
      reply.code(status).send({ error: error.toJSON() })
      return undefined
    }
  }

  app.get('/api/health', async () => ({ status: 'ok' }))
  app.get('/api/device', async () => ({
    profile: { manufacturer: 'Sony', model: 'NW-A55' },
    ...(await cachedScan(walkmanPath)),
  }))
  app.get('/api/library', async () => cachedScan(libraryPath))
  app.get('/api/status', async () => {
    const [device, library] = await Promise.all([
      cachedScan(walkmanPath),
      cachedScan(libraryPath),
    ])
    return {
      device: { profile: { manufacturer: 'Sony', model: 'NW-A55' }, ...device },
      library,
    }
  })
  app.get('/api/acquisitions', async () => ({
    configured: acquisitionLedger !== null,
    items: acquisitionLedger ? await acquisitionLedger.list() : [],
  }))
  app.post<{ Body: { release: CatalogRelease } }>('/api/acquisitions', {
    schema: {
      body: {
        type: 'object',
        required: ['release'],
        additionalProperties: false,
        properties: {
          release: {
            type: 'object',
            required: ['ref', 'artistRef', 'title'],
            additionalProperties: false,
            properties: {
              ref: providerRefSchema(),
              artistRef: providerRefSchema(),
              artistName: { type: 'string', minLength: 1, maxLength: 500 },
              title: { type: 'string', minLength: 1, maxLength: 500 },
              releaseDate: { type: 'string', minLength: 1, maxLength: 40 },
              releaseType: { type: 'string', minLength: 1, maxLength: 100 },
              musicBrainzReleaseGroupId: { type: 'string', minLength: 1, maxLength: 100 },
              monitored: { type: 'boolean' },
              images: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 2000 } },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!acquisitionLedger) return reply.code(503).send({
      error: {
        code: 'unavailable',
        message: 'Needle acquisition state is not configured',
      },
    })
    const result = await acquisitionLedger.wantRelease(request.body.release)
    return reply.code(result.created ? 201 : 200).send(result.job)
  })
  app.get('/api/services/lidarr', async (_request, reply) => {
    if (!lidarr) return { configured: false }
    const health = await lidarrRoute(reply, (adapter, context) => adapter.probe(context))
    return reply.sent ? undefined : { configured: true, health }
  })
  app.get<{ Querystring: { term: string } }>('/api/services/lidarr/artists', {
    schema: {
      querystring: {
        type: 'object',
        required: ['term'],
        additionalProperties: false,
        properties: { term: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.lookupArtists(request.query.term, context),
  ))
  app.get<{ Querystring: { term: string } }>('/api/services/lidarr/releases', {
    schema: {
      querystring: {
        type: 'object',
        required: ['term'],
        additionalProperties: false,
        properties: { term: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.lookupReleases(request.query.term, context),
  ))
  app.get('/api/services/lidarr/profiles', async (_request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.listProfiles(context),
  ))
  app.get('/api/services/lidarr/roots', async (_request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.listRoots(context),
  ))
  app.get<{ Querystring: PageQuery }>('/api/services/lidarr/queue', {
    schema: { querystring: pageQuerySchema() },
  }, async (request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.listQueue({
      cursor: request.query?.cursor,
      limit: Math.min(100, Math.max(1, Number(request.query?.limit) || 25)),
    }, context),
  ))
  app.get<{ Querystring: HistoryQuery }>('/api/services/lidarr/history', {
    schema: {
      querystring: {
        ...pageQuerySchema(),
        properties: {
          ...pageQuerySchema().properties,
          since: { type: 'string', minLength: 1, maxLength: 40 },
        },
      },
    },
  }, async (request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.listHistory(request.query?.since, {
      cursor: request.query?.cursor,
      limit: Math.min(100, Math.max(1, Number(request.query?.limit) || 25)),
    }, context),
  ))

  return app
}

function pageQuerySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      cursor: { type: 'string', minLength: 1, maxLength: 100 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
  }
}

function providerRefSchema() {
  return {
    type: 'object',
    required: ['adapterId', 'nativeId'],
    additionalProperties: false,
    properties: {
      adapterId: { type: 'string', minLength: 1, maxLength: 100 },
      nativeId: { type: 'string', minLength: 1, maxLength: 500 },
    },
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntryPoint) {
  const app = buildApp()
  const port = Number(process.env.PORT || 8787)
  await app.listen({ host: '0.0.0.0', port })
}

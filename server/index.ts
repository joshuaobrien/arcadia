import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import type { FastifyReply, FastifyServerOptions } from 'fastify'
import { readdir, statfs } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLidarrAdapterFromEnv } from './integrations/lidarr.js'
import { createJellyfinAdapterFromEnv } from './integrations/jellyfin.js'
import { createBeetsFlaskAdapterFromEnv } from './integrations/beets-flask.js'
import { isAdapterError } from './integrations/errors.js'
import { AcquisitionRepository } from './domain/acquisition-repository.js'
import type { AcquisitionAutomationPort } from './integrations/acquisition.js'
import type { CatalogLookupPort, CatalogRelease } from './integrations/catalog.js'
import type { OperationContext } from './integrations/common.js'
import type { AcquisitionDefaults } from './domain/acquisition.js'
import { readCanonicalLibrary } from './library.js'
import type { LibraryInventory } from './library.js'
import type { LibraryAlbum, LibraryCatalogPort } from './integrations/library-catalog.js'
import type { BeetsImportPort } from './integrations/beets-import.js'
import { mergeMusicReleases } from './music-releases.js'

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

interface AcquisitionRepositoryPort {
  list: AcquisitionRepository['list']
  wantRelease: AcquisitionRepository['wantRelease']
  getDefaults: AcquisitionRepository['getDefaults']
  setDefaults: AcquisitionRepository['setDefaults']
  close?: AcquisitionRepository['close']
}

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger']
  walkmanPath?: string
  libraryPath?: string
  lidarr?: LidarrReadAdapter | null
  jellyfin?: LibraryCatalogPort | null
  beets?: BeetsImportPort | null
  acquisitionRepository?: AcquisitionRepositoryPort | null
  staticRoot?: string | null
}

interface PageQuery {
  cursor?: string
  limit?: number
}

interface LibraryAlbumQuery extends PageQuery {
  term?: string
}

interface HistoryQuery extends PageQuery {
  since?: string
}

const cache = new Map<string, { createdAt: number; value: MediaScan }>()
const CACHE_TTL_MS = 30_000
interface LibraryCacheEntry {
  completedAt: number | null
  value: Promise<LibraryInventory>
}
const libraryCache = new Map<string, LibraryCacheEntry>()
const LIBRARY_CACHE_TTL_MS = 5 * 60_000
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

async function cachedLibrary(path?: string): Promise<LibraryInventory> {
  const key = path || '__unconfigured__'
  const hit = libraryCache.get(key)
  if (hit && (hit.completedAt === null || Date.now() - hit.completedAt < LIBRARY_CACHE_TTL_MS)) return hit.value
  const value = readCanonicalLibrary(path)
  const entry: LibraryCacheEntry = { completedAt: null, value }
  libraryCache.set(key, entry)
  value.then(
    () => {
      if (libraryCache.get(key) === entry) entry.completedAt = Date.now()
    },
    () => {
      if (libraryCache.get(key) === entry) libraryCache.delete(key)
    },
  )
  return value
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true })
  const walkmanPath = options.walkmanPath ?? process.env.WALKMAN_PATH
  const libraryPath = options.libraryPath ?? process.env.MUSIC_LIBRARY_PATH
  const lidarr = options.lidarr === undefined ? createLidarrAdapterFromEnv() : options.lidarr
  const jellyfin = options.jellyfin === undefined ? createJellyfinAdapterFromEnv() : options.jellyfin
  const beets = options.beets === undefined ? createBeetsFlaskAdapterFromEnv() : options.beets
  const acquisitionRepository = options.acquisitionRepository === undefined
    ? process.env.NEEDLE_DATABASE_PATH ? new AcquisitionRepository(process.env.NEEDLE_DATABASE_PATH) : null
    : options.acquisitionRepository
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

  if (acquisitionRepository?.close) {
    app.addHook('onClose', async () => acquisitionRepository.close?.())
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

  async function libraryCatalogRoute<T>(
    reply: FastifyReply,
    operation: (adapter: LibraryCatalogPort, context: OperationContext) => Promise<T>,
  ): Promise<T | undefined> {
    if (!jellyfin) {
      reply.code(503).send({
        error: { code: 'unavailable', adapterId: 'jellyfin', message: 'Jellyfin is not configured', retryable: false },
      })
      return undefined
    }
    try {
      return await operation(jellyfin, { operationId: crypto.randomUUID() })
    } catch (error) {
      if (!isAdapterError(error)) throw error
      reply.code(error.code === 'not-found' ? 404 : error.code === 'invalid-request' ? 400 : 502)
        .send({ error: error.toJSON() })
      return undefined
    }
  }

  async function beetsRoute<T>(
    reply: FastifyReply,
    operation: (adapter: BeetsImportPort, context: OperationContext) => Promise<T>,
  ): Promise<T | undefined> {
    if (!beets) {
      reply.code(503).send({ error: { code: 'unavailable', adapterId: 'beets', message: 'beets-flask is not configured', retryable: false } })
      return undefined
    }
    try {
      return await operation(beets, { operationId: crypto.randomUUID() })
    } catch (error) {
      if (!isAdapterError(error)) throw error
      const status = error.code === 'invalid-request' ? 400 : error.code === 'not-found' ? 404 : error.code === 'unsupported' ? 501 : 502
      reply.code(status).send({ error: error.toJSON() })
      return undefined
    }
  }

  app.get('/api/health', async () => ({ status: 'ok' }))
  app.get<{ Querystring: { term: string } }>('/api/music/releases', {
    schema: {
      querystring: {
        type: 'object',
        required: ['term'],
        additionalProperties: false,
        properties: { term: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (request) => {
    const operationId = crypto.randomUUID()
    const [libraryResult, catalogResult] = await Promise.all([
      readProjection(jellyfin !== null, [], () => listAllMatchingAlbums(
        jellyfin!,
        request.query.term,
        { operationId: `${operationId}:library` },
      )),
      readProjection(lidarr !== null, [], () => lidarr!.lookupReleases(
        request.query.term,
        { operationId: `${operationId}:catalog` },
      )),
    ])
    const acquisitions = acquisitionRepository?.list() ?? []
    return {
      sources: {
        library: libraryResult.state,
        catalog: catalogResult.state,
        wanted: acquisitionRepository ? 'available' : 'unconfigured',
      },
      items: mergeMusicReleases(libraryResult.value, catalogResult.value, acquisitions, request.query.term),
    }
  })
  app.get('/api/device', async () => ({
    profile: { manufacturer: 'Sony', model: 'NW-A55' },
    ...(await cachedScan(walkmanPath)),
  }))
  app.get('/api/library', async () => cachedScan(libraryPath))
  app.get<{ Params: { albumId: string } }>('/api/library/albums/:albumId/artwork', {
    exposeHeadRoute: false,
    schema: {
      params: {
        type: 'object',
        required: ['albumId'],
        additionalProperties: false,
        properties: { albumId: { type: 'string', pattern: '^[a-fA-F0-9-]{32,36}$' } },
      },
    },
  }, async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
    const artwork = await libraryCatalogRoute(reply, (adapter, context) => (
      adapter.getAlbumArtwork(request.params.albumId, context)
    ))
    if (reply.sent) return
    if (!artwork) return reply.code(404).send()
    return reply
      .type(artwork.contentType)
      .header('Cache-Control', 'private, max-age=300')
      .send(Buffer.isBuffer(artwork.data)
        ? artwork.data
        : Buffer.from(artwork.data.buffer, artwork.data.byteOffset, artwork.data.byteLength))
  })
  app.get<{ Querystring: LibraryAlbumQuery }>('/api/library/albums', {
    schema: { querystring: libraryAlbumQuerySchema() },
  }, async (request, reply) => {
    if (!jellyfin) return { configured: false, mounted: false, scannedAt: null, total: 0, items: [] }
    const page = await libraryCatalogRoute(reply, (adapter, context) => adapter.listAlbums({
      cursor: request.query?.cursor,
      limit: request.query?.limit ?? 50,
      term: request.query?.term,
    }, context))
    return reply.sent ? undefined : { configured: true, mounted: true, scannedAt: null, ...page }
  })
  app.get<{ Params: { albumId: string }; Querystring: PageQuery }>('/api/library/albums/:albumId/tracks', {
    schema: {
      params: {
        type: 'object',
        required: ['albumId'],
        additionalProperties: false,
        properties: { albumId: { type: 'string', pattern: '^[a-fA-F0-9-]{32,36}$' } },
      },
      querystring: libraryPageQuerySchema(),
    },
  }, async (request, reply) => libraryCatalogRoute(reply, (adapter, context) => adapter.listAlbumTracks(
    request.params.albumId,
    { cursor: request.query?.cursor, limit: request.query?.limit ?? 100 },
    context,
  )))
  app.get<{ Querystring: PageQuery }>('/api/library/tracks', {
    schema: { querystring: libraryPageQuerySchema() },
  }, async (request) => {
    const inventory = await cachedLibrary(libraryPath)
    const tracks = inventory.tracks
    const offset = Math.min(tracks.length, Number(request.query?.cursor) || 0)
    const limit = request.query?.limit ?? 50
    const end = Math.min(tracks.length, offset + limit)
    return {
      configured: inventory.configured,
      mounted: inventory.mounted,
      scannedAt: inventory.scannedAt,
      total: tracks.length,
      items: tracks.slice(offset, end),
      ...(end < tracks.length ? { nextCursor: String(end) } : {}),
    }
  })
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
    configured: acquisitionRepository !== null,
    items: acquisitionRepository ? acquisitionRepository.list() : [],
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
              musicBrainzReleaseGroupId: {
                type: 'string',
                pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
              },
              monitored: { type: 'boolean' },
              images: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 2000 } },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!acquisitionRepository) return reply.code(503).send({
      error: {
        code: 'unavailable',
        message: 'Needle acquisition state is not configured',
      },
    })
    const result = acquisitionRepository.wantRelease(request.body.release)
    return reply.code(result.created ? 201 : 200).send(result.job)
  })
  app.get('/api/acquisition-defaults', async (_request, reply) => {
    if (!acquisitionRepository) return reply.code(503).send({
      error: {
        code: 'unavailable',
        message: 'Needle acquisition state is not configured',
      },
    })
    return { value: acquisitionRepository.getDefaults() }
  })
  app.put<{ Body: AcquisitionDefaults }>('/api/acquisition-defaults', {
    schema: {
      body: {
        type: 'object',
        required: ['root', 'qualityProfile'],
        additionalProperties: false,
        properties: {
          root: providerRefSchema(),
          qualityProfile: providerRefSchema(),
          metadataProfile: providerRefSchema(),
        },
      },
    },
  }, async (request, reply) => {
    if (!acquisitionRepository) return reply.code(503).send({
      error: {
        code: 'unavailable',
        message: 'Needle acquisition state is not configured',
      },
    })
    const available = await lidarrRoute(reply, async (adapter, context) => {
      const [roots, profiles] = await Promise.all([
        adapter.listRoots(context),
        adapter.listProfiles(context),
      ])
      return { roots, profiles }
    })
    if (!available) return
    const rootExists = available.roots.some(({ ref }) => sameRef(ref, request.body.root))
    const qualityExists = available.profiles.some(({ ref, kind }) => (
      kind === 'quality' && sameRef(ref, request.body.qualityProfile)
    ))
    const metadataExists = !request.body.metadataProfile || available.profiles.some(({ ref, kind }) => (
      kind === 'metadata' && sameRef(ref, request.body.metadataProfile!)
    ))
    if (!rootExists || !qualityExists || !metadataExists) {
      return reply.code(400).send({
        error: {
          code: 'invalid-request',
          message: 'Acquisition defaults must reference available Lidarr roots and profiles',
        },
      })
    }
    return { value: acquisitionRepository.setDefaults(request.body) }
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

  app.get('/api/services/beets', async (_request, reply) => {
    if (!beets) return { configured: false }
    const health = await beetsRoute(reply, (adapter, context) => adapter.probe(context))
    return reply.sent ? undefined : { configured: true, health }
  })
  app.get('/api/imports/inboxes', async (_request, reply) => {
    const items = await beetsRoute(reply, (adapter, context) => adapter.listInboxes(context))
    return reply.sent ? undefined : { items }
  })
  app.get('/api/imports/folders', async (_request, reply) => {
    const items = await beetsRoute(reply, (adapter, context) => adapter.listFolders(context))
    return reply.sent ? undefined : { items }
  })
  app.get('/api/imports/status', async (_request, reply) => {
    const items = await beetsRoute(reply, (adapter, context) => adapter.listFolderStatuses(context))
    return reply.sent ? undefined : { items }
  })

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

function libraryPageQuerySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      cursor: { type: 'string', pattern: '^(0|[1-9][0-9]*)$', maxLength: 16 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    },
  }
}

function libraryAlbumQuerySchema() {
  const page = libraryPageQuerySchema()
  return {
    ...page,
    properties: {
      ...page.properties,
      term: { type: 'string', minLength: 1, maxLength: 200 },
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

function sameRef(left: { adapterId: string; nativeId: string }, right: { adapterId: string; nativeId: string }): boolean {
  return left.adapterId === right.adapterId && left.nativeId === right.nativeId
}

async function readProjection<T>(
  configured: boolean,
  empty: T,
  operation: () => Promise<T>,
): Promise<{ state: 'available' | 'unconfigured' | 'unavailable'; value: T }> {
  if (!configured) return { state: 'unconfigured', value: empty }
  try {
    return { state: 'available', value: await operation() }
  } catch (error) {
    if (!isAdapterError(error)) throw error
    return { state: 'unavailable', value: empty }
  }
}

async function listAllMatchingAlbums(
  adapter: LibraryCatalogPort,
  term: string,
  context: OperationContext,
): Promise<LibraryAlbum[]> {
  const items: LibraryAlbum[] = []
  let cursor: string | undefined
  do {
    const page = await adapter.listAlbums({ cursor, limit: 100, term }, context)
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
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

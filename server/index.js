import Fastify from 'fastify'
import { readdir, statfs } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLidarrAdapterFromEnv } from './services/lidarr.ts'
import { isAdapterError } from './services/errors.ts'

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

const cache = new Map()
const CACHE_TTL_MS = 30_000

function emptyMedia() {
  return { tracks: 0, albums: 0, artists: 0, formats: {} }
}

export async function scanMediaRoot(configuredPath) {
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
  const artists = new Set()
  const albums = new Set()
  const formats = new Map()
  let tracks = 0

  try {
    const filesystem = await statfs(root, { bigint: true })
    const pending = [root]

    while (pending.length > 0) {
      const directory = pending.pop()
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
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
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

async function cachedScan(path) {
  const key = path || '__unconfigured__'
  const hit = cache.get(key)
  if (hit && Date.now() - hit.createdAt < CACHE_TTL_MS) return hit.value

  const value = await scanMediaRoot(path)
  cache.set(key, { createdAt: Date.now(), value })
  return value
}

export function buildApp(options = {}) {
  const app = Fastify({ logger: options.logger ?? true })
  const walkmanPath = options.walkmanPath ?? process.env.WALKMAN_PATH
  const libraryPath = options.libraryPath ?? process.env.MUSIC_LIBRARY_PATH
  const lidarr = options.lidarr === undefined ? createLidarrAdapterFromEnv() : options.lidarr

  async function lidarrRoute(reply, operation) {
    if (!lidarr) return reply.code(503).send({
      error: {
        code: 'unavailable',
        adapterId: 'lidarr',
        message: 'Lidarr is not configured',
        retryable: false,
      },
    })
    try {
      return await operation(lidarr, {
        operationId: crypto.randomUUID(),
        signal: reply.request.raw.signal,
      })
    } catch (error) {
      if (!isAdapterError(error)) throw error
      const status = error.code === 'authentication' ? 502
        : error.code === 'invalid-request' ? 400
          : error.code === 'not-found' ? 404
            : error.code === 'unsupported' ? 501
              : 502
      return reply.code(status).send({ error: error.toJSON() })
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
  app.get('/api/services/lidarr', async (_request, reply) => {
    if (!lidarr) return { configured: false }
    const health = await lidarrRoute(reply, (adapter, context) => adapter.probe(context))
    return reply.sent ? undefined : { configured: true, health }
  })
  app.get('/api/services/lidarr/artists', async (request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.lookupArtists(String(request.query?.term ?? ''), context),
  ))
  app.get('/api/services/lidarr/releases', async (request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.lookupReleases(String(request.query?.term ?? ''), context),
  ))
  app.get('/api/services/lidarr/profiles', async (_request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.listProfiles(context),
  ))
  app.get('/api/services/lidarr/roots', async (_request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.listRoots(context),
  ))
  app.get('/api/services/lidarr/queue', async (request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.listQueue({
      cursor: request.query?.cursor,
      limit: Math.min(100, Math.max(1, Number(request.query?.limit) || 25)),
    }, context),
  ))
  app.get('/api/services/lidarr/history', async (request, reply) => lidarrRoute(
    reply,
    (adapter, context) => adapter.listHistory(request.query?.since, {
      cursor: request.query?.cursor,
      limit: Math.min(100, Math.max(1, Number(request.query?.limit) || 25)),
    }, context),
  ))

  return app
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntryPoint) {
  const app = buildApp()
  const port = Number(process.env.PORT || 8787)
  await app.listen({ host: '0.0.0.0', port })
}

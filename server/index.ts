import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import type { FastifyReply, FastifyServerOptions } from 'fastify'
import { readdir, statfs } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { MusicBrainzAdapter } from './integrations/musicbrainz.js'
import { createSlskdAdapterFromEnv, type SlskdAdapter } from './integrations/slskd.js'
import { DirectAcquisitionService } from './domain/direct-acquisition.js'
import { createJellyfinAdapterFromEnv } from './integrations/jellyfin.js'
import { createBeetsFlaskAdapterFromEnv } from './integrations/beets-flask.js'
import { isAdapterError } from './integrations/errors.js'
import { AcquisitionLinkConflictError, AcquisitionRepository } from './domain/acquisition-repository.js'
import type { BeetsImportOperation, BeetsImportSelection } from './domain/acquisition-repository.js'
import type { CatalogLookupPort, CatalogRelease } from './integrations/catalog.js'
import type { OperationContext } from './integrations/common.js'
import type { AcquisitionJob } from './domain/acquisition.js'
import { readCanonicalLibrary } from './library.js'
import type { LibraryInventory } from './library.js'
import type { LibraryAlbum, LibraryCatalogPort, LibraryCatalogQuery, LibraryCatalogRefreshPort } from './integrations/library-catalog.js'
import type { BeetsImportChoice, BeetsImportPort, BeetsInboxFolder, BeetsPreviewSession } from './integrations/beets-import.js'
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

interface AcquisitionRepositoryPort {
  list: AcquisitionRepository['list']
  get?: AcquisitionRepository['get']
  wantRelease: AcquisitionRepository['wantRelease']
  close?: AcquisitionRepository['close']
  createBeetsImportOperation?: AcquisitionRepository['createBeetsImportOperation']
  getBeetsImportOperation?: AcquisitionRepository['getBeetsImportOperation']
  listBeetsImportOperations?: AcquisitionRepository['listBeetsImportOperations']
  transitionBeetsImportOperation?: AcquisitionRepository['transitionBeetsImportOperation']
  abortBeetsImportOperation?: AcquisitionRepository['abortBeetsImportOperation']
  getDirectWorkflow?: AcquisitionRepository['getDirectWorkflow']
}

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger']
  walkmanPath?: string
  libraryPath?: string
  catalog?: CatalogLookupPort | null
  jellyfin?: (LibraryCatalogPort & Partial<LibraryCatalogRefreshPort>) | null
  beets?: BeetsImportPort | null
  acquisitionRepository?: AcquisitionRepositoryPort | null
  staticRoot?: string | null
  directAcquisition?: DirectAcquisitionService | null
  slskd?: SlskdAdapter | null
}

interface PageQuery {
  cursor?: string
  limit?: number
}

interface LibraryAlbumQuery extends PageQuery {
  term?: string
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
  const catalog = options.catalog === undefined ? new MusicBrainzAdapter() : options.catalog
  const jellyfin = options.jellyfin === undefined ? createJellyfinAdapterFromEnv() : options.jellyfin
  const beets = options.beets === undefined ? createBeetsFlaskAdapterFromEnv() : options.beets
  const acquisitionRepository = options.acquisitionRepository === undefined
    ? process.env.NEEDLE_DATABASE_PATH ? new AcquisitionRepository(process.env.NEEDLE_DATABASE_PATH) : null
    : options.acquisitionRepository
  const slskd = options.slskd === undefined ? createSlskdAdapterFromEnv() : options.slskd
  const directAcquisition = options.directAcquisition === undefined
    ? slskd && acquisitionRepository instanceof AcquisitionRepository
      ? new DirectAcquisitionService(acquisitionRepository, catalog instanceof MusicBrainzAdapter ? catalog : new MusicBrainzAdapter(), slskd, directOptions(process.env))
      : null
    : options.directAcquisition
  const staticRoot = options.staticRoot === undefined
    ? process.env.NODE_ENV === 'production' ? resolve(serverDirectory, '../dist') : null
    : options.staticRoot
  const submittedBeetsPreviews = new Set<string>()
  const submittedBeetsImports = new Set<string>()
  const beetsPreviewSessions = new Map<string, { session: BeetsPreviewSession, cachedAt: number }>()
  const previewSessionTtlMs = 30 * 60_000
  const maxPreviewSessions = 100

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

  async function catalogRoute<T>(reply: FastifyReply, operation: (adapter: CatalogLookupPort, context: OperationContext) => Promise<T>): Promise<T | undefined> {
    if (!catalog) return reply.code(503).send({ error: { code: 'unavailable', adapterId: 'musicbrainz', message: 'Catalog is not configured', retryable: false } })
    try { return await operation(catalog, { operationId: crypto.randomUUID() }) }
    catch (error) {
      if (!isAdapterError(error)) throw error
      reply.code(error.code === 'invalid-request' ? 400 : error.code === 'not-found' ? 404 : 502).send({ error: error.toJSON() })
      return undefined
    }
  }

  async function libraryCatalogRoute<T>(
    reply: FastifyReply,
    operation: (adapter: LibraryCatalogPort, context: OperationContext) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    if (!jellyfin) {
      reply.code(503).send({
        error: { code: 'unavailable', adapterId: 'jellyfin', message: 'Jellyfin is not configured', retryable: false },
      })
      return undefined
    }
    try {
      return await operation(jellyfin, { operationId: crypto.randomUUID(), signal })
    } catch (error) {
      if (signal?.aborted) return undefined
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
      sendBeetsError(reply, error)
      return undefined
    }
  }

  function sendBeetsError(reply: FastifyReply, error: { code: string, toJSON(): unknown }): void {
    const status = error.code === 'invalid-request' ? 400 : error.code === 'not-found' ? 404 : error.code === 'unsupported' ? 501 : 502
    reply.code(status).send({ error: error.toJSON() })
  }

  function sameOrigin(request: { headers: { origin?: string, host?: string, 'sec-fetch-site'?: string }, protocol: string }, reply: FastifyReply): boolean {
    const fetchSite = request.headers['sec-fetch-site']
    if (fetchSite === 'same-origin') return true
    if (!fetchSite && !request.headers.origin) return true
    const expected = `${request.protocol}://${request.headers.host}`
    if (!fetchSite && request.headers.origin === expected) return true
    reply.code(403).send({ error: { code: 'forbidden', message: 'Cross-origin mutation requests are forbidden' } })
    return false
  }

  async function validatedFolder(providerPath: string, hash: string, reply: FastifyReply) {
    const folders = await beetsRoute(reply, (adapter, context) => adapter.listFolders(context))
    if (reply.sent) return undefined
    const matches: BeetsInboxFolder[] = []
    const visit = (nodes: readonly BeetsInboxFolder[]) => nodes.forEach(node => { if (node.providerPath === providerPath && node.hash === hash && node.album && node.hash.length > 0) matches.push(node); visit(node.children) })
    visit(folders!)
    if (matches.length === 1) return matches[0]
    reply.code(409).send({ error: { code: 'conflict', message: 'Folder path and hash do not identify exactly one current album' } })
    return undefined
  }

  app.get('/api/health', async () => ({ status: 'ok' }))
  app.get('/api/services/slskd', async (_request,reply)=>{if(!slskd)return{configured:false};try{return{configured:true,health:await slskd.probe({operationId:crypto.randomUUID()})}}catch(error){if(!isAdapterError(error))throw error;return reply.code(502).send({error:error.toJSON()})}})
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
    const [libraryResult, artistResult, trackResult] = await Promise.all([
      readProjection(jellyfin !== null, [], () => listAllMatchingAlbums(
        jellyfin!,
        request.query.term,
        { operationId: `${operationId}:library` },
      )),
      readProjection(typeof jellyfin?.listArtists === 'function', [], async () => (await jellyfin!.listArtists(
        { limit: 8, term: request.query.term }, { operationId: `${operationId}:artists` },
      )).items),
      readProjection(typeof jellyfin?.listTracks === 'function', [], async () => (await jellyfin!.listTracks(
        { limit: 12, term: request.query.term }, { operationId: `${operationId}:tracks` },
      )).items),
    ])
    const catalogResult = await readProjection(catalog !== null, { releases: [] as readonly CatalogRelease[], exactArtist: undefined as string | undefined }, async () => {
      const context = { operationId: `${operationId}:catalog` }
      const artists = await catalog!.lookupArtists(request.query.term, context)
      const exactArtists = artists.filter(artist => normalizedSearchText(artist.name) === normalizedSearchText(request.query.term))
      if (exactArtists.length !== 1) {
        return { releases: await catalog!.lookupReleases(request.query.term, context), exactArtist: undefined }
      }
      return {
        releases: (await catalog!.listArtistReleases(exactArtists[0].ref, context))
          .map(release => ({ ...release, artistName: exactArtists[0].name })),
        exactArtist: exactArtists[0].name,
      }
    })
    const exactArtist = catalogResult.value.exactArtist
    const libraryAlbums = exactArtist
      ? libraryResult.value.filter(album => normalizedSearchText(album.albumArtist) === normalizedSearchText(exactArtist))
      : libraryResult.value
    const acquisitions = (acquisitionRepository?.list() ?? []).filter(acquisition => (
      !exactArtist || normalizedSearchText(acquisition.artist) === normalizedSearchText(exactArtist)
    ))
    return {
      sources: {
        library: libraryResult.state,
        artists: artistResult.state,
        tracks: trackResult.state,
        catalog: catalogResult.state,
        wanted: acquisitionRepository ? 'available' : 'unconfigured',
      },
      items: mergeMusicReleases(libraryAlbums, catalogResult.value.releases, acquisitions, request.query.term),
      artists: artistResult.value,
      tracks: trackResult.value,
    }
  })
  app.get('/api/device', async () => ({
    profile: { manufacturer: 'Sony', model: 'NW-A55' },
    ...(await cachedScan(walkmanPath)),
  }))
  app.get('/api/library', async () => cachedScan(libraryPath))
  app.get<{ Params: { songId: string } }>('/api/library/songs/:songId/stream', {
    exposeHeadRoute: false,
    schema: {
      params: {
        type: 'object',
        required: ['songId'],
        additionalProperties: false,
        properties: { songId: { type: 'string', pattern: '^[a-fA-F0-9-]{32,36}$' } },
      },
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
    const range = request.headers.range
    if (range !== undefined && !isSingleByteRange(range)) return reply.code(416).send()
    const controller = new AbortController()
    const abort = () => controller.abort()
    reply.raw.once('close', abort)
    const audio = await libraryCatalogRoute(reply, (adapter, context) => (
      adapter.getTrackAudio(request.params.songId, range, context)
    ), controller.signal)
    reply.raw.off('close', abort)
    if (controller.signal.aborted || reply.sent) return
    if (!audio) return reply.code(404).send()
    if (audio.contentRange !== undefined) reply.header('Content-Range', audio.contentRange)
    if (audio.acceptRanges !== undefined) reply.header('Accept-Ranges', audio.acceptRanges)
    if (audio.status === 416) return reply.code(416).send()
    reply.code(audio.status).type(audio.contentType)
    if (audio.contentLength !== undefined) reply.header('Content-Length', audio.contentLength)
    return reply.send(Readable.fromWeb(audio.body as unknown as Parameters<typeof Readable.fromWeb>[0]))
  })
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
  app.get<{ Querystring: LibraryCatalogQuery }>('/api/library/artists', {
    schema: { querystring: libraryAlbumQuerySchema() },
  }, async (request, reply) => {
    if (!jellyfin) return { configured: false, mounted: false, scannedAt: null, total: 0, items: [] }
    const page = await libraryCatalogRoute(reply, (adapter, context) => adapter.listArtists({
      cursor: request.query?.cursor, limit: request.query?.limit ?? 50, term: request.query?.term,
    }, context))
    return reply.sent ? undefined : { configured: true, mounted: true, scannedAt: null, ...page }
  })
  app.get<{ Querystring: LibraryCatalogQuery }>('/api/library/songs', {
    schema: { querystring: libraryAlbumQuerySchema() },
  }, async (request, reply) => {
    if (!jellyfin) return { configured: false, mounted: false, scannedAt: null, total: 0, items: [] }
    const page = await libraryCatalogRoute(reply, (adapter, context) => adapter.listTracks({
      cursor: request.query?.cursor, limit: request.query?.limit ?? 50, term: request.query?.term,
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
  app.get('/api/acquisitions', async () => {
    const items = acquisitionRepository ? [...acquisitionRepository.list()] : []
    if (catalog) {
      const ambiguous = items.filter(item => items.some(other => other.id !== item.id
        && other.artist?.toLowerCase() === item.artist?.toLowerCase()
        && other.release?.toLowerCase() === item.release?.toLowerCase()))
      const unresolved = ambiguous.filter(item => !item.releaseType || !item.releaseDate || !item.trackCount)
      const terms = [...new Set(unresolved.flatMap(item => item.release ? [item.release] : []))]
      const releases = (await Promise.all(terms.map(async term => {
        try { return await catalog.lookupReleases(term, { operationId: crypto.randomUUID() }) }
        catch { return [] }
      }))).flat()
      const byMbid = new Map(releases.flatMap(release => release.musicBrainzReleaseGroupId
        ? [[release.musicBrainzReleaseGroupId.toLowerCase(), release] as const] : []))
      for (const item of unresolved) {
        const release = item.musicBrainzReleaseGroupId && byMbid.get(item.musicBrainzReleaseGroupId.toLowerCase())
        if (release) Object.assign(item, {
          ...(release.releaseDate ? { releaseDate: release.releaseDate } : {}),
          ...(release.releaseType ? { releaseType: release.releaseType } : {}),
          ...(release.trackCount ? { trackCount: release.trackCount } : {}),
        })
      }
    }
    return { configured: acquisitionRepository !== null, items }
  })
  app.get<{ Params: { id: string } }>('/api/journeys/:id', { schema: { params: {
    type: 'object', required: ['id'], additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 128 } },
  } } }, async (request, reply) => {
    if (!acquisitionRepository?.get) return reply.code(503).send({
      error: { code: 'unavailable', message: 'Needle acquisition detail persistence is not configured' },
    })
    const job = acquisitionRepository.get(request.params.id)
    if (!job) return reply.code(404).send({ error: { code: 'not-found', message: 'Journey was not found' } })

    const operationId = crypto.randomUUID()
    const direct = acquisitionRepository.getDirectWorkflow?.(job.id)
    let directStatus
    if (direct && directAcquisition) { try { directStatus = await directAcquisition.reconcile(job.id,{operationId:`${operationId}:slskd`}) } catch { directStatus={workflow:direct,summary:undefined} } }
    const currentJob=acquisitionRepository.get(request.params.id)??job
    const directProgress=directStatus?.summary?{percent:directStatus.summary.bytesTotal?Math.round(directStatus.summary.bytesTransferred/directStatus.summary.bytesTotal*100):0,completedFiles:directStatus.summary.completed,expectedFiles:directStatus.workflow?.expectedFileCount??0}:undefined
    const directOutput=currentJob.state==='completed'?directStatus?.workflow?.outputNeedlePath:undefined
    const download = directStatus?.workflow
      ? { state: 'available' as SourceState, events: [{ kind: `direct-${currentJob.state}`, label: `Direct acquisition ${currentJob.state}`, occurredAt: directStatus.workflow.updatedAt }], outputs: directOutput ? [directOutput] : [], downloadRefs: [] as string[], ...(directProgress ? { progress: directProgress } : {}) }
      : { state: 'unavailable' as SourceState, events: [{ kind: 'legacy-acquisition-unavailable', label: 'Legacy acquisition progress is unavailable', occurredAt: currentJob.updatedAt }], outputs: [] as string[], downloadRefs: [] as string[] }
    const review = await journeyReviewProjection(beets, download.outputs, download.downloadRefs, { operationId: `${operationId}:review` })
    const linked = acquisitionRepository.listBeetsImportOperations?.().filter(item => item.acquisitionId === currentJob.id) ?? []
    const importOperation = linked.length === 1 ? linked[0] : undefined
    const projectedStage = journeyStage(currentJob.state, Boolean(directStatus?.workflow), importOperation)
    const stage = !importOperation && review.folder && projectedStage !== 'attention'
      ? 'review'
      : projectedStage
    const events = [
      ...download.events,
      { kind: 'journey-created', label: 'Journey started', occurredAt: currentJob.createdAt },
      ...(importOperation ? [{
        kind: `import-${importOperation.state}`,
        label: ({
          submitting: 'Import submission started',
          submitted: 'Import accepted',
          'submission-unknown': 'Import outcome needs attention',
          'provider-completed': 'Import completed · verifying collection',
          'library-confirmed': 'Release verified in collection',
        } as const)[importOperation.state],
        occurredAt: importOperation.updatedAt,
      }] : []),
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    return {
      job:currentJob,
      stage,
      ...(download.progress ? { progress: download.progress } : {}),
      events,
      ...(stage === 'review' && review.folder ? { nextAction: { kind: 'review', folder: review.folder } } : {}),
      ...(importOperation ? { importOperation } : {}),
      libraryAlbumIds: importOperation ? [...importOperation.libraryAlbumIds] : [],
      sources: { download: download.state, review: review.state },
    }
  })
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
              trackCount: { type: 'integer', minimum: 1, maximum: 10000 },
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
    if (!directAcquisition) return reply.code(503).send({
      error: { code: 'unavailable', adapterId: 'slskd', message: 'Direct acquisition is not configured', retryable: false },
    })
    const musicBrainzReleaseGroupId = request.body.release.musicBrainzReleaseGroupId?.trim().toLowerCase()
    if (!musicBrainzReleaseGroupId) return reply.code(400).send({
      error: { code: 'invalid-request', message: 'Release requires a MusicBrainz release-group ID' },
    })
    const sourceAdapter = request.body.release.ref.adapterId
    if (sourceAdapter !== 'musicbrainz' || request.body.release.artistRef.adapterId !== sourceAdapter) {
      return reply.code(400).send({ error: { code: 'invalid-request', message: 'Release does not belong to the configured acquisition source' } })
    }
    const release = {
      ...request.body.release,
      musicBrainzReleaseGroupId,
      ref: { adapterId: 'musicbrainz', nativeId: `release-group:mbid:${musicBrainzReleaseGroupId}` },
    }
    const result = acquisitionRepository.wantRelease(release)
    if (!result.created && result.job.state !== 'wanted') return reply.code(200).send(result.job)
    try { const workflow = await directAcquisition.search(result.job.id, { operationId: crypto.randomUUID() }); return reply.code(result.created ? 201 : 200).send({ ...acquisitionRepository.get?.(result.job.id), direct: workflow }) }
    catch (error) { return reply.code(502).send({ error: { code: 'unavailable', adapterId: 'slskd', message: error instanceof Error ? error.message : 'Direct search failed', retryable: true } }) }
  })
  app.get<{Params:{id:string}}>('/api/acquisitions/:id/candidates',async(request,reply)=>{const workflow=acquisitionRepository?.getDirectWorkflow?.(request.params.id);if(!workflow)return reply.code(404).send({error:{code:'not-found',message:'Direct acquisition was not found'}});return{workflow,candidates:workflow.candidates}})
  app.post<{Params:{id:string,candidateId:string}}>('/api/acquisitions/:id/candidates/:candidateId/select',async(request,reply)=>{if(!directAcquisition)return reply.code(503).send({error:{code:'unavailable',message:'Direct acquisition is not configured'}});try{return await directAcquisition.select(request.params.id,request.params.candidateId,{operationId:crypto.randomUUID()})}catch(error){return reply.code(409).send({error:{code:'conflict',message:error instanceof Error?error.message:'Selection failed'}})}})
  app.post<{Params:{id:string}}>('/api/acquisitions/:id/retry',async(request,reply)=>{if(!directAcquisition)return reply.code(503).send({error:{code:'unavailable',message:'Direct acquisition is not configured'}});try{return await directAcquisition.retry(request.params.id,{operationId:crypto.randomUUID()})}catch(error){return reply.code(409).send({error:{code:'conflict',message:error instanceof Error?error.message:'Retry failed'}})}})

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
  app.get('/api/imports/operations', async () => ({
    configured: Boolean(acquisitionRepository?.listBeetsImportOperations),
    items: acquisitionRepository?.listBeetsImportOperations?.() ?? [],
  }))
  const folderSchema = {
    type: 'object', required: ['providerPath', 'hash'], additionalProperties: false,
    properties: { providerPath: { type: 'string', minLength: 1, maxLength: 4096 }, hash: { type: 'string', minLength: 1, maxLength: 256 } },
  } as const
  app.post<{ Body: { providerPath: string, hash: string } }>('/api/imports/preview', { schema: { body: folderSchema } }, async (request, reply) => {
    if (!sameOrigin(request, reply)) return
    if (!await validatedFolder(request.body.providerPath, request.body.hash, reply)) return
    const submissionKey = JSON.stringify([request.body.providerPath, request.body.hash])
    if (submittedBeetsPreviews.has(submissionKey)) return reply.code(409).send({ error: { code: 'conflict', message: 'A preview has already been submitted for this album content' } })
    submittedBeetsPreviews.add(submissionKey)
    const acknowledgement = await beetsRoute(reply, (adapter, context) => adapter.enqueuePreview(request.body, context))
    if (!reply.sent) return reply.code(202).send(acknowledgement)
  })
  app.get<{ Querystring: { providerPath: string, hash: string } }>('/api/imports/preview', { schema: { querystring: folderSchema } }, async (request, reply) => {
    const session = await beetsRoute(reply, (adapter, context) => adapter.getPreview(request.query, context))
    if (!reply.sent && session) {
      const now = Date.now()
      for (const [key, cached] of beetsPreviewSessions) {
        if (cached.cachedAt + previewSessionTtlMs <= now) beetsPreviewSessions.delete(key)
      }
      if (beetsPreviewSessions.size >= maxPreviewSessions) {
        const oldest = beetsPreviewSessions.keys().next().value
        if (oldest) beetsPreviewSessions.delete(oldest)
      }
      beetsPreviewSessions.set(JSON.stringify([request.query.providerPath, request.query.hash]), { session, cachedAt: now })
    }
    return session
  })
  app.post<{ Body: { providerPath: string, hash: string, sessionId: string, choices: BeetsImportChoice[], acquisitionId: string | null } }>('/api/imports/import', { schema: { body: {
    type: 'object', required: ['providerPath', 'hash', 'sessionId', 'choices', 'acquisitionId'], additionalProperties: false,
    properties: { ...folderSchema.properties, acquisitionId: { anyOf: [{ type: 'string', minLength: 1, maxLength: 128 }, { type: 'null' }] }, sessionId: { type: 'string', minLength: 1, maxLength: 256 }, choices: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'object', required: ['taskId', 'candidateId', 'duplicateAction'], additionalProperties: false, properties: { taskId: { type: 'string', minLength: 1, maxLength: 256 }, candidateId: { type: 'string', minLength: 1, maxLength: 256 }, duplicateAction: { type: 'string', enum: ['skip', 'keep'] } } } } },
  } } }, async (request, reply) => {
    if (!sameOrigin(request, reply)) return
    const body = request.body
    if (body.acquisitionId !== null) {
      if (!acquisitionRepository?.createBeetsImportOperation || !acquisitionRepository.get) return reply.code(503).send({ error: { code: 'unavailable', message: 'Acquisition linkage persistence is not configured' } })
      const acquisition = acquisitionRepository.get(body.acquisitionId)
      const directReady = acquisition?.state === 'completed' && acquisitionRepository.getDirectWorkflow?.(body.acquisitionId)?.submissionState === 'submitted'
      if (!acquisition || (acquisition.state !== 'wanted' && !directReady)) return reply.code(409).send({ error: { code: 'conflict', message: 'Selected acquisition does not exist or is not ready for import' } })
    }
    if (!await validatedFolder(body.providerPath, body.hash, reply)) return
    const previewKey = JSON.stringify([body.providerPath, body.hash])
    const cached = beetsPreviewSessions.get(previewKey)
    if (!cached || cached.cachedAt + previewSessionTtlMs <= Date.now()) {
      beetsPreviewSessions.delete(previewKey)
      return reply.code(409).send({ error: {
      code: 'conflict', message: 'Preview choices are no longer available; refresh the review before importing',
      } })
    }
    const session = cached.session
    const taskIds = new Set(session.tasks.map(task => task.id))
    const selected = new Set<string>()
    const valid = session.progress === 20 && session.id === body.sessionId && session.providerPath === body.providerPath && session.hash === body.hash && body.choices.length === session.tasks.length && body.choices.every(choice => {
      if (!taskIds.has(choice.taskId) || selected.has(choice.taskId)) return false
      selected.add(choice.taskId)
      return session.tasks.find(task => task.id === choice.taskId)!.candidates.some(candidate => candidate.id === choice.candidateId)
    })
    if (!valid || selected.size !== taskIds.size) return reply.code(409).send({ error: { code: 'conflict', message: 'Import choices do not match the current preview session' } })
    let operation: BeetsImportOperation | undefined
    if (acquisitionRepository?.createBeetsImportOperation) {
      const selections: BeetsImportSelection[] = body.choices.map(choice => {
        const candidate = session.tasks.find(task => task.id === choice.taskId)!.candidates.find(item => item.id === choice.candidateId)!
        return { taskId: choice.taskId, candidateId: choice.candidateId, duplicateAction: choice.duplicateAction,
          ...(candidate.artist ? { artist: candidate.artist } : {}), ...(candidate.album ? { album: candidate.album } : {}),
          ...(candidate.year !== undefined ? { year: candidate.year } : {}), trackCount: candidate.trackCount }
      })
      let created
      try {
        created = acquisitionRepository.createBeetsImportOperation({ sessionId: session.id, providerPath: body.providerPath, hash: body.hash, selections,
          ...(body.acquisitionId === null ? {} : { acquisitionId: body.acquisitionId }) })
      } catch (error) {
        if (error instanceof AcquisitionLinkConflictError) return reply.code(409).send({ error: { code: 'conflict', message: error.message } })
        throw error
      }
      if (!created.created) return reply.code(409).send({ error: { code: 'conflict', message: 'This preview session has already been submitted for import' } })
      operation = created.operation
    } else {
      if (submittedBeetsImports.has(session.id)) return reply.code(409).send({ error: { code: 'conflict', message: 'This preview session has already been submitted for import' } })
      submittedBeetsImports.add(session.id)
    }
    const unknownSubmission = () => {
      if (operation) {
        try { acquisitionRepository?.transitionBeetsImportOperation?.(operation.id, 'submitting', 'submission-unknown') } catch { /* durable recovery will retry on restart */ }
      }
      return reply.code(503).send({ error: {
        code: 'unavailable', message: 'The import submission outcome is unknown; do not retry automatically',
        retryable: false, providerCode: 'outcome-unknown',
      } })
    }
    let acknowledgement
    beetsPreviewSessions.delete(previewKey)
    try {
      if (!beets) throw new Error('beets-flask is not configured')
      acknowledgement = await beets.enqueueImport(body, { operationId: crypto.randomUUID() })
    } catch (error) {
      if (!isAdapterError(error) || error.providerCode === 'outcome-unknown') return unknownSubmission()
      try {
        if (operation && !acquisitionRepository?.abortBeetsImportOperation?.(operation.id)) return unknownSubmission()
        if (!operation) submittedBeetsImports.delete(session.id)
      } catch { return unknownSubmission() }
      sendBeetsError(reply, error)
      return
    }
    if (operation) {
      let persisted
      try {
        persisted = acquisitionRepository?.transitionBeetsImportOperation?.(operation.id, 'submitting', 'submitted', { providerJobId: acknowledgement.jobId })
      } catch { return unknownSubmission() }
      if (!persisted || persisted.state !== 'submitted' || persisted.providerJobId !== acknowledgement!.jobId) {
        return unknownSubmission()
      }
    }
    return reply.code(202).send({ ...acknowledgement!, ...(operation ? { importOperationId: operation.id } : {}) })
  })
  app.post<{ Params: { id: string } }>('/api/imports/operations/:id/reconcile', { schema: { params: {
    type: 'object', required: ['id'], additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 128 } },
  } } }, async (request, reply) => {
    if (!sameOrigin(request, reply)) return
    const repository = acquisitionRepository
    if (!repository?.getBeetsImportOperation || !repository.transitionBeetsImportOperation) {
      return reply.code(503).send({ error: { code: 'unavailable', message: 'Import operation persistence is not configured' } })
    }
    let operation = repository.getBeetsImportOperation(request.params.id)
    if (!operation) return reply.code(404).send({ error: { code: 'not-found', message: 'Import operation was not found' } })
    if (operation.state === 'submission-unknown' || operation.state === 'submitting' || operation.state === 'library-confirmed') return operation
    if (operation.state === 'submitted') {
      const session = await beetsRoute(reply, (adapter, context) => adapter.getPreview(operation!, context))
      if (reply.sent || !session) return
      const taskIds = new Set(session.tasks.map(task => task.id))
      const selectionIds = new Set(operation.selections.map(selection => selection.taskId))
      const completed = session.id === operation.sessionId && session.providerPath === operation.providerPath && session.hash === operation.hash
        && session.progress === 40 && session.tasks.length === operation.selections.length && taskIds.size === session.tasks.length
        && selectionIds.size === operation.selections.length && [...taskIds].every(id => selectionIds.has(id))
        && operation.selections.every(selection => session.tasks.find(task => task.id === selection.taskId)?.chosenCandidateId === selection.candidateId)
      if (!completed) return operation
      if (jellyfin?.refreshLibrary) {
        await libraryCatalogRoute(reply, (adapter, context) => (adapter as LibraryCatalogPort & LibraryCatalogRefreshPort).refreshLibrary(context))
        if (reply.sent) return
      }
      operation = repository.transitionBeetsImportOperation(operation.id, 'submitted', 'provider-completed')!
      if (operation.state !== 'provider-completed') return operation
    }
    const expected = operation.selections.filter(selection => selection.artist && selection.album)
    if (!jellyfin || expected.length !== operation.selections.length) return operation
    const ids: string[] = []
    const trackCounts = new Map<string, number>()
    for (const [index, selection] of expected.entries()) {
      const albums = await libraryCatalogRoute(reply, (adapter, context) => listAllMatchingAlbums(adapter, selection.album!, context, index === 0))
      if (reply.sent || !albums) return
      const normalize = (value: string) => value.trim().toLocaleLowerCase()
      const metadataMatches = albums.filter(album => normalize(album.title) === normalize(selection.album!)
        && normalize(album.albumArtist) === normalize(selection.artist!))
      const matches: LibraryAlbum[] = []
      for (const album of metadataMatches) {
        let trackCount = trackCounts.get(album.id)
        if (trackCount === undefined) {
          const tracks = await libraryCatalogRoute(reply, (adapter, context) => listAllAlbumTracks(adapter, album.id, context, true))
          if (reply.sent || !tracks) return
          trackCount = tracks.length
          trackCounts.set(album.id, trackCount)
        }
        if (trackCount === selection.trackCount) matches.push(album)
      }
      if (matches.length !== 1) return operation
      ids.push(matches[0].id)
    }
    return repository.transitionBeetsImportOperation(operation.id, 'provider-completed', 'library-confirmed', { libraryAlbumIds: ids })!
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

type SourceState = 'available' | 'unconfigured' | 'unavailable'
async function journeyReviewProjection(beets: BeetsImportPort | null, outputs: readonly string[], downloadRefs: readonly string[], context: OperationContext) {
  if (!beets) return { state: 'unconfigured' as SourceState }
  try {
    const roots = await beets.listFolders(context)
    const albums: BeetsInboxFolder[] = []
    const visit = (nodes: readonly BeetsInboxFolder[]) => nodes.forEach(node => { if (node.album) albums.push(node); visit(node.children) })
    visit(roots)
    const normalized = new Set(outputs.map(stripTrailingSlash))
    const references = new Set(downloadRefs)
    const matches = albums.filter(folder => normalized.has(stripTrailingSlash(folder.providerPath))
      || folder.providerPath.split('/').some(segment => references.has(segment)))
    return { state: 'available' as SourceState, ...(matches.length === 1 ? { folder: matches[0] } : {}) }
  } catch { return { state: 'unavailable' as SourceState } }
}

function stripTrailingSlash(path: string): string { return path.length > 1 ? path.replace(/\/+$/, '') : path }

function journeyStage(jobState: string, hasDirectWorkflow: boolean, operation?: BeetsImportOperation) {
  if (operation) return ({ 'submission-unknown': 'attention', submitting: 'importing', submitted: 'importing', 'provider-completed': 'verifying', 'library-confirmed': 'collected' } as const)[operation.state]
  if (!hasDirectWorkflow) return 'attention'
  return ({ searching: 'queued', queued: 'queued', transferring: 'downloading', 'selection-required': 'attention', importing: 'importing', completed: 'collected', failed: 'attention', cancelled: 'attention' } as Record<string, string>)[jobState] ?? 'requested'
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
  fresh = false,
): Promise<LibraryAlbum[]> {
  const items: LibraryAlbum[] = []
  let cursor: string | undefined
  do {
    const page = await adapter.listAlbums({ cursor, limit: 100, term, fresh: fresh && cursor === undefined }, context)
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

function normalizedSearchText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase() ?? ''
}

function directOptions(env:NodeJS.ProcessEnv){let pathMappings:readonly {id:string;providerPrefix:string;needlePrefix:string}[]|undefined;if(env.SLSKD_PATH_MAPPINGS?.trim()){const parsed=JSON.parse(env.SLSKD_PATH_MAPPINGS);if(!Array.isArray(parsed)||parsed.some(x=>!x||typeof x.id!=='string'||typeof x.providerPrefix!=='string'||typeof x.needlePrefix!=='string'||!x.providerPrefix.startsWith('/')||!x.needlePrefix.startsWith('/')))throw new Error('SLSKD_PATH_MAPPINGS must be a JSON array of absolute path mappings');pathMappings=parsed}return{downloadsRoot:env.SLSKD_DOWNLOADS_ROOT?.trim()||'/downloads',...(pathMappings?{pathMappings}:{})}}

async function listAllAlbumTracks(adapter: LibraryCatalogPort, albumId: string, context: OperationContext, fresh = false) {
  const items = []
  let cursor: string | undefined
  do {
    const page = await adapter.listAlbumTracks(albumId, { cursor, limit: 100, fresh: fresh && cursor === undefined }, context)
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function isSingleByteRange(value: string): boolean {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return false
  return !(match[1] && match[2] && BigInt(match[1]) > BigInt(match[2]))
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntryPoint) {
  const app = buildApp()
  const port = Number(process.env.PORT || 8787)
  await app.listen({ host: '0.0.0.0', port })
}

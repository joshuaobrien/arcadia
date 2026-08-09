import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowLeft, Bookmark, Check, Disc3, LibraryBig, Radio, RefreshCw, Search } from 'lucide-react'
import './styles.css'

interface ProviderRef {
  adapterId: string
  nativeId: string
}

interface CatalogArtist {
  ref: ProviderRef
  name: string
}

interface CatalogRelease {
  ref: ProviderRef
  artistRef: ProviderRef
  artistName?: string
  title: string
  releaseDate?: string
  releaseType?: string
  musicBrainzReleaseGroupId?: string
}

interface LidarrStatus {
  configured: boolean
  health?: {
    state: 'available' | 'degraded' | 'unavailable'
    version?: string
  }
}

interface QueueItem {
  ref: ProviderRef
  title: string
  state: string
  protocol?: string
  bytesTotal?: number
  bytesRemaining?: number
  artist?: CatalogArtist
  release?: CatalogRelease
}

interface HistoryItem {
  ref: ProviderRef
  eventType: string
  occurredAt: string
  underlyingDownloadRef?: string
  artist?: CatalogArtist
  release?: CatalogRelease
}

interface AcquisitionJob {
  id: string
  state: 'wanted'
  artist?: string
  release?: string
  musicBrainzReleaseGroupId?: string
  searchRefs: ProviderRef[]
  createdAt: string
  updatedAt: string
}

interface Page<T> {
  items: T[]
}

interface AcquisitionResponse {
  configured: boolean
  items: AcquisitionJob[]
}

interface LibraryTrack {
  id?: string
  relativePath?: string
  bytes?: number
  format?: string
  metadataStatus?: 'read' | 'unreadable'
  title?: string
  artists?: string[]
  albumArtist?: string
  album?: string
  trackNumber?: number
  discNumber?: number
  year?: number
  durationSeconds?: number
  codec?: string
  sampleRate?: number
  lossless?: boolean
}

interface LibraryAlbum {
  id: string
  title: string
  albumArtist: string
  musicBrainzReleaseGroupId?: string
  year?: number
  trackCount?: number
  hasArtwork: boolean
}

interface LibraryPage<T> {
  configured: boolean
  mounted: boolean
  scannedAt: string | null
  total: number
  items: T[]
  nextCursor?: string
}

interface ErrorResponse {
  error?: { message?: string }
}

interface MusicRelease {
  key: string
  title: string
  artist: string
  year?: number
  state: 'in-library' | 'wanted' | 'can-request'
  musicBrainzReleaseGroupId?: string
  libraryAlbum?: LibraryAlbum
  catalogRelease?: CatalogRelease
  acquisition?: AcquisitionJob
}

interface MusicSearchResponse {
  sources: {
    library: 'available' | 'unconfigured' | 'unavailable'
    catalog: 'available' | 'unconfigured' | 'unavailable'
    wanted: 'available' | 'unconfigured' | 'unavailable'
  }
  items: MusicRelease[]
}

type View = 'library' | 'wanted' | 'activity'

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  const body = await response.json() as T & ErrorResponse
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`)
  return body
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json() as T & ErrorResponse
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`)
  return body
}

function useLidarrReadModel() {
  const [status, setStatus] = useState<LidarrStatus | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await getJson<LidarrStatus>('/api/services/lidarr', signal)
      setStatus(nextStatus)
      if (!nextStatus.configured || nextStatus.health?.state !== 'available') {
        setQueue([])
        setHistory([])
        return
      }

      const [queuePage, historyPage] = await Promise.all([
        getJson<Page<QueueItem>>('/api/services/lidarr/queue?limit=25', signal),
        getJson<Page<HistoryItem>>('/api/services/lidarr/history?limit=25', signal),
      ])
      setQueue(queuePage.items)
      setHistory(historyPage.items)
    } catch (requestError) {
      if (!isAbortError(requestError)) setError(errorMessage(requestError))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  return { status, queue, history, error, loading, refresh: () => refresh() }
}

type LidarrReadModel = ReturnType<typeof useLidarrReadModel>

function useAcquisitions() {
  const [configured, setConfigured] = useState(false)
  const [items, setItems] = useState<AcquisitionJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingRef, setSavingRef] = useState<string | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const result = await getJson<AcquisitionResponse>('/api/acquisitions', signal)
      setConfigured(result.configured)
      setItems(current => [
        ...result.items,
        ...current.filter(item => !result.items.some(next => next.id === item.id)),
      ])
    } catch (requestError) {
      if (!isAbortError(requestError)) setError(errorMessage(requestError))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  async function wantRelease(release: CatalogRelease) {
    setSavingRef(providerRefKey(release.ref))
    setError(null)
    try {
      const job = await postJson<AcquisitionJob>('/api/acquisitions', { release })
      setItems(current => current.some(item => item.id === job.id) ? current : [job, ...current])
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSavingRef(null)
    }
  }

  function includes(release: CatalogRelease) {
    return items.some(item => item.searchRefs.some(ref => (
      ref.adapterId === release.ref.adapterId && ref.nativeId === release.ref.nativeId
    )))
  }

  return {
    configured,
    items,
    loading,
    error,
    savingRef,
    refresh: () => refresh(),
    wantRelease,
    includes,
  }
}

type AcquisitionsModel = ReturnType<typeof useAcquisitions>

function useLibrary() {
  const [page, setPage] = useState<LibraryPage<LibraryAlbum> | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useState<LibraryAlbum | null>(null)
  const [tracks, setTracks] = useState<LibraryTrack[]>([])
  const [term, setTerm] = useState('')
  const [activeTerm, setActiveTerm] = useState('')
  const [searchResult, setSearchResult] = useState<MusicSearchResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [openingAlbum, setOpeningAlbum] = useState<string | null>(null)
  const [artworkRevision, setArtworkRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const albumRequest = useRef(0)

  const loadAlbums = useCallback(async (query: string, signal?: AbortSignal) => {
    const request = ++albumRequest.current
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '48' })
      if (query) params.set('term', query)
      const next = await getJson<LibraryPage<LibraryAlbum>>(`/api/library/albums?${params}`, signal)
      if (request !== albumRequest.current) return
      setPage(next)
      setSearchResult(null)
      setArtworkRevision(current => current + 1)
      setSelectedAlbum(null)
      setTracks([])
    } catch (requestError) {
      if (request === albumRequest.current && !isAbortError(requestError)) setError(errorMessage(requestError))
    } finally {
      if (request === albumRequest.current && !signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadAlbums('', controller.signal)
    return () => controller.abort()
  }, [loadAlbums])

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = term.trim()
    if (!query) {
      clearSearch()
      return
    }
    setActiveTerm(query)
    searchReleases(query)
  }

  function clearSearch() {
    setTerm('')
    setActiveTerm('')
    loadAlbums('')
  }

  async function searchReleases(query: string) {
    const request = ++albumRequest.current
    setLoading(true)
    setLoadingMore(false)
    setSearchResult(null)
    setError(null)
    try {
      const next = await getJson<MusicSearchResponse>(`/api/music/releases?term=${encodeURIComponent(query)}`)
      if (request !== albumRequest.current) return
      setSearchResult(next)
      setSelectedAlbum(null)
      setTracks([])
    } catch (requestError) {
      if (request === albumRequest.current) setError(errorMessage(requestError))
    } finally {
      if (request === albumRequest.current) setLoading(false)
    }
  }

  async function loadMore() {
    if (!page?.nextCursor) return
    const request = albumRequest.current
    setLoadingMore(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '48', cursor: page.nextCursor })
      if (activeTerm) params.set('term', activeTerm)
      const next = await getJson<LibraryPage<LibraryAlbum>>(`/api/library/albums?${params}`)
      if (request !== albumRequest.current) return
      setPage(current => current ? { ...next, items: [...current.items, ...next.items] } : next)
    } catch (requestError) {
      if (request === albumRequest.current) setError(errorMessage(requestError))
    } finally {
      if (request === albumRequest.current) setLoadingMore(false)
    }
  }

  async function openAlbum(album: LibraryAlbum) {
    setOpeningAlbum(album.id)
    setError(null)
    try {
      const items: LibraryTrack[] = []
      let cursor: string | undefined
      do {
        const query = new URLSearchParams({ limit: '100' })
        if (cursor) query.set('cursor', cursor)
        const result = await getJson<LibraryPage<LibraryTrack>>(`/api/library/albums/${album.id}/tracks?${query}`)
        items.push(...result.items)
        cursor = result.nextCursor
      } while (cursor)
      setSelectedAlbum(album)
      setTracks(items)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setOpeningAlbum(null)
    }
  }

  return {
    page,
    searchResult,
    selectedAlbum,
    tracks,
    loading,
    loadingMore,
    openingAlbum,
    artworkRevision,
    error,
    term,
    activeTerm,
    setTerm,
    search,
    clearSearch,
    refresh: () => activeTerm ? searchReleases(activeTerm) : loadAlbums(''),
    loadMore,
    openAlbum,
    closeAlbum: () => setSelectedAlbum(null),
  }
}

type LibraryModel = ReturnType<typeof useLibrary>

function AlbumArtwork({ album }: { album: LibraryAlbum }) {
  const [available, setAvailable] = useState(album.hasArtwork)
  return (
    <div className="album-case">
      {available && <img
        src={`/api/library/albums/${album.id}/artwork`}
        alt=""
        loading="lazy"
        onError={() => setAvailable(false)}
      />}
      <i />
    </div>
  )
}

function connectionLabel(lidarr: LidarrReadModel): string {
  if (lidarr.loading) return 'checking'
  if (lidarr.error) return 'error'
  if (!lidarr.status?.configured) return 'not configured'
  return lidarr.status.health?.state ?? 'unavailable'
}

function Header({ view, setView, lidarr, acquisitions }: {
  view: View
  setView: (view: View) => void
  lidarr: LidarrReadModel
  acquisitions: AcquisitionsModel
}) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark"><Disc3 size={18} /></span>
        <span>needle<small>acquisition terminal</small></span>
      </div>
      <nav aria-label="Primary">
        <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>
          <LibraryBig size={14} /> Library
        </button>
        {acquisitions.configured && <button className={view === 'wanted' ? 'active' : ''} onClick={() => setView('wanted')}>
          <Bookmark size={14} /> Wanted
        </button>}
        <button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}>
          <Activity size={14} /> Activity
        </button>
      </nav>
      <div className={`connection ${lidarr.status?.health?.state ?? 'offline'}`}>
        <span />
        <div><small>LIDARR</small><strong>{connectionLabel(lidarr)}</strong></div>
        {lidarr.status?.health?.version && <code>v{lidarr.status.health.version}</code>}
      </div>
    </header>
  )
}

function IntegrationState({ lidarr }: { lidarr: LidarrReadModel }) {
  const message = lidarr.loading
    ? 'Reading Lidarr'
    : lidarr.error ?? (!lidarr.status?.configured ? 'Lidarr is not configured' : 'Lidarr is unavailable')

  return (
    <div className="integration-state">
      <Radio size={21} />
      <strong>{message}</strong>
      <small>Catalog and acquisition data require an active Lidarr connection.</small>
      {!lidarr.loading && <button className="button" onClick={lidarr.refresh}><RefreshCw size={13} /> Retry</button>}
    </div>
  )
}

function formatBytes(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'size unknown'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`
}

function formatDuration(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'duration unknown'
  const totalSeconds = Math.round(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function UnifiedReleaseCard({ item, library, acquisitions, libraryAvailable }: {
  item: MusicRelease
  library: LibraryModel
  acquisitions: AcquisitionsModel
  libraryAvailable: boolean
}) {
  const album = item.libraryAlbum
  const release = item.catalogRelease
  const wanted = item.state === 'wanted' || Boolean(release && acquisitions.includes(release))

  if (album) {
    return (
      <button className="album-card release-card" onClick={() => library.openAlbum(album)} disabled={library.openingAlbum !== null}>
        <AlbumArtwork album={album} key={`${album.id}:${library.artworkRevision}`} />
        <strong>{item.title}</strong>
        <small>{item.artist}</small>
        <div className="album-meta"><span>{item.year ?? '—'}</span><span className="release-state present">In library</span></div>
      </button>
    )
  }

  return (
    <article className="album-card release-card missing">
      <div className="album-case"><i /></div>
      <strong>{item.title}</strong>
      <small>{item.artist}</small>
      <div className="album-meta">
        <span>{item.year ?? '—'}</span>
        {wanted ? <span className="release-state wanted"><Check size={9} /> Wanted</span>
          : !libraryAvailable ? <span className="release-state unknown">Library unknown</span>
            : release && acquisitions.configured ? <button
            className="want-button"
            disabled={acquisitions.savingRef !== null}
            onClick={() => acquisitions.wantRelease(release)}
          >
            {acquisitions.savingRef === providerRefKey(release.ref) ? 'Saving…' : <><Bookmark size={10} /> Want</>}
          </button>
            : <span className="release-state requestable">Can request</span>}
      </div>
    </article>
  )
}

function LibraryView({ library, acquisitions }: { library: LibraryModel; acquisitions: AcquisitionsModel }) {
  const page = library.page
  const unavailable = page && (!page.configured || !page.mounted)
  const album = library.selectedAlbum
  const searchResult = library.searchResult

  return (
    <section>
      <div className="page-heading">
        <div>
          <p>01 / LIBRARY CATALOG</p>
          <h1>{album?.title ?? 'Albums'}</h1>
        </div>
        {album
          ? <button className="button" onClick={library.closeAlbum}><ArrowLeft size={13} /> Albums</button>
          : <button className="button" onClick={library.refresh} disabled={library.loading}>
            <RefreshCw size={13} className={library.loading ? 'spinning' : ''} /> Refresh
          </button>}
      </div>
      {library.error && <div className="error-strip">{library.error}</div>}
      {acquisitions.error && <div className="error-strip">{acquisitions.error}</div>}
      {library.loading && !page && !library.activeTerm
        ? <div className="idle-state"><Disc3 size={34} className="spinning" /><span>Reading Jellyfin catalog</span></div>
        : album ? <section className="panel library-panel">
            <header><h2>{album.albumArtist}</h2><span>{library.tracks.length} tracks</span></header>
            {library.tracks.map(track => (
              <article className="library-track-row" key={track.id ?? track.relativePath}>
                <b>{track.trackNumber ?? '—'}</b>
                <div><strong>{track.title}</strong><small>{track.artists?.join(', ') ?? track.relativePath}</small></div>
                <code>{[track.codec ?? track.format ?? 'AUDIO', formatDuration(track.durationSeconds)].join(' · ')}</code>
                <span>{formatBytes(track.bytes)}</span>
              </article>
            ))}
          </section> : <>
            <form className="search-form library-search" onSubmit={library.search}>
              <Search size={17} />
              <input
                aria-label="Album or album artist"
                value={library.term}
                onChange={event => library.setTerm(event.target.value)}
                placeholder="album or album artist"
              />
              {library.activeTerm && <button className="button" type="button" onClick={library.clearSearch}>Clear</button>}
              <button className="button primary" disabled={library.loading}>Find</button>
              <code>{library.activeTerm ? searchResult?.items.length ?? 0 : page?.total ?? 0}</code>
            </form>
            {library.activeTerm ? <>
              {searchResult && sourceWarning(searchResult.sources) && <div className="source-strip">{sourceWarning(searchResult.sources)}</div>}
              {library.loading ? <div className="idle-state compact"><Disc3 size={28} className="spinning" /><span>Reading music index</span></div>
                : <div className="album-grid">
                  {searchResult?.items.map(item => (
                  <UnifiedReleaseCard
                    item={item}
                    library={library}
                    acquisitions={acquisitions}
                    libraryAvailable={searchResult.sources.library === 'available'}
                    key={item.key}
                  />
                  ))}
                </div>}
              {!library.loading && !searchResult?.items.length && <div className="panel"><p className="empty-row">No matching releases</p></div>}
            </> : unavailable ? <div className="integration-state">
              <LibraryBig size={21} />
              <strong>{page.configured ? 'Jellyfin unavailable' : 'Jellyfin not configured'}</strong>
              <small>{page.configured ? 'The Jellyfin catalog is unavailable.' : 'Set JELLYFIN_URL and JELLYFIN_API_KEY.'}</small>
              <button className="button" onClick={library.refresh}><RefreshCw size={13} /> Retry</button>
            </div> : <>
              <div className="album-grid">
                {page?.items.map(item => (
                  <button className="album-card" key={item.id} onClick={() => library.openAlbum(item)} disabled={library.openingAlbum !== null}>
                    <AlbumArtwork album={item} key={`${item.id}:${library.artworkRevision}`} />
                    <strong>{item.title}</strong>
                    <small>{item.albumArtist}</small>
                    <div className="album-meta"><span>{item.year ?? '—'}</span><span>{item.trackCount ? `${item.trackCount} tracks` : 'Album'}</span></div>
                  </button>
                ))}
              </div>
              {!page?.items.length && <div className="panel"><p className="empty-row">No albums found</p></div>}
              {page?.nextCursor && <footer className="library-footer">
                <button className="button" disabled={library.loadingMore} onClick={library.loadMore}>
                  {library.loadingMore ? 'Loading…' : 'Load 48 more'}
                </button>
              </footer>}
            </>}
          </>}
    </section>
  )
}

function QueueRow({ item }: { item: QueueItem }) {
  const transferred = item.bytesTotal ? item.bytesTotal - (item.bytesRemaining ?? item.bytesTotal) : 0
  const progress = item.bytesTotal ? Math.round((transferred / item.bytesTotal) * 100) : 0
  const artist = item.artist?.name ?? item.release?.artistName

  return (
    <article className="queue-row">
      <div className="download-object"><i /></div>
      <div className="queue-copy">
        <strong>{item.title}</strong>
        <small>{[artist, item.protocol, formatBytes(item.bytesTotal)].filter(Boolean).join(' · ')}</small>
        <div className="meter"><i style={{ width: `${progress}%` }} /></div>
      </div>
      <span className={`state-tag ${item.state}`}>{item.state.replace('-', ' ')}</span>
    </article>
  )
}

function ActivityView({ lidarr, sectionNumber }: { lidarr: LidarrReadModel; sectionNumber: string }) {
  const available = lidarr.status?.configured && lidarr.status.health?.state === 'available' && !lidarr.error

  return (
    <section>
      <div className="page-heading">
        <div><p>{sectionNumber} / LIDARR ACQUISITION</p><h1>Activity</h1></div>
        <button className="button" onClick={lidarr.refresh} disabled={lidarr.loading}>
          <RefreshCw size={13} className={lidarr.loading ? 'spinning' : ''} /> Refresh
        </button>
      </div>

      {!available ? <IntegrationState lidarr={lidarr} /> : <div className="activity-grid">
        <section className="panel queue-panel">
          <header><h2>Queue</h2><span>{lidarr.queue.length}</span></header>
          {lidarr.queue.length
            ? lidarr.queue.map(item => <QueueRow item={item} key={item.ref.nativeId} />)
            : <p className="empty-row">Queue empty</p>}
        </section>
        <section className="panel history-panel">
          <header><h2>Recent history</h2><span>{lidarr.history.length}</span></header>
          {lidarr.history.length ? lidarr.history.map(item => (
            <article className="history-row" key={item.ref.nativeId}>
              <span>{item.eventType}</span>
              <div><strong>{item.release?.title ?? item.artist?.name ?? 'Unmatched acquisition'}</strong><small>{item.artist?.name ?? item.underlyingDownloadRef ?? 'Lidarr'}</small></div>
              <time>{new Date(item.occurredAt).toLocaleString()}</time>
            </article>
          )) : <p className="empty-row">No recent history</p>}
        </section>
      </div>}
    </section>
  )
}

function WantedView({ acquisitions }: { acquisitions: AcquisitionsModel }) {
  return (
    <section>
      <div className="page-heading">
        <div><p>03 / NEEDLE STATE</p><h1>Wanted releases</h1></div>
        <button className="button" onClick={acquisitions.refresh} disabled={acquisitions.loading}>
          <RefreshCw size={13} className={acquisitions.loading ? 'spinning' : ''} /> Refresh
        </button>
      </div>
      {acquisitions.error && <div className="error-strip">{acquisitions.error}</div>}
      <section className="panel wanted-panel">
        <header><h2>Acquisition intent</h2><span>{acquisitions.items.length}</span></header>
        {acquisitions.items.length ? acquisitions.items.map(item => (
          <article className="wanted-row" key={item.id}>
            <div className="media-object case"><i /></div>
            <div><strong>{item.release}</strong><small>{item.artist ?? item.searchRefs[0]?.nativeId}</small></div>
            <span className="state-tag">{item.state}</span>
            <time>{new Date(item.createdAt).toLocaleString()}</time>
          </article>
        )) : <p className="empty-row">No wanted releases</p>}
      </section>
    </section>
  )
}

function App() {
  const [view, setView] = useState<View>('library')
  const lidarr = useLidarrReadModel()
  const acquisitions = useAcquisitions()
  const library = useLibrary()

  return (
    <div className="app-shell">
      <Header view={view} setView={setView} lidarr={lidarr} acquisitions={acquisitions} />
      <main>
        {view === 'library' && <LibraryView library={library} acquisitions={acquisitions} />}
        {view === 'wanted' && <WantedView acquisitions={acquisitions} />}
        {view === 'activity' && <ActivityView lidarr={lidarr} sectionNumber={acquisitions.configured ? '03' : '02'} />}
      </main>
    </div>
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected request failure'
}

function providerRefKey(ref: ProviderRef): string {
  return JSON.stringify([ref.adapterId, ref.nativeId])
}

function sourceWarning(sources: MusicSearchResponse['sources']): string {
  const messages = [
    sources.library === 'available' ? null : `Jellyfin library ${sources.library === 'unconfigured' ? 'not configured' : 'unavailable'}`,
    sources.catalog === 'available' ? null : `Lidarr catalog ${sources.catalog === 'unconfigured' ? 'not configured' : 'unavailable'}`,
    sources.wanted === 'available' ? null : 'Wanted state not configured',
  ].filter(Boolean)
  return messages.join(' · ')
}

const root = document.getElementById('root')
if (!root) throw new Error('Needle root element is missing')
createRoot(root).render(<App />)

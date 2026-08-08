import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, Bookmark, Check, Disc3, Radio, RefreshCw, Search } from 'lucide-react'
import './styles.css'

async function getJson(path, signal) {
  const response = await fetch(path, { signal })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`)
  return body
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`)
  return body
}

function useLidarrReadModel() {
  const [status, setStatus] = useState(null)
  const [queue, setQueue] = useState([])
  const [history, setHistory] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (signal) => {
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await getJson('/api/services/lidarr', signal)
      setStatus(nextStatus)
      if (!nextStatus.configured || nextStatus.health?.state !== 'available') {
        setQueue([])
        setHistory([])
        return
      }

      const [queuePage, historyPage] = await Promise.all([
        getJson('/api/services/lidarr/queue?limit=25', signal),
        getJson('/api/services/lidarr/history?limit=25', signal),
      ])
      setQueue(queuePage.items)
      setHistory(historyPage.items)
    } catch (requestError) {
      if (requestError.name !== 'AbortError') setError(requestError.message)
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

function useAcquisitions() {
  const [configured, setConfigured] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingRef, setSavingRef] = useState(null)

  const refresh = useCallback(async (signal) => {
    setLoading(true)
    setError(null)
    try {
      const result = await getJson('/api/acquisitions', signal)
      setConfigured(result.configured)
      setItems(result.items)
    } catch (requestError) {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  async function wantRelease(release) {
    setSavingRef(release.ref.nativeId)
    setError(null)
    try {
      const job = await postJson('/api/acquisitions', { release })
      setItems(current => current.some(item => item.id === job.id) ? current : [job, ...current])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSavingRef(null)
    }
  }

  function includes(release) {
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

function connectionLabel(lidarr) {
  if (lidarr.loading) return 'checking'
  if (lidarr.error) return 'error'
  if (!lidarr.status?.configured) return 'not configured'
  return lidarr.status.health?.state ?? 'unavailable'
}

function Header({ view, setView, lidarr, acquisitions }) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark"><Disc3 size={18} /></span>
        <span>needle<small>acquisition terminal</small></span>
      </div>
      <nav aria-label="Primary">
        <button className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')}>
          <Search size={14} /> Catalog
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

function IntegrationState({ lidarr }) {
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

function CatalogView({ lidarr, acquisitions }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState({ artists: [], releases: [] })
  const [hasSearched, setHasSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)

  async function searchCatalog(event) {
    event.preventDefault()
    const query = term.trim()
    if (!query) return
    setSearching(true)
    setError(null)
    try {
      const encoded = encodeURIComponent(query)
      const [artists, releases] = await Promise.all([
        getJson(`/api/services/lidarr/artists?term=${encoded}`),
        getJson(`/api/services/lidarr/releases?term=${encoded}`),
      ])
      setResults({ artists, releases })
      setHasSearched(true)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSearching(false)
    }
  }

  const available = lidarr.status?.configured && lidarr.status.health?.state === 'available' && !lidarr.error

  return (
    <section>
      <div className="page-heading">
        <div><p>01 / LIDARR CATALOG</p><h1>Catalog lookup</h1></div>
        <span>READ ONLY</span>
      </div>

      {!available ? <IntegrationState lidarr={lidarr} /> : <>
        <form className="search-form" onSubmit={searchCatalog}>
          <Search size={17} />
          <input
            aria-label="Artist or release"
            value={term}
            onChange={event => setTerm(event.target.value)}
            placeholder="artist or release"
            autoFocus
          />
          <button className="button primary" disabled={searching || !term.trim()}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        {error && <div className="error-strip">{error}</div>}
        {acquisitions.error && <div className="error-strip">{acquisitions.error}</div>}
        {!hasSearched ? <div className="idle-state"><div className="compact-disc"><i /></div><span>Enter an artist or release.</span></div> :
          <div className="catalog-results">
            <ResultPanel title="Artists" count={results.artists.length} empty="No artists found">
              {results.artists.map(artist => (
                <article className="result-row" key={artist.ref.nativeId}>
                  <div className="media-object disc"><i /></div>
                  <div><strong>{artist.name}</strong><small>{artist.disambiguation ?? artist.musicBrainzArtistId ?? 'Artist'}</small></div>
                  <code>ARTIST</code>
                </article>
              ))}
            </ResultPanel>
            <ResultPanel title="Releases" count={results.releases.length} empty="No releases found">
              {results.releases.map(release => (
                <article className="result-row" key={release.ref.nativeId}>
                  <div className="media-object case"><i /></div>
                  <div><strong>{release.title}</strong><small>{release.artistName ?? release.releaseType ?? release.musicBrainzReleaseGroupId}</small></div>
                  <div className="result-actions">
                    <code>{release.releaseDate?.slice(0, 4) ?? 'RELEASE'}</code>
                    {acquisitions.configured && <button
                      className={`want-button ${acquisitions.includes(release) ? 'saved' : ''}`}
                      disabled={acquisitions.includes(release) || acquisitions.savingRef !== null}
                      onClick={() => acquisitions.wantRelease(release)}
                    >
                      {acquisitions.includes(release)
                        ? <><Check size={11} /> Wanted</>
                        : acquisitions.savingRef === release.ref.nativeId ? 'Saving…' : <><Bookmark size={11} /> Want</>}
                    </button>}
                  </div>
                </article>
              ))}
            </ResultPanel>
          </div>}
      </>}
    </section>
  )
}

function ResultPanel({ title, count, empty, children }) {
  return (
    <section className="panel">
      <header><h2>{title}</h2><span>{count}</span></header>
      {count ? children : <p className="empty-row">{empty}</p>}
    </section>
  )
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'size unknown'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`
}

function QueueRow({ item }) {
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

function ActivityView({ lidarr, sectionNumber }) {
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

function WantedView({ acquisitions }) {
  return (
    <section>
      <div className="page-heading">
        <div><p>02 / NEEDLE STATE</p><h1>Wanted releases</h1></div>
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
  const [view, setView] = useState('catalog')
  const lidarr = useLidarrReadModel()
  const acquisitions = useAcquisitions()

  return (
    <div className="app-shell">
      <Header view={view} setView={setView} lidarr={lidarr} acquisitions={acquisitions} />
      <main>
        {view === 'catalog' && <CatalogView lidarr={lidarr} acquisitions={acquisitions} />}
        {view === 'wanted' && <WantedView acquisitions={acquisitions} />}
        {view === 'activity' && <ActivityView lidarr={lidarr} sectionNumber={acquisitions.configured ? '03' : '02'} />}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)

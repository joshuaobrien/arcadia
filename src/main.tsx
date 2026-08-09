import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowLeft, Bookmark, Check, Disc3, LibraryBig, PackageOpen, Radio, RefreshCw, Search, ShieldCheck } from 'lucide-react'
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

interface BeetsStatus {
  configured: boolean
  health?: {
    state: 'available' | 'degraded' | 'unavailable'
    version?: string
  }
}

interface BeetsInbox {
  name: string
  providerPath: string
  taggedCount: number
  importedCount: number
  bytes: number | null
  fileCount: number | null
  lastCreatedAt?: string
}

interface BeetsInboxEntry {
  name: string
  providerPath: string
  hash: string
  album: boolean
  type: 'directory' | 'file'
  children: BeetsInboxEntry[]
}

type BeetsImportStatus =
  | 'unknown' | 'failed' | 'not-started' | 'pending' | 'previewing'
  | 'previewed' | 'importing' | 'imported' | 'deleting' | 'deleted'

interface BeetsFolderStatus {
  providerPath: string
  hash: string
  status: BeetsImportStatus
}

interface BeetsPreviewCandidate {
  id: string
  kind: 'candidate' | 'as-is'
  artist?: string
  album?: string
  year?: number
  source?: string
  distance: number
  penalties: string[]
  trackCount: number
  duplicateCount: number
}

interface BeetsPreviewTask {
  id: string
  chosenCandidateId?: string
  currentMetadata: { artist?: string; album?: string; year?: number }
  items: { title?: string; artist?: string; length?: number; format?: string }[]
  candidates: BeetsPreviewCandidate[]
}

interface BeetsPreviewSession {
  id: string
  providerPath: string
  hash: string
  progress: number
  tasks: BeetsPreviewTask[]
}

interface BeetsJobAcknowledgement {
  jobId: string
  kind: 'preview' | 'import_candidate'
  providerPath: string
  hash: string
  operationId: string
}

type BeetsImportOperationState = 'submitting' | 'submitted' | 'submission-unknown' | 'provider-completed' | 'library-confirmed'

interface BeetsImportOperation {
  id: string
  sessionId: string
  providerPath: string
  hash: string
  state: BeetsImportOperationState
  selections: {
    taskId: string
    candidateId: string
    duplicateAction: 'skip' | 'keep'
    artist?: string
    album?: string
    year?: number
    trackCount: number
  }[]
  acquisitionId?: string
  providerJobId?: string
  libraryAlbumIds: string[]
  createdAt: string
  updatedAt: string
}

interface BeetsImportOperationsResponse {
  configured: boolean
  items: BeetsImportOperation[]
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
  state: 'wanted' | 'searching' | 'selection-required' | 'queued' | 'transferring' | 'importing' | 'completed' | 'failed' | 'cancelled'
  artist?: string
  release?: string
  musicBrainzReleaseGroupId?: string
  searchRefs: ProviderRef[]
  importRef?: ProviderRef
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
  error?: { code?: string; message?: string; providerCode?: string }
}

class UnknownSubmissionError extends Error {}
class ApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message) }
}

interface MusicRelease {
  key: string
  title: string
  artist: string
  year?: number
  state: 'in-library' | 'wanted' | 'importing' | 'selection-required' | 'can-request'
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

type View = 'library' | 'imports' | 'wanted' | 'activity'

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  const body = await response.json() as T & ErrorResponse
  if (!response.ok) throw requestError(body, response.status)
  return body
}

async function postJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  const body = await response.json() as T & ErrorResponse
  if (!response.ok) throw requestError(body, response.status)
  return body
}

async function postBeetsMutation(path: string, payload: { providerPath: string; hash: string; [key: string]: unknown }, kind: BeetsJobAcknowledgement['kind']): Promise<BeetsJobAcknowledgement> {
  let response: Response
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  } catch (error) {
    throw new UnknownSubmissionError(`Needle submission outcome is unknown; do not retry (${errorMessage(error)})`)
  }
  let body: BeetsJobAcknowledgement & ErrorResponse
  try {
    body = await response.json() as BeetsJobAcknowledgement & ErrorResponse
  } catch {
    throw new UnknownSubmissionError('Needle returned an unreadable submission response; do not retry')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new UnknownSubmissionError('Needle returned an invalid submission response; do not retry')
  if (!response.ok) throw requestError(body, response.status)
  if (response.status !== 202 || typeof body.jobId !== 'string' || !body.jobId || body.kind !== kind || body.providerPath !== payload.providerPath || body.hash !== payload.hash || typeof body.operationId !== 'string' || !body.operationId) {
    throw new UnknownSubmissionError('Needle returned an invalid submission acknowledgement; do not retry')
  }
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

function useBeetsImportOperations(onLifecycleChange: () => void) {
  const [configured, setConfigured] = useState(false)
  const [items, setItems] = useState<BeetsImportOperation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeRequest = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback((signal?: AbortSignal) => {
    if (inFlight.current) return inFlight.current
    const request = ++activeRequest.current
    const run = (async () => {
      setLoading(true)
      setError(null)
      try {
        let page = await getJson<BeetsImportOperationsResponse>('/api/imports/operations', signal)
        if (page.configured) {
          const pending = page.items.filter(item => item.state === 'submitted' || item.state === 'provider-completed')
          if (pending.length) {
            await Promise.allSettled(pending.map(item => postJson<BeetsImportOperation>(`/api/imports/operations/${encodeURIComponent(item.id)}/reconcile`, {}, signal)))
            page = await getJson<BeetsImportOperationsResponse>('/api/imports/operations', signal)
            onLifecycleChange()
          }
        }
        if (request !== activeRequest.current || signal?.aborted) return
        setConfigured(page.configured)
        setItems(page.items)
      } catch (requestError) {
        if (request === activeRequest.current && !isAbortError(requestError)) setError(errorMessage(requestError))
      } finally {
        if (request === activeRequest.current && !signal?.aborted) setLoading(false)
      }
    })()
    inFlight.current = run
    void run.finally(() => { if (inFlight.current === run) inFlight.current = null })
    return run
  }, [onLifecycleChange])

  useEffect(() => {
    const controller = new AbortController()
    refresh(controller.signal)
    const timer = window.setInterval(() => refresh(), 15_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [refresh])

  return { configured, items, loading, error, refresh: () => refresh() }
}

type BeetsImportOperationsModel = ReturnType<typeof useBeetsImportOperations>

function useBeetsReadModel(acquisitions: readonly AcquisitionJob[], onLifecycleChange: () => void) {
  const [status, setStatus] = useState<BeetsStatus | null>(null)
  const [inboxes, setInboxes] = useState<BeetsInbox[]>([])
  const [folders, setFolders] = useState<BeetsInboxEntry[]>([])
  const [folderStatuses, setFolderStatuses] = useState<BeetsFolderStatus[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedFolder, setSelectedFolder] = useState<BeetsInboxEntry | null>(null)
  const [preview, setPreview] = useState<BeetsPreviewSession | null>(null)
  const [workflowState, setWorkflowState] = useState<'idle' | 'previewing' | 'review' | 'importing' | 'completed' | 'provider-imported' | 'submission-unknown'>('idle')
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, string>>({})
  const [duplicateActions, setDuplicateActions] = useState<Record<string, 'skip' | 'keep'>>({})
  const [acquisitionDecision, setAcquisitionDecision] = useState<string | null | undefined>(undefined)
  const [approved, setApproved] = useState(false)
  const activeRequest = useRef(0)
  const submissionInFlight = useRef(false)
  const wantedAcquisitions = acquisitions.filter(item => item.state === 'wanted')
  const decisionValid = acquisitionDecision === null || (typeof acquisitionDecision === 'string' && wantedAcquisitions.some(item => item.id === acquisitionDecision))

  useEffect(() => {
    if (typeof acquisitionDecision === 'string' && !wantedAcquisitions.some(item => item.id === acquisitionDecision)) {
      setAcquisitionDecision(undefined)
      setApproved(false)
    }
  }, [acquisitionDecision, wantedAcquisitions])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const request = ++activeRequest.current
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await getJson<BeetsStatus>('/api/services/beets', signal)
      if (request !== activeRequest.current) return
      setStatus(nextStatus)
      if (!nextStatus.configured || nextStatus.health?.state !== 'available') {
        setInboxes([])
        setFolders([])
        setFolderStatuses([])
        return
      }
      const [inboxPage, folderPage, statusPage] = await Promise.all([
        getJson<Page<BeetsInbox>>('/api/imports/inboxes', signal),
        getJson<Page<BeetsInboxEntry>>('/api/imports/folders', signal),
        getJson<Page<BeetsFolderStatus>>('/api/imports/status', signal),
      ])
      if (request !== activeRequest.current) return
      setInboxes(inboxPage.items)
      setFolders(folderPage.items)
      setFolderStatuses(statusPage.items)
    } catch (requestError) {
      if (request === activeRequest.current && !isAbortError(requestError)) setError(errorMessage(requestError))
    } finally {
      if (request === activeRequest.current && !signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  async function openFolder(folder: BeetsInboxEntry) {
    if (submissionInFlight.current) return
    submissionInFlight.current = true
    const request = ++activeRequest.current
    setSelectedFolder(folder)
    setPreview(null)
    setSelectedCandidates({})
    setDuplicateActions({})
    setAcquisitionDecision(undefined)
    setApproved(false)
    setError(null)
    setWorkflowState('previewing')
    try {
      const existingStatus = currentFolderStatus(folder, folderStatuses)
      let session: BeetsPreviewSession
      if (existingStatus === 'previewed' || existingStatus === 'imported') {
        session = await getJson<BeetsPreviewSession>(previewPath(folder))
        const expectedProgress = existingStatus === 'imported' ? 40 : 20
        if (session.progress !== expectedProgress) throw new Error('The beets preview session is not ready for review')
      } else if (existingStatus === 'pending' || existingStatus === 'previewing' || existingStatus === 'importing') {
        session = await waitForExistingSession(folder, existingStatus === 'importing' ? 40 : 20, request)
      } else {
        let previousSessionId: string | undefined
        try {
          previousSessionId = (await getJson<BeetsPreviewSession>(previewPath(folder))).id
        } catch (error) {
          if (!(error instanceof ApiError && error.code === 'not-found')) throw error
        }
        await postBeetsMutation('/api/imports/preview', { providerPath: folder.providerPath, hash: folder.hash }, 'preview')
        session = await waitForNewPreview(folder, previousSessionId, request)
      }
      if (request !== activeRequest.current) return
      setPreview(session)
      setDuplicateActions(Object.fromEntries(session.tasks.map(task => [task.id, 'skip'])))
      setWorkflowState(existingStatus === 'importing' || existingStatus === 'imported' ? 'provider-imported' : 'review')
    } catch (requestError) {
      if (request === activeRequest.current) {
        setError(errorMessage(requestError))
        setWorkflowState(requestError instanceof UnknownSubmissionError ? 'submission-unknown' : 'idle')
      }
    } finally {
      submissionInFlight.current = false
    }
  }

  async function waitForNewPreview(folder: BeetsInboxEntry, previousSessionId: string | undefined, request: number) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (request !== activeRequest.current) throw new Error('Preview cancelled')
      try {
        const session = await getJson<BeetsPreviewSession>(previewPath(folder))
        if (session.id !== previousSessionId && session.progress === 20) return session
      } catch { /* session is not ready */ }
      await delay(1000)
    }
    throw new Error('beets-flask is still processing this album. Refresh to resume.')
  }

  async function waitForExistingSession(folder: BeetsInboxEntry, progress: number, request: number) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (request !== activeRequest.current) throw new Error('Preview cancelled')
      try {
        const session = await getJson<BeetsPreviewSession>(previewPath(folder))
        if (session.progress === progress) return session
      } catch { /* session is not ready */ }
      await delay(1000)
    }
    throw new Error('beets-flask is still processing this album. Refresh to resume.')
  }

  async function importSelection() {
    if (!selectedFolder || !preview || !approved || !decisionValid || submissionInFlight.current) return
    const choices = preview.tasks.map(task => ({
      taskId: task.id,
      candidateId: selectedCandidates[task.id],
      duplicateAction: duplicateActions[task.id] ?? 'skip',
    }))
    if (choices.some(choice => !choice.candidateId)) return
    submissionInFlight.current = true
    const request = ++activeRequest.current
    setError(null)
    setWorkflowState('importing')
    try {
      await postBeetsMutation('/api/imports/import', {
        providerPath: selectedFolder.providerPath,
        hash: selectedFolder.hash,
        sessionId: preview.id,
        choices,
        acquisitionId: acquisitionDecision,
      }, 'import_candidate')
      onLifecycleChange()
      await waitForImportCompletion(selectedFolder, preview.id, choices, request)
      if (request !== activeRequest.current) return
      setWorkflowState('completed')
      setApproved(false)
      await refresh()
    } catch (requestError) {
      if (request === activeRequest.current) {
        setError(errorMessage(requestError))
        setApproved(false)
        setWorkflowState(requestError instanceof UnknownSubmissionError ? 'submission-unknown' : 'review')
      }
    } finally {
      submissionInFlight.current = false
    }
  }

  async function waitForImportCompletion(folder: BeetsInboxEntry, sessionId: string, choices: { taskId: string; candidateId: string }[], request: number) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (request !== activeRequest.current) return
      try {
        const session = await getJson<BeetsPreviewSession>(previewPath(folder))
        const selectionsMatch = choices.every(choice => session.tasks.find(task => task.id === choice.taskId)?.chosenCandidateId === choice.candidateId)
        if (session.id === sessionId && session.progress === 40 && selectionsMatch) return
      } catch { /* import is not complete */ }
      await delay(1000)
    }
    throw new Error('beets-flask is still importing this album. Refresh to inspect its status.')
  }

  function closeFolder() {
    activeRequest.current += 1
    setSelectedFolder(null)
    setPreview(null)
    setWorkflowState('idle')
    setSelectedCandidates({})
    setDuplicateActions({})
    setAcquisitionDecision(undefined)
    setApproved(false)
    setError(null)
  }

  return {
    status, inboxes, folders, folderStatuses, error, loading, refresh: () => refresh(),
    selectedFolder, preview, workflowState, selectedCandidates, duplicateActions, acquisitionDecision, approved,
    wantedAcquisitions, decisionValid,
    openFolder, closeFolder, importSelection, setApproved,
    setAcquisitionDecision: (id: string | null) => { setApproved(false); setAcquisitionDecision(id) },
    selectCandidate: (taskId: string, candidateId: string) => { setApproved(false); setSelectedCandidates(current => ({ ...current, [taskId]: candidateId })) },
    setDuplicateAction: (taskId: string, action: 'skip' | 'keep') => { setApproved(false); setDuplicateActions(current => ({ ...current, [taskId]: action })) },
  }
}

type BeetsReadModel = ReturnType<typeof useBeetsReadModel>

function useAcquisitions() {
  const [configured, setConfigured] = useState(false)
  const [items, setItems] = useState<AcquisitionJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingRef, setSavingRef] = useState<string | null>(null)
  const activeRequest = useRef(0)

  const refresh = useCallback((signal?: AbortSignal) => {
    const request = ++activeRequest.current
    const run = (async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await getJson<AcquisitionResponse>('/api/acquisitions', signal)
        if (request !== activeRequest.current || signal?.aborted) return
        setConfigured(result.configured)
        setItems(result.items)
      } catch (requestError) {
        if (request === activeRequest.current && !isAbortError(requestError)) setError(errorMessage(requestError))
      } finally {
        if (request === activeRequest.current && !signal?.aborted) setLoading(false)
      }
    })()
    return run
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

  const refreshNow = useCallback(() => refresh(), [refresh])

  return {
    configured,
    items,
    loading,
    error,
    savingRef,
    refresh: refreshNow,
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
        <button className={view === 'imports' ? 'active' : ''} onClick={() => setView('imports')}>
          <PackageOpen size={14} /> Imports
        </button>
        {acquisitions.configured && <button className={view === 'wanted' ? 'active' : ''} onClick={() => setView('wanted')}>
          <Bookmark size={14} /> Journeys
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

function formatBytes(value?: number | null): string {
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
        {item.state === 'importing' ? <span className="release-state importing"><Radio size={9} /> Importing</span>
          : item.state === 'selection-required' ? <span className="release-state selection-required">Needs attention</span>
            : item.state === 'in-library' ? <span className="release-state present"><Check size={9} /> In library</span>
              : wanted ? <span className="release-state wanted"><Check size={9} /> Wanted</span>
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

function ActivityView({ lidarr, imports, sectionNumber }: { lidarr: LidarrReadModel; imports: BeetsImportOperationsModel; sectionNumber: string }) {
  const available = lidarr.status?.configured && lidarr.status.health?.state === 'available' && !lidarr.error
  const refreshing = lidarr.loading || imports.loading

  return (
    <section>
      <div className="page-heading">
        <div><p>{sectionNumber} / NEEDLE OPERATIONS</p><h1>Activity</h1></div>
        <button className="button" onClick={() => { void lidarr.refresh(); void imports.refresh() }} disabled={refreshing}>
          <RefreshCw size={13} className={refreshing ? 'spinning' : ''} /> Refresh
        </button>
      </div>

      {!available && <IntegrationState lidarr={lidarr} />}
      {imports.error && <div className="error-strip">{imports.error}</div>}
      <div className="activity-grid">
        {available && <section className="panel queue-panel">
          <header><h2>Queue</h2><span>{lidarr.queue.length}</span></header>
          {lidarr.queue.length
            ? lidarr.queue.map(item => <QueueRow item={item} key={item.ref.nativeId} />)
            : <p className="empty-row">Queue empty</p>}
        </section>}
        {available && <section className="panel history-panel">
          <header><h2>Recent history</h2><span>{lidarr.history.length}</span></header>
          {lidarr.history.length ? lidarr.history.map(item => (
            <article className="history-row" key={item.ref.nativeId}>
              <span>{item.eventType}</span>
              <div><strong>{item.release?.title ?? item.artist?.name ?? 'Unmatched acquisition'}</strong><small>{item.artist?.name ?? item.underlyingDownloadRef ?? 'Lidarr'}</small></div>
              <time>{new Date(item.occurredAt).toLocaleString()}</time>
            </article>
          )) : <p className="empty-row">No recent history</p>}
        </section>}
        <section className="panel import-history-panel">
          <header><h2>Beets imports</h2><span>{imports.items.length}</span></header>
          {!imports.configured && !imports.loading ? <p className="empty-row">Needle database persistence is not configured</p>
            : imports.items.length ? imports.items.map(item => <ImportOperationRow item={item} key={item.id} />)
              : <p className="empty-row">No Needle-managed imports yet</p>}
        </section>
      </div>
    </section>
  )
}

function ImportOperationRow({ item }: { item: BeetsImportOperation }) {
  const first = item.selections[0]
  const title = first?.album ?? item.providerPath.split('/').filter(Boolean).pop() ?? 'Beets import'
  const detail = [first?.artist, item.selections.length > 1 ? `${item.selections.length} reviewed tasks` : `${first?.trackCount ?? 0} tracks`, item.acquisitionId ? 'Linked journey' : 'No wanted release'].filter(Boolean).join(' · ')
  const labels: Record<BeetsImportOperationState, string> = {
    submitting: 'submission pending',
    submitted: 'beets submitted',
    'submission-unknown': 'outcome unknown',
    'provider-completed': 'awaiting Jellyfin',
    'library-confirmed': 'library confirmed',
  }
  return <article className="history-row import-operation-row">
    <span className={item.state}>{labels[item.state]}</span>
    <div><strong>{title}</strong><small>{detail || item.providerPath}</small></div>
    <time>{new Date(item.updatedAt).toLocaleString()}</time>
  </article>
}

function ImportsView({ beets }: { beets: BeetsReadModel }) {
  const available = beets.status?.configured && beets.status.health?.state === 'available' && !beets.error
  const albums = beets.folders.flatMap(root => collectStagedAlbums(root))
  const selected = beets.selectedFolder

  if (selected) return <ImportReview beets={beets} folder={selected} />

  return (
    <section>
      <div className="page-heading">
        <div><p>02 / BEETS STAGING</p><h1>Imports</h1></div>
        <button className="button" onClick={beets.refresh} disabled={beets.loading}>
          <RefreshCw size={13} className={beets.loading ? 'spinning' : ''} /> Refresh
        </button>
      </div>
      {!available ? <div className="integration-state">
        <PackageOpen size={21} />
        <strong>{beets.loading ? 'Reading beets inboxes' : beets.error ?? (!beets.status?.configured ? 'beets-flask is not configured' : 'beets-flask is unavailable')}</strong>
        <small>Staging and import state require the beets-flask connection.</small>
        {!beets.loading && <button className="button" onClick={beets.refresh}><RefreshCw size={13} /> Retry</button>}
      </div> : <>
        <div className="inbox-grid">
          {beets.inboxes.map(inbox => (
            <article className="inbox-card" key={inbox.providerPath}>
              <header><strong>{inbox.name}</strong><span>{inbox.fileCount === null ? 'file count unknown' : `${inbox.fileCount} files`}</span></header>
              <b>{formatBytes(inbox.bytes)}</b>
              <dl>
                <div><dt>Tagged</dt><dd>{inbox.taggedCount}</dd></div>
                <div><dt>Imported</dt><dd>{inbox.importedCount}</dd></div>
              </dl>
              <small>{inbox.lastCreatedAt ? `Latest ${new Date(inbox.lastCreatedAt).toLocaleString()}` : 'No import session recorded'}</small>
            </article>
          ))}
        </div>
        <section className="panel imports-panel">
          <header><h2>Staged albums</h2><span>{albums.length}</span></header>
          {albums.length ? albums.map(entry => {
            const status = currentFolderStatus(entry, beets.folderStatuses)
            const inbox = beets.inboxes.find(item => entry.providerPath === item.providerPath || entry.providerPath.startsWith(`${item.providerPath}/`))
            return (
              <button className="import-row" key={`${entry.providerPath}:${entry.hash}`} onClick={() => beets.openFolder(entry)} disabled={!entry.hash}>
                <div className="media-object case"><i /></div>
                <div><strong>{entry.name}</strong><small>{inbox?.name ?? 'Beets inbox'} · {countFiles(entry)} files</small></div>
                <span className={`state-tag ${status ?? 'unknown'}`}>{(status ?? 'untracked').replace('-', ' ')}</span>
              </button>
            )
          }) : <p className="empty-row">No staged albums detected</p>}
        </section>
      </>}
    </section>
  )
}

function ImportReview({ beets, folder }: { beets: BeetsReadModel; folder: BeetsInboxEntry }) {
  const session = beets.preview
  const allSelected = Boolean(session?.tasks.length) && session!.tasks.every(task => beets.selectedCandidates[task.id])
  const busy = beets.workflowState === 'previewing' || beets.workflowState === 'importing'
  const locked = busy || beets.workflowState === 'completed' || beets.workflowState === 'provider-imported'

  return (
    <section>
      <div className="page-heading">
        <div><p>02 / BEETS REVIEW</p><h1>{folder.name}</h1></div>
        <button className="button" onClick={beets.closeFolder} disabled={busy}><ArrowLeft size={13} /> Imports</button>
      </div>
      {beets.error && <div className="error-strip">{beets.error}</div>}
      {beets.workflowState === 'previewing' && <div className="idle-state compact">
        <Disc3 size={28} className="spinning" /><span>Generating beets metadata preview</span>
      </div>}
      {beets.workflowState === 'submission-unknown' && !session && <div className="integration-state">
        <Radio size={21} />
        <strong>Preview submission outcome unknown</strong>
        <small>Do not retry. Return to Imports and refresh beets status before taking another action.</small>
        <button className="button" onClick={beets.closeFolder}><ArrowLeft size={13} /> Imports</button>
      </div>}
      {session && <div className="preview-layout">
        {session.tasks.map((task, taskIndex) => (
          <section className="panel preview-task" key={task.id}>
            <header><h2>{task.currentMetadata.album ?? `Album group ${taskIndex + 1}`}</h2><span>{task.items.length} tracks</span></header>
            <div className="candidate-list">
              {task.candidates.map(candidate => {
                const active = beets.selectedCandidates[task.id] === candidate.id
                return <button
                  className={`candidate-card ${active ? 'selected' : ''}`}
                  key={candidate.id}
                  onClick={() => beets.selectCandidate(task.id, candidate.id)}
                  disabled={locked}
                >
                  <span className="candidate-radio">{active && <Check size={11} />}</span>
                  <div>
                    <strong>{candidate.kind === 'as-is' ? 'Keep current metadata' : candidate.album ?? 'Untitled candidate'}</strong>
                    <small>{candidate.kind === 'as-is' ? `${task.currentMetadata.artist ?? 'Unknown artist'} · as downloaded` : [candidate.artist, candidate.year, candidate.source].filter(Boolean).join(' · ')}</small>
                    <code>{candidate.trackCount} tracks · distance {candidate.distance.toFixed(3)}{candidate.duplicateCount ? ` · ${candidate.duplicateCount} duplicate${candidate.duplicateCount === 1 ? '' : 's'}` : ''}</code>
                    {candidate.penalties.length > 0 && <em>{candidate.penalties.join(' · ')}</em>}
                  </div>
                </button>
              })}
            </div>
            <div className="preview-tracks">
              {task.items.map((item, index) => <div key={`${item.title}:${index}`}>
                <b>{index + 1}</b><span><strong>{item.title ?? 'Untitled track'}</strong><small>{item.artist ?? item.format ?? 'Audio'}</small></span>
                <code>{formatDuration(item.length)}</code>
              </div>)}
            </div>
            <label className="duplicate-policy">
              If this album duplicates library metadata
              <select value={beets.duplicateActions[task.id] ?? 'skip'} onChange={event => beets.setDuplicateAction(task.id, event.target.value as 'skip' | 'keep')} disabled={locked}>
                <option value="skip">Skip the duplicate</option>
                <option value="keep">Keep both copies</option>
              </select>
            </label>
          </section>
        ))}
        <section className="panel lifecycle-link-panel">
          <header><h2>Release journey</h2><span>Explicit link</span></header>
          <label className="duplicate-policy">
            Does this import fulfill a wanted release?
            <select
              value={beets.acquisitionDecision === undefined ? '' : beets.acquisitionDecision ?? '__none__'}
              onChange={event => beets.setAcquisitionDecision(event.target.value === '__none__' ? null : event.target.value)}
              disabled={locked}
            >
              <option value="" disabled>Choose a lifecycle decision</option>
              <option value="__none__">No — this is not tied to a wanted release</option>
              {beets.wantedAcquisitions.map(item => <option value={item.id} key={item.id}>{item.artist ? `${item.artist} — ` : ''}{item.release ?? item.id}</option>)}
            </select>
          </label>
          <p className="lifecycle-note">Needle cannot safely infer this association from beets metadata. A selected journey moves to importing now and completes only after Jellyfin confirmation.</p>
        </section>
        <section className="import-approval panel">
          {beets.workflowState === 'completed' ? <div className="completion-message"><Check size={18} /><strong>Beets workflow completed</strong><small>Canonical-library presence has not yet been confirmed through Jellyfin.</small></div>
            : beets.workflowState === 'provider-imported' ? <div className="completion-message"><Check size={18} /><strong>Beets reports this folder as imported</strong><small>This is historical provider state; Needle did not record or verify the choices used for that import.</small></div>
            : beets.workflowState === 'submission-unknown' ? <div className="completion-message unknown"><Radio size={18} /><strong>Submission outcome unknown</strong><small>Do not retry. Refresh the Imports page and inspect beets status before taking another action.</small></div> : <>
            <label>
              <input type="checkbox" checked={beets.approved} onChange={event => beets.setApproved(event.target.checked)} disabled={busy || !allSelected || !beets.decisionValid} />
              <span><strong>I approve these choices</strong><small>Beets will run the selected metadata and duplicate policy. A skipped duplicate may complete without adding another library copy. Staging files are retained.</small></span>
            </label>
            <button className="button primary" onClick={beets.importSelection} disabled={!allSelected || !beets.approved || !beets.decisionValid || busy}>
              <ShieldCheck size={13} /> {beets.workflowState === 'importing' ? 'Importing…' : 'Import selected metadata'}
            </button>
          </>}
        </section>
      </div>}
    </section>
  )
}

function WantedView({ acquisitions }: { acquisitions: AcquisitionsModel }) {
  return (
    <section>
      <div className="page-heading">
        <div><p>03 / NEEDLE STATE</p><h1>Release journeys</h1></div>
        <button className="button" onClick={acquisitions.refresh} disabled={acquisitions.loading}>
          <RefreshCw size={13} className={acquisitions.loading ? 'spinning' : ''} /> Refresh
        </button>
      </div>
      {acquisitions.error && <div className="error-strip">{acquisitions.error}</div>}
      <section className="panel wanted-panel">
        <header><h2>Acquisition lifecycle</h2><span>{acquisitions.items.length}</span></header>
        {acquisitions.items.length ? acquisitions.items.map(item => (
          <article className="wanted-row" key={item.id}>
            <div className="media-object case"><i /></div>
            <div><strong>{item.release}</strong><small>{item.artist ?? item.searchRefs[0]?.nativeId}</small></div>
            <span className={`state-tag ${item.state}`}>{item.state.replace('-', ' ')}</span>
            <time>{new Date(item.createdAt).toLocaleString()}</time>
          </article>
        )) : <p className="empty-row">No release journeys yet</p>}
      </section>
    </section>
  )
}

function App() {
  const [view, setView] = useState<View>('library')
  const lidarr = useLidarrReadModel()
  const acquisitions = useAcquisitions()
  const importOperations = useBeetsImportOperations(acquisitions.refresh)
  const beets = useBeetsReadModel(acquisitions.items, acquisitions.refresh)
  const library = useLibrary()

  return (
    <div className="app-shell">
      <Header view={view} setView={setView} lidarr={lidarr} acquisitions={acquisitions} />
      <main>
        {view === 'library' && <LibraryView library={library} acquisitions={acquisitions} />}
        {view === 'imports' && <ImportsView beets={beets} />}
        {view === 'wanted' && <WantedView acquisitions={acquisitions} />}
        {view === 'activity' && <ActivityView lidarr={lidarr} imports={importOperations} sectionNumber={acquisitions.configured ? '04' : '03'} />}
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

function collectStagedAlbums(entry: BeetsInboxEntry): BeetsInboxEntry[] {
  return [
    ...(entry.album ? [entry] : []),
    ...entry.children.flatMap(child => collectStagedAlbums(child)),
  ]
}

function countFiles(entry: BeetsInboxEntry): number {
  return entry.type === 'file' ? 1 : entry.children.reduce((total, child) => total + countFiles(child), 0)
}

function currentFolderStatus(folder: BeetsInboxEntry, statuses: BeetsFolderStatus[]): BeetsImportStatus | undefined {
  return statuses.find(item => item.providerPath === folder.providerPath && item.hash === folder.hash)?.status
}

function previewPath(folder: BeetsInboxEntry): string {
  const query = new URLSearchParams({ providerPath: folder.providerPath, hash: folder.hash })
  return `/api/imports/preview?${query}`
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function requestError(body: ErrorResponse, status: number): Error {
  const message = body.error?.message ?? `Request failed (${status})`
  return body.error?.providerCode === 'outcome-unknown' ? new UnknownSubmissionError(message) : new ApiError(message, body.error?.code)
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

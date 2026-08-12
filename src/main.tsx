import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowLeft, Bookmark, Check, Cloud, Disc3, Grid2X2, LibraryBig, ListMusic, PackageOpen, Pause, Play, Radio, RefreshCw, Search, ShieldCheck, UserRound, Volume2, VolumeX, X } from 'lucide-react'
import './styles.css'

const EcoScene = lazy(() => import('./EcoScene.js'))
const NowPlayingVisualizer = lazy(() => import('./NowPlayingVisualizer.js'))

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
  trackCount?: number
  musicBrainzReleaseGroupId?: string
}

interface AcquisitionSourceStatus {
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

interface DirectEdition {
  id: string
  title?: string
  date?: string
  country?: string
  status?: string
  label?: string
  catalogNumber?: string
  media: { position: number; title?: string; format?: string }[]
  tracks: { title: string }[]
}

interface DirectCandidateFile { path: string; name: string; extension: string; size: number; bitRate?: number; length?: number }
interface DirectCandidateMatch { editionId: string; score: number; reasons: string[]; mappedTracks: number; missingTracks: number; extraTracks: number; rejected: boolean }
interface DirectCandidate { id: string; peer: string; path: string; audioFiles: DirectCandidateFile[]; metadataFiles: DirectCandidateFile[]; matches: DirectCandidateMatch[]; score: number; autoSelectEligible: boolean }
interface DirectWorkflow { acquisitionId: string; editions: DirectEdition[]; candidates: DirectCandidate[]; submissionState: 'none' | 'submitting' | 'submitted' | 'submission-unknown'; selectedCandidateId?: string; expectedFileCount: number; error?: string }
interface DirectCandidatesResponse { workflow: DirectWorkflow; candidates: DirectCandidate[] }

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
  country?: string
  label?: string
  catalogNumber?: string
  media?: string
  mediumCount?: number
  distance: number
  penalties: string[]
  trackCount: number
  tracks: { title?: string; artist?: string; length?: number; index?: number; medium?: number }[]
  trackMapping: Record<string, number>
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

interface AcquisitionJob {
  id: string
  state: 'wanted' | 'searching' | 'selection-required' | 'queued' | 'transferring' | 'importing' | 'completed' | 'failed' | 'cancelled'
  artist?: string
  release?: string
  releaseDate?: string
  releaseType?: string
  trackCount?: number
  musicBrainzReleaseGroupId?: string
  searchRefs: ProviderRef[]
  importRef?: ProviderRef
  createdAt: string
  updatedAt: string
}

interface AcquisitionResponse {
  configured: boolean
  items: AcquisitionJob[]
}

interface Page<T> {
  items: T[]
  nextCursor?: string
}

type JourneyStage = 'requested' | 'queued' | 'downloading' | 'review' | 'importing' | 'verifying' | 'collected' | 'attention'

interface JourneyDetailResponse {
  job: AcquisitionJob
  stage: JourneyStage
  progress?: { percent?: number; bytesTotal?: number; bytesRemaining?: number; etaSeconds?: number; completedFiles?: number; expectedFiles?: number }
  events: { kind: string; label: string; occurredAt: string; detail?: string }[]
  nextAction?: { kind: 'review'; folder: BeetsInboxEntry }
  importOperation?: BeetsImportOperation
  libraryAlbumIds: string[]
  sources: {
    download: 'available' | 'unconfigured' | 'unavailable'
    review: 'available' | 'unconfigured' | 'unavailable'
  }
}

interface LibraryTrack {
  id?: string
  albumId?: string
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

interface PlayerTrack extends LibraryTrack {
  id: string
  title: string
}

interface PlaybackSelection {
  track: PlayerTrack
  requestId: number
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

interface LibraryArtist {
  name: string
  albumCount: number
  representativeAlbumId?: string
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
    artists: 'available' | 'unconfigured' | 'unavailable'
    tracks: 'available' | 'unconfigured' | 'unavailable'
    catalog: 'available' | 'unconfigured' | 'unavailable'
    wanted: 'available' | 'unconfigured' | 'unavailable'
  }
  items: MusicRelease[]
  artists: LibraryArtist[]
  tracks: LibraryTrack[]
}

type LibrarySection = 'albums' | 'artists' | 'songs'

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

interface JourneyActivity {
  label: string
  className: string
  detail: string
  percent?: number
}

function journeyActivity(item: AcquisitionJob): JourneyActivity {
  if (item.state !== 'wanted') {
    const states: Record<Exclude<AcquisitionJob['state'], 'wanted'>, JourneyActivity> = {
      searching: { label: 'Searching', className: 'searching', detail: 'Looking for this release' },
      'selection-required': { label: 'Needs attention', className: 'selection-required', detail: 'Review the acquisition outcome' },
      queued: { label: 'Queued', className: 'queued', detail: 'Waiting to download' },
      transferring: { label: 'Transferring', className: 'downloading', detail: 'Transfer in progress' },
      importing: { label: 'Importing', className: 'importing', detail: 'Moving into your collection' },
      completed: item.importRef ? { label: 'Collected', className: 'completed', detail: 'Verified in your collection' } : { label: 'Ready for review', className: 'completed', detail: 'Downloaded · ready for review' },
      failed: { label: 'Failed', className: 'failed', detail: 'Acquisition needs attention' },
      cancelled: { label: 'Cancelled', className: 'cancelled', detail: 'Acquisition was cancelled' },
    }
    return states[item.state]
  }
  return { label: 'Requested', className: 'selection-required', detail: 'Legacy request needs attention' }
}

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
  const explicitAcquisition = typeof acquisitionDecision === 'string'
    ? acquisitions.find(item => item.id === acquisitionDecision)
    : undefined
  const linkableAcquisitions = explicitAcquisition && !wantedAcquisitions.some(item => item.id === explicitAcquisition.id)
    ? [...wantedAcquisitions, explicitAcquisition]
    : wantedAcquisitions
  const decisionValid = acquisitionDecision === null || (typeof acquisitionDecision === 'string' && linkableAcquisitions.some(item => item.id === acquisitionDecision))

  useEffect(() => {
    if (typeof acquisitionDecision === 'string' && !acquisitions.some(item => item.id === acquisitionDecision)) {
      setAcquisitionDecision(undefined)
      setApproved(false)
    }
  }, [acquisitionDecision, acquisitions])

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

  function openFolder(folder: BeetsInboxEntry, acquisitionId?: string): boolean {
    if (submissionInFlight.current) return false
    submissionInFlight.current = true
    const request = ++activeRequest.current
    setSelectedFolder(folder)
    setPreview(null)
    setSelectedCandidates({})
    setDuplicateActions({})
    setAcquisitionDecision(acquisitionId)
    setApproved(false)
    setError(null)
    setWorkflowState('previewing')
    void openFolderWorkflow(folder, request)
    return true
  }

  async function openFolderWorkflow(folder: BeetsInboxEntry, request: number) {
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
    linkableAcquisitions, decisionValid,
    openFolder, closeFolder, importSelection, setApproved,
    setAcquisitionDecision: (id: string | null) => { setApproved(false); setAcquisitionDecision(id) },
    selectCandidate: (taskId: string, candidateId: string) => { setApproved(false); setSelectedCandidates(current => ({ ...current, [taskId]: candidateId })) },
    setDuplicateAction: (taskId: string, action: 'skip' | 'keep') => { setApproved(false); setDuplicateActions(current => ({ ...current, [taskId]: action })) },
  }
}

type BeetsReadModel = ReturnType<typeof useBeetsReadModel>

function useAcquisitions() {
  const [configured, setConfigured] = useState(false)
  const [source, setSource] = useState<AcquisitionSourceStatus | null>(null)
  const [items, setItems] = useState<AcquisitionJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [savingRef, setSavingRef] = useState<string | null>(null)
  const activeRequest = useRef(0)

  const refresh = useCallback((signal?: AbortSignal) => {
    const request = ++activeRequest.current
    const run = (async () => {
      setLoading(true)
      setError(null)
      setSourceError(null)
      try {
        const result = await getJson<AcquisitionResponse>('/api/acquisitions', signal)
        let slskd: AcquisitionSourceStatus | null = null
        try {
          slskd = await getJson<AcquisitionSourceStatus>('/api/services/slskd', signal)
        } catch (requestError) {
          if (isAbortError(requestError)) throw requestError
          setSourceError(errorMessage(requestError))
        }
        if (request !== activeRequest.current || signal?.aborted) return
        setSource(slskd)
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
      const message = errorMessage(requestError)
      await refresh()
      setError(message)
    } finally {
      setSavingRef(null)
    }
  }

  function find(release: CatalogRelease) {
    const musicBrainzReleaseGroupId = release.musicBrainzReleaseGroupId?.toLowerCase()
    return items.find(item => (
      (musicBrainzReleaseGroupId && item.musicBrainzReleaseGroupId?.toLowerCase() === musicBrainzReleaseGroupId)
      || item.searchRefs.some(ref => (
      ref.adapterId === release.ref.adapterId && ref.nativeId === release.ref.nativeId
      ))
    ))
  }

  const refreshNow = useCallback(() => refresh(), [refresh])

  return {
    configured,
    source,
    sourceError,
    ready: configured && source?.configured === true && source.health?.state === 'available',
    items,
    loading,
    error,
    savingRef,
    refresh: refreshNow,
    wantRelease,
    find,
  }
}

type AcquisitionsModel = ReturnType<typeof useAcquisitions>

function useLibrary() {
  const [page, setPage] = useState<LibraryPage<LibraryAlbum> | null>(null)
  const [artistPage, setArtistPage] = useState<LibraryPage<LibraryArtist> | null>(null)
  const [songPage, setSongPage] = useState<LibraryPage<LibraryTrack> | null>(null)
  const [section, setSection] = useState<LibrarySection>('albums')
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
    void browse(section)
  }

  function searchFor(query: string) {
    setTerm(query)
    setActiveTerm(query)
    void searchReleases(query)
  }

  async function browse(nextSection: LibrarySection) {
    const request = ++albumRequest.current
    setSection(nextSection)
    setSelectedAlbum(null)
    setTracks([])
    setActiveTerm('')
    setSearchResult(null)
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    try {
      if (nextSection === 'albums') {
        await loadAlbums('')
        return
      }
      const endpoint = nextSection === 'artists' ? 'artists' : 'songs'
      const next = await getJson<LibraryPage<LibraryArtist> | LibraryPage<LibraryTrack>>(`/api/library/${endpoint}?limit=50`)
      if (request !== albumRequest.current) return
      if (nextSection === 'artists') setArtistPage(next as LibraryPage<LibraryArtist>)
      else setSongPage(next as LibraryPage<LibraryTrack>)
    } catch (requestError) {
      if (request === albumRequest.current) setError(errorMessage(requestError))
    } finally {
      if (request === albumRequest.current) setLoading(false)
    }
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
    const current = section === 'albums' ? page : section === 'artists' ? artistPage : songPage
    if (!current?.nextCursor) return
    const request = albumRequest.current
    setLoadingMore(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: section === 'albums' ? '48' : '50', cursor: current.nextCursor })
      const endpoint = section === 'albums' ? 'albums' : section === 'artists' ? 'artists' : 'songs'
      const next = await getJson<LibraryPage<LibraryAlbum> | LibraryPage<LibraryArtist> | LibraryPage<LibraryTrack>>(`/api/library/${endpoint}?${params}`)
      if (request !== albumRequest.current) return
      if (section === 'albums') setPage(currentPage => currentPage ? { ...(next as LibraryPage<LibraryAlbum>), items: [...currentPage.items, ...(next as LibraryPage<LibraryAlbum>).items] } : next as LibraryPage<LibraryAlbum>)
      else if (section === 'artists') setArtistPage(currentPage => currentPage ? { ...(next as LibraryPage<LibraryArtist>), items: [...currentPage.items, ...(next as LibraryPage<LibraryArtist>).items] } : next as LibraryPage<LibraryArtist>)
      else setSongPage(currentPage => currentPage ? { ...(next as LibraryPage<LibraryTrack>), items: [...currentPage.items, ...(next as LibraryPage<LibraryTrack>).items] } : next as LibraryPage<LibraryTrack>)
    } catch (requestError) {
      if (request === albumRequest.current) setError(errorMessage(requestError))
    } finally {
      if (request === albumRequest.current) setLoadingMore(false)
    }
  }

  async function openAlbum(album: LibraryAlbum) {
    const request = ++albumRequest.current
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
      if (request !== albumRequest.current) return
      setSelectedAlbum(album)
      setTracks(items)
    } catch (requestError) {
      if (request === albumRequest.current && !isAbortError(requestError)) setError(errorMessage(requestError))
    } finally {
      if (request === albumRequest.current) setOpeningAlbum(null)
    }
  }

  return {
    page,
    artistPage,
    songPage,
    section,
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
    searchFor,
    clearSearch,
    browse,
    refresh: () => activeTerm ? searchReleases(activeTerm) : browse(section),
    loadMore,
    openAlbum,
    cancelPending: () => { albumRequest.current += 1; setOpeningAlbum(null) },
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

function tiltAlbumCard(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType !== 'mouse') return
  const bounds = event.currentTarget.getBoundingClientRect()
  const x = (event.clientX - bounds.left) / bounds.width
  const y = (event.clientY - bounds.top) / bounds.height
  event.currentTarget.style.setProperty('--tilt-x', `${(0.5 - y) * 13}deg`)
  event.currentTarget.style.setProperty('--tilt-y', `${(x - 0.5) * 15}deg`)
  event.currentTarget.style.setProperty('--glow-x', `${x * 100}%`)
  event.currentTarget.style.setProperty('--glow-y', `${y * 100}%`)
}

function resetAlbumCardTilt(event: ReactPointerEvent<HTMLElement>) {
  event.currentTarget.style.removeProperty('--tilt-x')
  event.currentTarget.style.removeProperty('--tilt-y')
  event.currentTarget.style.removeProperty('--glow-x')
  event.currentTarget.style.removeProperty('--glow-y')
}

function OwnedAlbumCard({ album, library, playTrack, title = album.title, inLibrary = false }: {
  album: LibraryAlbum
  library: LibraryModel
  playTrack: (track: PlayerTrack) => void
  title?: string
  inLibrary?: boolean
}) {
  const [loadingTrack, setLoadingTrack] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)

  async function playAlbum() {
    setLoadingTrack(true)
    setPlayError(null)
    try {
      const result = await getJson<LibraryPage<LibraryTrack>>(`/api/library/albums/${album.id}/tracks?limit=1`)
      const track = result.items[0]
      if (!track?.id) throw new Error('No playable tracks found')
      playTrack({
        ...track,
        id: track.id,
        title: track.title ?? 'Untitled track',
        albumId: album.id,
        album: album.title,
        albumArtist: album.albumArtist,
      })
    } catch (requestError) {
      setPlayError(errorMessage(requestError))
    } finally {
      setLoadingTrack(false)
    }
  }

  return <article className={`album-card owned-album-card${inLibrary ? ' release-card' : ''}`} onPointerMove={tiltAlbumCard} onPointerLeave={resetAlbumCardTilt}>
    <button
      className="album-open"
      onClick={() => library.openAlbum(album)}
      disabled={library.openingAlbum !== null}
      aria-label={`Open ${title} by ${album.albumArtist}`}
    >
      <AlbumArtwork album={album} key={`${album.id}:${library.artworkRevision}`} />
      <strong>{title}</strong>
      <small>{album.albumArtist}</small>
      <div className="album-meta"><span>{album.year ?? '—'}</span>{inLibrary ? <span className="release-state present">In library</span> : <span>{album.trackCount ? `${album.trackCount} tracks` : 'Album'}</span>}</div>
    </button>
    <button
      className="album-play"
      onClick={playAlbum}
      disabled={loadingTrack}
      aria-label={`Play ${title} by ${album.albumArtist}`}
      title={playError ?? `Play ${title}`}
    >
      {loadingTrack ? <RefreshCw size={16} className="spinning" /> : <Play size={16} fill="currentColor" />}
    </button>
    {playError && <span className="album-play-error" role="status">Playback unavailable</span>}
  </article>
}

function AlbumDetailHero({ album, tracks, close, playTrack }: {
  album: LibraryAlbum
  tracks: LibraryTrack[]
  close: () => void
  playTrack: (track: PlayerTrack) => void
}) {
  const [artwork, setArtwork] = useState(album.hasArtwork)
  const firstPlayable = tracks.find(track => track.id)
  const artworkUrl = `/api/library/albums/${album.id}/artwork`

  return <section className={`album-detail-hero ${artwork ? 'has-artwork' : ''}`}>
    {artwork && <img className="album-detail-backdrop" src={artworkUrl} alt="" aria-hidden="true" onError={() => setArtwork(false)} />}
    <div className="album-detail-cover" aria-hidden="true">
      {artwork ? <img src={artworkUrl} alt="" onError={() => setArtwork(false)} /> : <Disc3 size={44} />}
    </div>
    <div className="album-detail-copy">
      <p>IN YOUR LIBRARY</p>
      <h1>{album.title}</h1>
      <strong>{album.albumArtist}</strong>
      <span>{[album.year, `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`].filter(Boolean).join(' · ')}</span>
      <div className="album-detail-actions">
        {firstPlayable?.id && <button className="button primary" onClick={() => playTrack({ ...firstPlayable, id: firstPlayable.id!, title: firstPlayable.title ?? 'Untitled track', albumId: album.id, album: album.title, albumArtist: album.albumArtist })}>
          <Play size={12} fill="currentColor" /> Play album
        </button>}
        <button className="button" onClick={close}><ArrowLeft size={13} /> Collection</button>
      </div>
    </div>
  </section>
}

function needleStatus(library: LibraryModel) {
  if (library.loading) return { label: 'indexing', className: 'degraded' }
  if (library.error) return { label: 'attention', className: 'offline' }
  if (!library.page?.configured || !library.page.mounted) return { label: 'setup needed', className: 'degraded' }
  return { label: 'library ready', className: 'available' }
}

function Sidebar({ view, setView, library, acquisitions }: {
  view: View
  setView: (view: View) => void
  library: LibraryModel
  acquisitions: AcquisitionsModel
}) {
  const status = needleStatus(library)
  const incoming = acquisitions.items.filter(item => !['completed', 'failed', 'cancelled'].includes(item.state)).length
  const openLibrarySection = (section: LibrarySection) => {
    setView('library')
    void library.browse(section)
  }
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><Cloud size={22} fill="currentColor" /></span>
        <span>needle<small>your music library</small></span>
      </div>
      <nav aria-label="Primary">
        <small>LIBRARY</small>
        <button title="Albums" className={view === 'library' && library.section === 'albums' ? 'active' : ''} onClick={() => openLibrarySection('albums')}>
          <Grid2X2 size={15} /><span>Albums</span>
        </button>
        <button title="Artists" className={view === 'library' && library.section === 'artists' ? 'active' : ''} onClick={() => openLibrarySection('artists')}>
          <UserRound size={15} /><span>Artists</span>
        </button>
        <button title="Songs" className={view === 'library' && library.section === 'songs' ? 'active' : ''} onClick={() => openLibrarySection('songs')}>
          <ListMusic size={15} /><span>Songs</span>
        </button>
        <small>LIBRARY FLOW</small>
        {acquisitions.configured && <button title="Incoming" className={view === 'wanted' ? 'active' : ''} onClick={() => setView('wanted')}>
          <Bookmark size={15} /><span>Incoming</span>{incoming > 0 && <em>{incoming}</em>}
        </button>}
        <button title="Inbox" className={view === 'imports' ? 'active' : ''} onClick={() => setView('imports')}>
          <PackageOpen size={15} /><span>Inbox</span>
        </button>
        <button title="History" className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}>
          <Activity size={15} /><span>History</span>
        </button>
      </nav>
      <div className={`connection ${status.className}`}>
        <span />
        <div><small>COLLECTION</small><strong>{status.label}</strong></div>
        <code>{library.page?.total ?? '—'} albums</code>
      </div>
    </aside>
  )
}

function HomeView({ beets, imports, acquisitions, library, setView, openJourney }: {
  beets: BeetsReadModel
  imports: BeetsImportOperationsModel
  acquisitions: AcquisitionsModel
  library: LibraryModel
  setView: (view: View) => void
  openJourney: (id: string) => void
}) {
  const stagedAlbums = beets.folders
    .flatMap(root => collectStagedAlbums(root))
    .filter(folder => {
      const state = currentFolderStatus(folder, beets.folderStatuses)
      return state !== 'imported' && state !== 'importing' && state !== 'deleting' && state !== 'deleted'
    })
  const uncertainImports = imports.items.filter(item => item.state === 'submission-unknown')
  const activeJourneys = acquisitions.items.filter(item => item.state !== 'completed' && item.state !== 'failed' && item.state !== 'cancelled')
  const recentlyCollected = imports.items
    .filter(item => item.state === 'library-confirmed')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 5)
  const refreshing = beets.loading || imports.loading || acquisitions.loading || library.loading

  function discover(event: FormEvent<HTMLFormElement>) {
    library.search(event)
    if (library.term.trim()) setView('library')
  }

  return (
    <section>
      <div className="page-heading">
        <div><p>00 / NEEDLE</p><h1>Your music, end to end</h1></div>
        <button className="button" disabled={refreshing} onClick={() => {
          void beets.refresh()
          void imports.refresh()
          void acquisitions.refresh()
          void library.refresh()
        }}>
          <RefreshCw size={13} className={refreshing ? 'spinning' : ''} /> Refresh
        </button>
      </div>

      <form className="search-form home-search" onSubmit={discover}>
        <Search size={17} />
        <input
          aria-label="Discover an album or artist"
          value={library.term}
          onChange={event => library.setTerm(event.target.value)}
          placeholder="discover an album or artist"
        />
        <button className="button primary" disabled={library.loading}>Discover</button>
      </form>

      {beets.error && <div className="error-strip">{beets.error}</div>}
      {imports.error && <div className="error-strip">{imports.error}</div>}
      {acquisitions.error && <div className="error-strip">{acquisitions.error}</div>}
      {library.error && <div className="error-strip">{library.error}</div>}

      <div className="home-grid">
        <section className="panel home-panel">
          <header><h2>Needs review</h2><span>{stagedAlbums.length + uncertainImports.length}</span></header>
          {uncertainImports.map(item => {
            const first = item.selections[0]
            return <button className="home-row attention" key={item.id} onClick={() => setView('activity')}>
              <Radio size={17} />
              <div><strong>{first?.album ?? 'Import outcome unknown'}</strong><small>Inspect before taking another action</small></div>
              <span className="state-tag selection-required">Attention</span>
            </button>
          })}
          {stagedAlbums.map(folder => {
            const state = currentFolderStatus(folder, beets.folderStatuses)
            return <button className="home-row" key={`${folder.providerPath}:${folder.hash}`} disabled={!folder.hash} onClick={() => {
              setView('imports')
              void beets.openFolder(folder)
            }}>
              <PackageOpen size={17} />
              <div><strong>{folder.name}</strong><small>{countFiles(folder)} files · choose metadata</small></div>
              <span className={`state-tag ${state ?? 'unknown'}`}>{state === 'previewed' ? 'ready' : 'review'}</span>
            </button>
          })}
          {!refreshing && !stagedAlbums.length && !uncertainImports.length && <p className="empty-row">Nothing needs your attention</p>}
          {refreshing && !stagedAlbums.length && !uncertainImports.length && <p className="empty-row">Checking staged music…</p>}
        </section>

        <section className="panel home-panel">
          <header><h2>In motion</h2><span>{activeJourneys.length}</span></header>
          {activeJourneys.map(item => {
            const activity = journeyActivity(item)
            return <button className="home-row" key={item.id} onClick={() => openJourney(item.id)}>
              <Disc3 size={17} />
              <div>
                <strong>{item.release}</strong>
                <small>{item.artist ? `${item.artist} · ${activity.detail}` : activity.detail}</small>
                {activity.percent !== undefined && <div className="meter compact"><i style={{ width: `${activity.percent}%` }} /></div>}
              </div>
              <span className={`state-tag ${activity.className}`}>{activity.label}</span>
            </button>
          })}
          {!acquisitions.loading && !activeJourneys.length && <p className="empty-row">No active journeys</p>}
          {acquisitions.loading && !activeJourneys.length && <p className="empty-row">Checking journeys…</p>}
        </section>

        <section className="panel home-panel recent">
          <header><h2>Recently collected</h2><span>{recentlyCollected.length}</span></header>
          {recentlyCollected.map(item => {
            const first = item.selections[0]
            return <button className="home-row" key={item.id} onClick={() => setView('library')}>
              <Check size={17} />
              <div><strong>{first?.album ?? item.providerPath.split('/').filter(Boolean).pop() ?? 'Collected release'}</strong><small>{first?.artist ?? `${first?.trackCount ?? 0} tracks`}</small></div>
              <span className="state-tag">In collection</span>
            </button>
          })}
          {!imports.loading && !recentlyCollected.length && <p className="empty-row">Newly verified music will appear here</p>}
          {imports.loading && !recentlyCollected.length && <p className="empty-row">Checking your collection…</p>}
        </section>
      </div>
    </section>
  )
}

function AcquisitionSetup({ acquisitions }: { acquisitions: AcquisitionsModel }) {
  if (acquisitions.ready) return <section className="panel acquisition-setup configured direct">
    <header><h2>Acquisition path</h2><span>Configured</span></header>
    <p>MusicBrainz catalog → Soulseek acquisition → beets review</p>
  </section>
  const message = acquisitions.loading ? 'Checking acquisition source' : acquisitions.sourceError ?? acquisitions.error ?? 'Acquisition source unavailable'
  return <div className="integration-state acquisition-setup">
    <Radio size={21} /><strong>{message}</strong>
    <small>Soulseek acquisition is not ready. Retry after checking the acquisition source.</small>
    {!acquisitions.loading && <button className="button" onClick={acquisitions.refresh}><RefreshCw size={13} /> Retry</button>}
  </div>
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

function formatReleaseDate(value?: string, fallbackYear?: number): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return fallbackYear?.toString() ?? 'Date unknown'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[Number(match[2]) - 1]
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : match[1]
}

function UnifiedReleaseCard({ item, library, acquisitions, libraryAvailable, playTrack }: {
  item: MusicRelease
  library: LibraryModel
  acquisitions: AcquisitionsModel
  libraryAvailable: boolean
  playTrack: (track: PlayerTrack) => void
}) {
  const album = item.libraryAlbum
  const release = item.catalogRelease
  const acquisition = item.acquisition ?? (release ? acquisitions.find(release) : undefined)
  const wanted = item.state === 'wanted' || acquisition?.state === 'wanted'

  if (album) {
    return <OwnedAlbumCard album={album} library={library} playTrack={playTrack} title={item.title} inLibrary />
  }

  return (
    <article className="album-card release-card missing" onPointerMove={tiltAlbumCard} onPointerLeave={resetAlbumCardTilt}>
      <div className="album-case"><i /></div>
      <strong>{item.title}</strong>
      <small>{item.artist}</small>
      <div className="release-details">
        <span>{release?.releaseType ?? 'Release'}</span>
        {release?.trackCount && <span>{release.trackCount} {release.trackCount === 1 ? 'track' : 'tracks'}</span>}
      </div>
      <div className="album-meta">
        <span>{formatReleaseDate(release?.releaseDate, item.year)}</span>
        {item.state === 'importing' ? <span className="release-state importing"><Radio size={9} /> Importing</span>
          : item.state === 'selection-required' ? <span className="release-state selection-required">Needs attention</span>
            : item.state === 'in-library' ? <span className="release-state present"><Check size={9} /> In library</span>
              : wanted && release ? <button
                className="want-button saved"
                disabled={acquisitions.savingRef !== null}
                onClick={() => acquisitions.wantRelease(release)}
              >
                {acquisitions.savingRef === providerRefKey(release.ref) ? 'Searching…' : <><RefreshCw size={10} /> Search again</>}
              </button>
                : wanted ? <span className="release-state wanted"><Check size={9} /> On the way</span>
          : !libraryAvailable ? <span className="release-state unknown">Library unknown</span>
            : release && acquisitions.configured ? <button
            className="want-button"
            disabled={acquisitions.savingRef !== null}
            onClick={() => acquisitions.wantRelease(release)}
          >
            {acquisitions.savingRef === providerRefKey(release.ref) ? 'Adding…' : <><Bookmark size={10} /> Add to library</>}
          </button>
            : <span className="release-state requestable">Available to add</span>}
      </div>
    </article>
  )
}

function ArtistCard({ artist, library }: { artist: LibraryArtist; library: LibraryModel }) {
  const [artwork, setArtwork] = useState(Boolean(artist.representativeAlbumId))
  return <button className="artist-card" onClick={() => library.searchFor(artist.name)}>
    <div className="artist-image">
      {artwork && artist.representativeAlbumId
        ? <img src={`/api/library/albums/${artist.representativeAlbumId}/artwork`} alt="" loading="lazy" onError={() => setArtwork(false)} />
        : <UserRound size={30} />}
    </div>
    <strong>{artist.name}</strong>
    <small>{artist.albumCount} {artist.albumCount === 1 ? 'album' : 'albums'}</small>
    <span className="artist-open"><Disc3 size={11} /> Open discography</span>
  </button>
}

function SongRow({ track, library, playTrack }: { track: LibraryTrack; library: LibraryModel; playTrack: (track: PlayerTrack) => void }) {
  const openAlbum = () => {
    if (!track.albumId) return
    void library.openAlbum({
      id: track.albumId,
      title: track.album ?? 'Unknown album',
      albumArtist: track.albumArtist ?? track.artists?.[0] ?? 'Unknown artist',
      hasArtwork: true,
    })
  }
  return <article className="song-row">
    <button className="song-play" title={`Play ${track.title ?? 'track'}`} disabled={!track.id} onClick={() => track.id && playTrack({ ...track, id: track.id, title: track.title ?? 'Untitled track' })}><Play size={12} fill="currentColor" /></button>
    <button className="song-copy" disabled={!track.albumId} onClick={openAlbum}><strong>{track.title ?? 'Untitled track'}</strong><small>{track.artists?.join(', ') || 'Unknown artist'}</small></button>
    <span>{track.album ?? 'Unknown album'}</span>
    <time>{formatDuration(track.durationSeconds)}</time>
  </article>
}

function groupSearchReleases(items: readonly MusicRelease[]) {
  const groups = [
    { type: 'album', label: 'Albums', items: [] as MusicRelease[] },
    { type: 'ep', label: 'EPs', items: [] as MusicRelease[] },
    { type: 'single', label: 'Singles', items: [] as MusicRelease[] },
    { type: 'other', label: 'Other releases', items: [] as MusicRelease[] },
  ]
  for (const item of items) {
    const type = item.libraryAlbum ? 'album' : item.catalogRelease?.releaseType?.trim().toLowerCase()
    const group = groups.find(candidate => candidate.type === type) ?? groups[3]
    group.items.push(item)
  }
  return groups.filter(group => group.items.length > 0)
}

function LibraryView({ library, acquisitions, playTrack }: { library: LibraryModel; acquisitions: AcquisitionsModel; playTrack: (track: PlayerTrack) => void }) {
  const page = library.page
  const currentPage = library.section === 'albums' ? page : library.section === 'artists' ? library.artistPage : library.songPage
  const unavailable = (library.error && !currentPage) || (currentPage && (!currentPage.configured || !currentPage.mounted))
  const album = library.selectedAlbum
  const searchResult = library.searchResult
  const releaseGroups = groupSearchReleases(searchResult?.items ?? [])
  const resultCount = (searchResult?.items.length ?? 0) + (searchResult?.artists.length ?? 0) + (searchResult?.tracks.length ?? 0)
  const browsingCollection = !album && !library.activeTerm
  const sectionDetails = library.section === 'albums'
    ? { title: 'Albums', description: 'The records, EPs, and releases on your shelves.', icon: <Grid2X2 size={18} /> }
    : library.section === 'artists'
      ? { title: 'Artists', description: 'The people and projects behind your collection.', icon: <UserRound size={18} /> }
      : { title: 'Songs', description: 'Every track in your library, ready to play.', icon: <ListMusic size={18} /> }

  return (
    <section>
      {album ? <AlbumDetailHero album={album} tracks={library.tracks} close={library.closeAlbum} playTrack={playTrack} /> : <div className={`page-heading ${browsingCollection ? 'library-heading' : ''}`}>
        {browsingCollection ? <>
          <div className="library-heading-lead">
            <span className="library-heading-icon">{sectionDetails.icon}</span>
            <div className="library-heading-copy">
              <p>YOUR LIBRARY</p>
              <h1>{sectionDetails.title}</h1>
              <span>{sectionDetails.description}</span>
            </div>
          </div>
          <div className="library-heading-actions">
            <div className="library-heading-count"><strong>{currentPage?.total ?? 0}</strong><span>{library.section}</span></div>
            <button className="button" onClick={library.refresh} disabled={library.loading}>
              <RefreshCw size={13} className={library.loading ? 'spinning' : ''} /> Refresh
            </button>
          </div>
        </> : <>
          <div>
            <p>YOUR LIBRARY + MUSIC CATALOG</p>
            <h1>{`Results for “${library.activeTerm}”`}</h1>
          </div>
          <button className="button" onClick={library.refresh} disabled={library.loading}>
            <RefreshCw size={13} className={library.loading ? 'spinning' : ''} /> Refresh
          </button>
        </>}
      </div>}
      {library.error && <div className="error-strip">{library.error}</div>}
      {acquisitions.error && <div className="error-strip">{acquisitions.error}</div>}
      {library.loading && !currentPage && !library.activeTerm
        ? <div className="idle-state"><Disc3 size={34} className="spinning" /><span>Reading your collection</span></div>
        : album ? <section className="panel library-panel">
            <header><h2>{album.albumArtist}</h2><span>{library.tracks.length} tracks</span></header>
            {library.tracks.map(track => (
              <article className="library-track-row" key={track.id ?? track.relativePath}>
                <button className="track-play" title={`Play ${track.title ?? 'track'}`} disabled={!track.id} onClick={() => track.id && playTrack({ ...track, id: track.id, title: track.title ?? 'Untitled track', albumId: album.id, album: album.title, albumArtist: album.albumArtist })}><Play size={11} fill="currentColor" /></button>
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
                aria-label="Search albums, artists, and songs"
                value={library.term}
                onChange={event => library.setTerm(event.target.value)}
                placeholder="search music"
              />
              {library.activeTerm && <button className="button" type="button" onClick={library.clearSearch}>Clear</button>}
              <button className="button primary" disabled={library.loading}>Search</button>
              <code>{library.activeTerm ? resultCount : currentPage?.total ?? 0} results</code>
            </form>
            {library.activeTerm ? <>
              {searchResult && sourceWarning(searchResult.sources) && <div className="source-strip">{sourceWarning(searchResult.sources)}</div>}
              {library.loading ? <div className="idle-state compact"><Disc3 size={28} className="spinning" /><span>Reading music index</span></div>
                : <div className="search-groups">
                  {releaseGroups.map(group => <section key={group.type}>
                    <header className="collection-heading"><h2>{group.label}</h2><span>{group.items.length}</span></header>
                    <div className="album-grid">{group.items.map(item => <UnifiedReleaseCard item={item} library={library} acquisitions={acquisitions} libraryAvailable={searchResult?.sources.library === 'available'} playTrack={playTrack} key={item.key} />)}</div>
                  </section>)}
                  {!!searchResult?.artists.length && <section><header className="collection-heading"><h2>Artists</h2><span>{searchResult.artists.length}</span></header><div className="artist-grid compact">{searchResult.artists.map(artist => <ArtistCard artist={artist} library={library} key={artist.name.toLowerCase()} />)}</div></section>}
                  {!!searchResult?.tracks.length && <section><header className="collection-heading"><h2>Songs</h2><span>{searchResult.tracks.length}</span></header><div className="panel song-list">{searchResult.tracks.map(track => <SongRow track={track} library={library} playTrack={playTrack} key={track.id ?? `${track.title}:${track.album}`} />)}</div></section>}
                </div>}
              {!library.loading && !resultCount && <div className="panel"><p className="empty-row">No artists, songs, or albums found</p></div>}
            </> : unavailable ? <div className="integration-state">
              <LibraryBig size={21} />
              <strong>{library.error || currentPage?.configured ? 'Collection unavailable' : 'Collection needs setup'}</strong>
              <small>{library.error || currentPage?.configured ? 'Needle cannot read your collection index right now. Check the Jellyfin connection.' : 'Connect your library index to browse music in Needle.'}</small>
              <button className="button" onClick={library.refresh}><RefreshCw size={13} /> Retry</button>
            </div> : library.loading ? <div className="idle-state compact"><Disc3 size={28} className="spinning" /><span>Reading {library.section}</span></div> : <>
              {library.section === 'albums' && <div className="album-grid">
                {page?.items.map(item => (
                  <OwnedAlbumCard album={item} library={library} playTrack={playTrack} key={item.id} />
                ))}
              </div>}
              {library.section === 'artists' && <div className="artist-grid">{library.artistPage?.items.map(artist => <ArtistCard artist={artist} library={library} key={artist.name.toLowerCase()} />)}</div>}
              {library.section === 'songs' && <div className="panel song-list">{library.songPage?.items.map(track => <SongRow track={track} library={library} playTrack={playTrack} key={track.id ?? `${track.title}:${track.album}`} />)}</div>}
              {!currentPage?.items.length && <div className="panel"><p className="empty-row">No {library.section} found</p></div>}
              {currentPage?.nextCursor && <footer className="library-footer">
                <button className="button" disabled={library.loadingMore} onClick={library.loadMore}>
                  {library.loadingMore ? 'Loading…' : `Load more ${library.section}`}
                </button>
              </footer>}
            </>}
          </>}
    </section>
  )
}

function NowPlayingView({ selection, audioRef, open, close }: { selection: PlaybackSelection; audioRef: React.RefObject<HTMLAudioElement | null>; open: boolean; close: () => void }) {
  const { track } = selection
  const [artwork, setArtwork] = useState(Boolean(track.albumId))
  useEffect(() => setArtwork(Boolean(track.albumId)), [track.albumId])
  return <section className={`now-playing-view ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Now playing visualizer">
    <Suspense fallback={null}><NowPlayingVisualizer audioRef={audioRef} selectionKey={selection.requestId} /></Suspense>
    <div className="now-playing-shade" />
    <button className="now-playing-close" type="button" onClick={close}><X size={16} /> Back to library</button>
    <div className="now-playing-specimen">
      <div className="now-playing-cover">
        {artwork && track.albumId ? <img src={`/api/library/albums/${track.albumId}/artwork`} alt="" onError={() => setArtwork(false)} /> : <Disc3 size={56} />}
      </div>
      <div className="now-playing-copy">
        <small>NOW PLAYING / AUDIO HABITAT</small>
        <h1>{track.title}</h1>
        <p>{track.artists?.join(', ') || track.albumArtist || 'Unknown artist'}</p>
        <span>{track.album}</span>
      </div>
    </div>
    <div className="now-playing-telemetry" aria-hidden="true"><span>LIVE SIGNAL</span><span>FREQUENCY ECOLOGY</span></div>
  </section>
}

function PlayerBar({ selection, audioRef, close, playNext, openNowPlaying }: { selection: PlaybackSelection; audioRef: React.RefObject<HTMLAudioElement | null>; close: () => void; playNext: () => void; openNowPlaying: () => void }) {
  const { track } = selection
  const [failed, setFailed] = useState(false)
  const [artwork, setArtwork] = useState(Boolean(track.albumId))
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  useEffect(() => {
    setFailed(false); setArtwork(Boolean(track.albumId)); setPlaying(false); setLoading(true); setCurrentTime(0); setDuration(0)
  }, [selection.requestId, track.id, track.albumId])
  const trackArtist = track.artists?.join(', ') || track.albumArtist || ''
  const artworkUrl = track.albumId ? new URL(`/api/library/albums/${track.albumId}/artwork`, window.location.href).href : undefined
  useEffect(() => {
    if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) return
    const mediaSession = navigator.mediaSession
    mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: trackArtist,
      album: track.album || '',
      ...(artworkUrl ? { artwork: [{ src: artworkUrl }] } : {}),
    })
    const setAction = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { mediaSession.setActionHandler(action, handler) } catch { /* unsupported by this browser */ }
    }
    setAction('play', () => { void audioRef.current?.play() })
    setAction('pause', () => audioRef.current?.pause())
    setAction('seekbackward', details => {
      const audio = audioRef.current
      if (audio) audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset ?? 10))
    })
    setAction('seekforward', details => {
      const audio = audioRef.current
      if (audio) audio.currentTime = Math.min(Number.isFinite(audio.duration) ? audio.duration : Infinity, audio.currentTime + (details.seekOffset ?? 10))
    })
    setAction('seekto', details => {
      const audio = audioRef.current
      if (!audio || details.seekTime === undefined) return
      if (details.fastSeek && 'fastSeek' in audio) audio.fastSeek(details.seekTime)
      else audio.currentTime = details.seekTime
    })
    setAction('stop', () => {
      const audio = audioRef.current
      if (!audio) return
      audio.pause(); audio.currentTime = 0
    })
    setAction('nexttrack', playNext)
    return () => {
      for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'stop', 'nexttrack'] as const) setAction(action, null)
      mediaSession.metadata = null
      mediaSession.playbackState = 'none'
    }
  }, [selection.requestId, track.title, trackArtist, track.album, artworkUrl, playNext])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    if (!('setPositionState' in navigator.mediaSession) || !Number.isFinite(duration) || duration <= 0) return
    try {
      navigator.mediaSession.setPositionState({ duration, playbackRate: audioRef.current?.playbackRate ?? 1, position: Math.min(Math.max(0, currentTime), duration) })
    } catch { /* transient metadata state; the next audio event will retry */ }
  }, [playing, currentTime, duration])

  const formatPlaybackTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) return '0:00'
    const wholeSeconds = Math.max(0, Math.floor(seconds))
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`
  }
  const togglePlayback = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => {
      if (audioRef.current !== audio) return
      setPlaying(false)
      setLoading(false)
    })
    else audio.pause()
  }
  const seek = (value: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = value
    setCurrentTime(value)
  }
  const changeVolume = (value: number) => {
    if (!audioRef.current) return
    audioRef.current.volume = value
    audioRef.current.muted = false
    setVolume(value); setMuted(false)
  }
  const toggleMute = () => {
    if (!audioRef.current) return
    audioRef.current.muted = !audioRef.current.muted
    setMuted(audioRef.current.muted)
  }
  return <section className={`player-bar ${artwork ? 'has-artwork' : ''}`} aria-label="Now playing">
    {artwork && track.albumId && <img className="player-backdrop" src={`/api/library/albums/${track.albumId}/artwork`} alt="" aria-hidden="true" onError={() => setArtwork(false)} />}
    <button className="player-art" type="button" onClick={openNowPlaying} aria-label="Open Now Playing visualizer">
      {artwork && track.albumId ? <img src={`/api/library/albums/${track.albumId}/artwork`} alt="" onError={() => setArtwork(false)} /> : <Disc3 size={19} />}
    </button>
    <button className="player-copy" type="button" onClick={openNowPlaying}><small aria-live="polite">{failed ? 'PLAYBACK UNAVAILABLE' : loading ? 'LOADING AUDIO' : playing ? 'NOW PLAYING' : 'PLAYBACK PAUSED'}</small><strong>{track.title}</strong><span>{[track.artists?.join(', '), track.album].filter(Boolean).join(' · ')}</span></button>
    <div className="player-controls">
      <button className="player-control player-play" type="button" aria-label={playing ? 'Pause' : 'Play'} disabled={failed} onClick={togglePlayback}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
      <time>{formatPlaybackTime(currentTime)}</time>
      <input className="player-progress" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} disabled={!duration || failed} aria-label="Seek through track" onChange={event => seek(Number(event.currentTarget.value))} />
      <time>{formatPlaybackTime(duration)}</time>
      <button className="player-control" type="button" aria-label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>{muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
      <input className="player-volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label="Volume" onChange={event => changeVolume(Number(event.currentTarget.value))} />
    </div>
    <audio ref={audioRef} key={selection.requestId} autoPlay preload="metadata" src={`/api/library/songs/${track.id}/stream`} onLoadStart={() => setLoading(true)} onLoadedMetadata={event => { event.currentTarget.volume = volume; event.currentTarget.muted = muted }} onWaiting={() => setLoading(true)} onCanPlay={() => setLoading(false)} onPlaying={() => { setPlaying(true); setLoading(false) }} onPause={() => setPlaying(false)} onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)} onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onVolumeChange={event => { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted) }} onEnded={playNext} onError={() => { setFailed(true); setLoading(false); setPlaying(false) }} />
    <button className="player-close" type="button" aria-label="Close player" title="Close player" onClick={close}><X size={14} /></button>
  </section>
}

function ActivityView({ acquisitions, imports, openJourney, sectionNumber }: { acquisitions: AcquisitionsModel; imports: BeetsImportOperationsModel; openJourney: (id: string) => void; sectionNumber: string }) {
  const refreshing = acquisitions.loading || imports.loading
  const journeys = [...acquisitions.items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))

  return (
    <section>
      <div className="page-heading">
        <div><p>{sectionNumber} / RECENT LIBRARY ACTIVITY</p><h1>History</h1></div>
        <button className="button" onClick={() => { void acquisitions.refresh(); void imports.refresh() }} disabled={refreshing}>
          <RefreshCw size={13} className={refreshing ? 'spinning' : ''} /> Refresh
        </button>
      </div>

      <AcquisitionSetup acquisitions={acquisitions} />
      {imports.error && <div className="error-strip">{imports.error}</div>}
      <div className="activity-grid">
        <section className="panel history-panel">
          <header><h2>Journey history</h2><span>{journeys.length}</span></header>
          {journeys.length ? journeys.map(item => {
            const activity = journeyActivity(item)
            return <button className="history-row journey-history-row" onClick={() => openJourney(item.id)} key={item.id}>
              <span className={`state-tag ${activity.className}`}>{activity.label}</span>
              <div><strong>{item.release}</strong><small>{[item.artist, activity.detail].filter(Boolean).join(' · ')}</small></div>
              <time>{new Date(item.updatedAt).toLocaleString()}</time>
            </button>
          }) : <p className="empty-row">No release journeys yet</p>}
        </section>
        <section className="panel import-history-panel">
          <header><h2>Library commits</h2><span>{imports.items.length}</span></header>
          {!imports.configured && !imports.loading ? <p className="empty-row">Needle database persistence is not configured</p>
            : imports.items.length ? imports.items.map(item => <ImportOperationRow item={item} key={item.id} />)
              : <p className="empty-row">No library commits yet</p>}
        </section>
      </div>
    </section>
  )
}

function ImportOperationRow({ item }: { item: BeetsImportOperation }) {
  const first = item.selections[0]
  const title = first?.album ?? item.providerPath.split('/').filter(Boolean).pop() ?? 'Music import'
  const detail = [first?.artist, item.selections.length > 1 ? `${item.selections.length} reviewed tasks` : `${first?.trackCount ?? 0} tracks`, item.acquisitionId ? 'Linked journey' : 'No wanted release'].filter(Boolean).join(' · ')
  const labels: Record<BeetsImportOperationState, string> = {
    submitting: 'submission pending',
    submitted: 'import queued',
    'submission-unknown': 'outcome unknown',
    'provider-completed': 'verifying collection',
    'library-confirmed': 'in collection',
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
        <div><p>INBOX / READY TO REVIEW</p><h1>Inbox</h1></div>
        <button className="button" onClick={beets.refresh} disabled={beets.loading}>
          <RefreshCw size={13} className={beets.loading ? 'spinning' : ''} /> Refresh
        </button>
      </div>
      {!available ? <div className="integration-state">
        <PackageOpen size={21} />
        <strong>{beets.loading ? 'Reading the staging area' : beets.error ?? (!beets.status?.configured ? 'Import review needs setup' : 'Import review unavailable')}</strong>
        <small>{!beets.status?.configured ? 'Connect beets-flask to review and import staged music.' : 'Needle cannot read staged music right now. Check the beets-flask connection.'}</small>
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
                <div><strong>{entry.name}</strong><small>{inbox?.name ?? 'Staging inbox'} · {countFiles(entry)} files</small></div>
                <span className={`state-tag ${status ?? 'unknown'}`}>{(status ?? 'untracked').replace('-', ' ')}</span>
              </button>
            )
          }) : <p className="empty-row">No staged albums detected</p>}
        </section>
      </>}
    </section>
  )
}

function acquisitionOptionLabel(item: AcquisitionJob): string {
  const title = `${item.artist ? `${item.artist} — ` : ''}${item.release ?? item.id}`
  const details = [
    item.releaseType,
    item.trackCount ? `${item.trackCount} ${item.trackCount === 1 ? 'track' : 'tracks'}` : undefined,
    item.releaseDate ? formatReleaseDate(item.releaseDate) : undefined,
    item.musicBrainzReleaseGroupId ? `RG ${item.musicBrainzReleaseGroupId.slice(0, 8)}` : undefined,
  ].filter(Boolean)
  return details.length ? `${title} · ${details.join(' · ')}` : title
}

function candidateComparisons(task: BeetsPreviewTask, candidate: BeetsPreviewCandidate) {
  const comparisons = [
    { label: 'Album', current: task.currentMetadata.album ?? 'Unknown', proposed: candidate.album ?? 'Unknown' },
    { label: 'Artist', current: task.currentMetadata.artist ?? 'Unknown', proposed: candidate.artist ?? 'Unknown' },
    { label: 'Year', current: task.currentMetadata.year?.toString() ?? 'Unknown', proposed: candidate.year?.toString() ?? 'Unknown' },
    { label: 'Tracks', current: task.items.length.toString(), proposed: candidate.trackCount.toString() },
  ]
  return comparisons.map(comparison => ({
    ...comparison,
    changed: comparison.current.trim().toLocaleLowerCase() !== comparison.proposed.trim().toLocaleLowerCase(),
  }))
}

function penaltyLabel(penalty: string): string {
  const labels: Record<string, string> = {
    album: 'Album title differs',
    artist: 'Artist differs',
    year: 'Release year differs',
    tracks: 'Track matching required',
    track_title: 'Track titles differ',
    track_artist: 'Track artists differ',
    track_length: 'Track durations differ',
    extra_items: 'Track count differs',
    missing_items: 'Track count differs',
  }
  return labels[penalty] ?? penalty.replaceAll('_', ' ')
}

function trackMatchDetail(item: BeetsPreviewTask['items'][number], index: number, candidate: BeetsPreviewCandidate | undefined) {
  if (!candidate) return undefined
  const mappedIndex = candidate.trackMapping[String(index)] ?? (candidate.kind === 'as-is' ? index : undefined)
  const match = mappedIndex === undefined ? undefined : candidate.tracks[mappedIndex]
  if (!match) return { className: 'missing', label: 'Not in release' }
  const currentTitle = item.title?.trim().toLocaleLowerCase()
  const matchedTitle = match.title?.trim().toLocaleLowerCase()
  const titleMatches = Boolean(currentTitle && matchedTitle && currentTitle === matchedTitle)
  const durationDelta = item.length !== undefined && match.length !== undefined ? Math.round(match.length - item.length) : undefined
  if (titleMatches && (durationDelta === undefined || Math.abs(durationDelta) <= 2)) {
    return { className: 'match', label: 'Matches' }
  }
  if (!titleMatches && match.title) return { className: 'changed', label: `Matches “${match.title}”` }
  return { className: 'changed', label: durationDelta === undefined ? 'Metadata differs' : `${durationDelta > 0 ? '+' : ''}${durationDelta}s duration` }
}

function ImportReview({ beets, folder }: { beets: BeetsReadModel; folder: BeetsInboxEntry }) {
  const session = beets.preview
  const allSelected = Boolean(session?.tasks.length) && session!.tasks.every(task => beets.selectedCandidates[task.id])
  const busy = beets.workflowState === 'previewing' || beets.workflowState === 'importing'
  const locked = busy || beets.workflowState === 'completed' || beets.workflowState === 'provider-imported'

  return (
    <section>
      <div className="page-heading">
        <div><p>02 / IMPORT REVIEW</p><h1>{folder.name}</h1></div>
        <button className="button" onClick={beets.closeFolder} disabled={busy}><ArrowLeft size={13} /> Review</button>
      </div>
      {beets.error && <div className="error-strip">{beets.error}</div>}
      {beets.workflowState === 'previewing' && <div className="idle-state compact">
        <Disc3 size={28} className="spinning" /><span>Preparing metadata choices</span>
      </div>}
      {beets.workflowState === 'submission-unknown' && !session && <div className="integration-state">
        <Radio size={21} />
        <strong>Preview submission outcome unknown</strong>
        <small>Do not retry. Return to Review and refresh the beets-flask status before taking another action.</small>
        <button className="button" onClick={beets.closeFolder}><ArrowLeft size={13} /> Review</button>
      </div>}
      {session && <div className="preview-layout">
        {session.tasks.map((task, taskIndex) => {
          const selectedCandidate = task.candidates.find(candidate => candidate.id === beets.selectedCandidates[task.id])
          return <section className="panel preview-task" key={task.id}>
            <header><h2>{task.currentMetadata.album ?? `Album group ${taskIndex + 1}`}</h2><span>{task.items.length} tracks</span></header>
            <div className="candidate-list">
              {task.candidates.map(candidate => {
                const active = beets.selectedCandidates[task.id] === candidate.id
                const comparisons = candidateComparisons(task, candidate)
                const details = [
                  candidate.country,
                  candidate.label,
                  candidate.catalogNumber,
                  candidate.media && `${candidate.mediumCount ?? 1} × ${candidate.media}`,
                ].filter(Boolean)
                return <button
                  className={`candidate-card ${active ? 'selected' : ''}`}
                  key={candidate.id}
                  onClick={() => beets.selectCandidate(task.id, candidate.id)}
                  disabled={locked}
                >
                  <span className="candidate-radio">{active && <Check size={11} />}</span>
                  <div>
                    <div className="candidate-heading">
                      <strong>{candidate.kind === 'as-is' ? 'Keep current metadata' : candidate.album ?? 'Untitled candidate'}</strong>
                      <b>{candidate.kind === 'as-is' ? 'Unchanged' : `${Math.max(0, (1 - candidate.distance) * 100).toFixed(1)}% match`}</b>
                    </div>
                    <small>{candidate.kind === 'as-is' ? `${task.currentMetadata.artist ?? 'Unknown artist'} · as downloaded` : [candidate.artist, candidate.year, candidate.source].filter(Boolean).join(' · ')}</small>
                    {candidate.kind === 'candidate' && <dl className="candidate-comparison">
                      {comparisons.map(comparison => <div className={comparison.changed ? 'changed' : 'same'} key={comparison.label}>
                        <dt>{comparison.label}</dt>
                        <dd>{comparison.changed ? <><span>{comparison.current}</span><i>→</i><strong>{comparison.proposed}</strong></> : <><Check size={9} /><strong>{comparison.proposed}</strong></>}</dd>
                      </div>)}
                    </dl>}
                    {details.length > 0 && <small className="candidate-edition">{details.join(' · ')}</small>}
                    <code>{candidate.trackCount} tracks · distance {candidate.distance.toFixed(3)}{candidate.duplicateCount ? ` · ${candidate.duplicateCount} duplicate${candidate.duplicateCount === 1 ? '' : 's'}` : ''}</code>
                    {candidate.penalties.length > 0 && <div className="candidate-penalties">{[...new Set(candidate.penalties.map(penaltyLabel))].map(label => <em key={label}>{label}</em>)}</div>}
                  </div>
                </button>
              })}
            </div>
            <div className="preview-tracks">
              {task.items.map((item, index) => {
                const match = trackMatchDetail(item, index, selectedCandidate)
                return <div key={`${item.title}:${index}`}>
                <b>{index + 1}</b><span><strong>{item.title ?? 'Untitled track'}</strong><small>{item.artist ?? item.format ?? 'Audio'}</small></span>
                {match && <em className={`track-match ${match.className}`}>{match.label}</em>}
                <code>{formatDuration(item.length)}</code>
                </div>
              })}
            </div>
            <label className="duplicate-policy">
              If this album duplicates library metadata
              <select value={beets.duplicateActions[task.id] ?? 'skip'} onChange={event => beets.setDuplicateAction(task.id, event.target.value as 'skip' | 'keep')} disabled={locked}>
                <option value="skip">Skip the duplicate</option>
                <option value="keep">Keep both copies</option>
              </select>
            </label>
          </section>
        })}
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
              {beets.linkableAcquisitions.map(item => <option value={item.id} key={item.id}>{acquisitionOptionLabel(item)}</option>)}
            </select>
          </label>
          <p className="lifecycle-note">Needle cannot safely infer this association from metadata alone. A selected journey moves to importing now and completes only after collection verification.</p>
        </section>
        <section className="import-approval panel">
          {beets.workflowState === 'completed' ? <div className="completion-message"><Check size={18} /><strong>Import complete</strong><small>Needle is waiting to verify this release in your collection.</small></div>
            : beets.workflowState === 'provider-imported' ? <div className="completion-message"><Check size={18} /><strong>Previously imported</strong><small>This import predates Needle's review record, so its metadata choices cannot be verified.</small></div>
            : beets.workflowState === 'submission-unknown' ? <div className="completion-message unknown"><Radio size={18} /><strong>Submission outcome unknown</strong><small>Do not retry. Return to Review and inspect the beets-flask status before taking another action.</small></div> : <>
            <label>
              <input type="checkbox" checked={beets.approved} onChange={event => beets.setApproved(event.target.checked)} disabled={busy || !allSelected || !beets.decisionValid} />
              <span><strong>I approve these choices</strong><small>Needle will apply the selected metadata and duplicate policy. A skipped duplicate may complete without adding another collection copy. Staging files are retained.</small></span>
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

function useJourneyDetail(id: string) {
  const [detail, setDetail] = useState<JourneyDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const activeRequest = useRef(0)

  const refresh = useCallback(async (signal?: AbortSignal, background = false) => {
    const request = ++activeRequest.current
    if (!background) setLoading(true)
    try {
      const next = await getJson<JourneyDetailResponse>(`/api/journeys/${encodeURIComponent(id)}`, signal)
      if (request !== activeRequest.current || signal?.aborted) return
      setDetail(next)
      setError(null)
    } catch (requestError) {
      if (request === activeRequest.current && !isAbortError(requestError)) setError(errorMessage(requestError))
    } finally {
      if (request === activeRequest.current && !signal?.aborted) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const poll = async (background: boolean) => {
      await refresh(controller.signal, background)
      if (!controller.signal.aborted) timer = window.setTimeout(() => { void poll(true) }, 7_500)
    }
    void poll(false)
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [refresh])

  return { detail, error, loading, refresh: () => refresh() }
}

function DirectCandidateReview({ response, error, busy, onSelect, onRetry }: { response: DirectCandidatesResponse | null; error: string | null; busy: boolean; onSelect: (id: string) => void; onRetry: () => void }) {
  if (!response) return <section className="panel direct-review"><header><h2>Candidate review</h2><span>Searching</span></header><p className="empty-row">{error ?? 'Loading ranked Soulseek candidates…'}</p></section>
  const workflow = response.workflow
  return <section className="panel direct-review">
    <header><h2>Ranked Soulseek candidates</h2><span>{response.candidates.length}</span></header>
    {error && <div className="error-strip">{error}</div>}
    {workflow.submissionState === 'submission-unknown' && <div className="journey-attention"><Radio size={14} /><strong>Transfer submission outcome unknown — do not retry or select again.</strong></div>}
    {workflow.submissionState === 'submitted' && workflow.error && <div className="direct-review-empty"><span>{workflow.error}</span><button className="button" disabled={busy} onClick={onRetry}><RefreshCw size={12} /> Retry transfer</button></div>}
    {!response.candidates.length && workflow.submissionState === 'none' && <div className="direct-review-empty"><span>{workflow.error ?? 'No candidates found.'}</span><button className="button" disabled={busy} onClick={onRetry}><RefreshCw size={12} /> Retry Search</button></div>}
    {!!response.candidates.length && workflow.error && workflow.submissionState === 'none' && <div className="direct-review-empty"><span>{workflow.error}</span><button className="button" disabled={busy} onClick={onRetry}><RefreshCw size={12} /> Retry Search</button></div>}
    <div className="direct-candidates">{response.candidates.slice(0, 8).map((candidate, rank) => {
      const match = candidate.matches[0]
      const edition = workflow.editions.find(item => item.id === match?.editionId)
      const formats = [...new Set(candidate.audioFiles.map(file => file.extension.toUpperCase()))].join(', ')
      const size = candidate.audioFiles.reduce((sum, file) => sum + file.size, 0)
      return <article className={match?.rejected ? 'rejected' : ''} key={candidate.id}>
        <header><div><b>#{rank + 1} · {candidate.peer}</b><code>{candidate.path}</code></div><strong>{match?.score ?? candidate.score}%</strong></header>
        <p>{[edition?.title, edition?.date, edition?.country, edition?.label, edition?.catalogNumber].filter(Boolean).join(' · ') || 'Unmatched edition'}</p>
        <dl><div><dt>Audio / expected</dt><dd>{candidate.audioFiles.length} / {edition?.tracks.length ?? '?'}</dd></div><div><dt>Mapped</dt><dd>{match?.mappedTracks ?? 0}</dd></div><div><dt>Missing / extra</dt><dd>{match?.missingTracks ?? 0} / {match?.extraTracks ?? 0}</dd></div><div><dt>Format / size</dt><dd>{formats || '—'} · {formatBytes(size)}</dd></div></dl>
        <div className="candidate-penalties">{match?.reasons.slice(0, 8).map(reason => <em key={reason}>{reason}</em>)}</div>
        <details><summary>{candidate.audioFiles.length} audio files{candidate.metadataFiles.length ? ` · ${candidate.metadataFiles.length} other` : ''}</summary>{candidate.audioFiles.slice(0, 20).map(file => <div className="direct-file" key={`${file.path}:${file.size}`}><span>{file.name}</span><code>{formatBytes(file.size)}</code></div>)}{candidate.audioFiles.length > 20 && <small>+ {candidate.audioFiles.length - 20} more files</small>}</details>
        <button className="button primary" disabled={busy || !!match?.rejected || workflow.submissionState !== 'none'} onClick={() => onSelect(candidate.id)}>{workflow.selectedCandidateId === candidate.id ? 'Selected' : match?.rejected ? 'Rejected' : 'Select candidate'}</button>
      </article>
    })}</div>
  </section>
}

function JourneyDetailView({ id, beets, library, setView, close }: {
  id: string
  beets: BeetsReadModel
  library: LibraryModel
  setView: (view: View) => void
  close: () => void
}) {
  const model = useJourneyDetail(id)
  const detail = model.detail
  const [candidates, setCandidates] = useState<DirectCandidatesResponse | null>(null)
  const [candidateError, setCandidateError] = useState<string | null>(null)
  const [candidateBusy, setCandidateBusy] = useState(false)
  const needsCandidates = !!detail && (detail.job.state === 'selection-required' || detail.job.state === 'failed' || (detail.stage === 'attention' && !detail.importOperation))
  const loadCandidates = useCallback(async () => {
    try { setCandidates(await getJson<DirectCandidatesResponse>(`/api/acquisitions/${encodeURIComponent(id)}/candidates`)); setCandidateError(null) }
    catch (error) { setCandidateError(errorMessage(error)) }
  }, [id])
  useEffect(() => { if (needsCandidates) void loadCandidates() }, [needsCandidates, loadCandidates])
  async function candidateAction(path: string) {
    setCandidateBusy(true); setCandidateError(null)
    try { await postJson(path, {}); await Promise.all([loadCandidates(), model.refresh()]) }
    catch (error) { setCandidateError(errorMessage(error)) }
    finally { setCandidateBusy(false) }
  }
  const stages = [
    { id: 'requested', label: 'Requested' },
    { id: 'downloading', label: 'Download' },
    { id: 'review', label: 'Review' },
    { id: 'importing', label: 'Import' },
    { id: 'verifying', label: 'Verify' },
    { id: 'collected', label: 'Collected' },
  ] as const
  const stageIndex = detail?.stage === 'queued' || detail?.stage === 'downloading' ? 1
    : detail?.stage === 'attention' ? Math.max(0, detail.nextAction ? 2 : detail.importOperation ? 3 : 0)
    : Math.max(0, stages.findIndex(stage => stage.id === detail?.stage))
  const transferPercent = detail?.progress?.bytesTotal ? detail.progress.percent : detail?.progress?.expectedFiles
    ? Math.round((detail.progress.completedFiles ?? 0) / detail.progress.expectedFiles * 100)
    : detail?.progress?.percent

  return <section>
    <div className="page-heading">
      <div><p>03 / RELEASE JOURNEY</p><h1>{detail?.job.release ?? 'Journey'}</h1></div>
      <button className="button" onClick={close}><ArrowLeft size={13} /> Incoming</button>
    </div>
    {model.error && <div className="error-strip">{model.error}</div>}
    {!detail && model.loading ? <div className="idle-state"><Disc3 size={34} className="spinning" /><span>Reading release journey</span></div> : detail && <>
      <section className={`journey-hero panel ${detail.stage}`}>
        <header><h2>{detail.job.artist ?? 'Release journey'}</h2><span>{detail.stage.replace('-', ' ')}</span></header>
        <div className="journey-stage-rail">
          {stages.map((stage, index) => <div className={index < stageIndex ? 'done' : index === stageIndex ? 'active' : ''} key={stage.id}>
            <i>{index < stageIndex ? <Check size={10} /> : index + 1}</i><span>{stage.label}</span>
          </div>)}
        </div>
        {detail.stage === 'attention' && <div className="journey-attention"><Radio size={16} /><strong>This journey needs attention</strong></div>}
        {detail.progress && (detail.progress.percent !== undefined || detail.progress.expectedFiles !== undefined) && <div className="journey-transfer">
          <div><strong>{detail.progress.bytesTotal ? `${detail.progress.percent ?? 0}% downloaded` : `${detail.progress.completedFiles ?? 0} of ${detail.progress.expectedFiles ?? '?'} files`}</strong><span>{detail.progress.bytesTotal ? `${formatBytes(detail.progress.bytesRemaining)} remaining of ${formatBytes(detail.progress.bytesTotal)}` : 'File transfer progress'}</span></div>
          <div className="meter"><i style={{ width: `${transferPercent ?? 0}%` }} /></div>
        </div>}
        <div className="journey-actions">
          {detail.nextAction?.kind === 'review' && <button className="button primary" disabled={beets.workflowState === 'previewing' || beets.workflowState === 'importing'} onClick={() => {
            if (beets.openFolder(detail.nextAction!.folder, detail.job.id)) setView('imports')
          }}><PackageOpen size={13} /> {beets.workflowState === 'previewing' || beets.workflowState === 'importing' ? 'Review busy' : 'Review metadata'}</button>}
          {detail.stage === 'collected' && <button className="button primary" onClick={() => {
            const album = library.page?.items.find(item => detail.libraryAlbumIds.includes(item.id))
            setView('library')
            if (album) void library.openAlbum(album)
          }}><LibraryBig size={13} /> Open Collection</button>}
          {detail.stage === 'attention' && <button className="button" onClick={() => setView('activity')}><Radio size={13} /> View activity</button>}
          {!detail.nextAction && detail.stage === 'review' && <span>Downloaded music is waiting to be matched with one staged folder.</span>}
        </div>
      </section>

      {needsCandidates && <DirectCandidateReview response={candidates} error={candidateError} busy={candidateBusy} onSelect={candidateId => candidateAction(`/api/acquisitions/${encodeURIComponent(id)}/candidates/${encodeURIComponent(candidateId)}/select`)} onRetry={() => candidateAction(`/api/acquisitions/${encodeURIComponent(id)}/retry`)} />}

      {(detail.sources.download !== 'available' || detail.sources.review !== 'available') && <div className="source-strip">
        {detail.sources.download !== 'available' ? `Download activity ${detail.sources.download}` : ''}
        {detail.sources.download !== 'available' && detail.sources.review !== 'available' ? ' · ' : ''}
        {detail.sources.review !== 'available' ? `Review inbox ${detail.sources.review}` : ''}
      </div>}

      <section className="panel journey-events">
        <header><h2>Journey timeline</h2><span>{detail.events.length}</span></header>
        {detail.events.map((event, index) => <article key={`${event.kind}:${event.occurredAt}:${index}`}>
          <i />
          <div><strong>{event.label}</strong>{event.detail && <small>{event.detail}</small>}</div>
          <time>{new Date(event.occurredAt).toLocaleString()}</time>
        </article>)}
      </section>
    </>}
  </section>
}

function WantedView({ acquisitions, selectedJourneyId, openJourney, closeJourney, beets, library, setView }: {
  acquisitions: AcquisitionsModel
  selectedJourneyId: string | null
  openJourney: (id: string) => void
  closeJourney: () => void
  beets: BeetsReadModel
  library: LibraryModel
  setView: (view: View) => void
}) {
  if (selectedJourneyId) return <JourneyDetailView id={selectedJourneyId} beets={beets} library={library} setView={setView} close={closeJourney} />
  const refreshing = acquisitions.loading
  return (
    <section>
      <div className="page-heading">
        <div><p>INCOMING / ON THE WAY TO YOUR LIBRARY</p><h1>Incoming</h1></div>
        <button className="button" onClick={() => { void acquisitions.refresh() }} disabled={refreshing}>
          <RefreshCw size={13} className={refreshing ? 'spinning' : ''} /> Refresh
        </button>
      </div>
      {acquisitions.error && <div className="error-strip">{acquisitions.error}</div>}
      <AcquisitionSetup acquisitions={acquisitions} />
      <section className="panel wanted-panel">
        <header><h2>Release progress</h2><span>{acquisitions.items.length}</span></header>
        {acquisitions.items.length ? acquisitions.items.map(item => {
          const activity = journeyActivity(item)
          return <button className="wanted-row" key={item.id} onClick={() => openJourney(item.id)}>
            <div className="media-object case"><i /></div>
            <div>
              <strong>{item.release}</strong>
              <small>{item.artist ? `${item.artist} · ${activity.detail}` : activity.detail}</small>
              {activity.percent !== undefined && <div className="meter compact"><i style={{ width: `${activity.percent}%` }} /></div>}
            </div>
            <span className={`state-tag ${activity.className}`}>{activity.label}</span>
            <time>{new Date(item.createdAt).toLocaleString()}</time>
          </button>
        }) : <p className="empty-row">No release journeys yet</p>}
      </section>
    </section>
  )
}

function App() {
  const [view, setView] = useState<View>('library')
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null)
  const [playback, setPlayback] = useState<PlaybackSelection | null>(null)
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)
  const playbackRequest = useRef(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const albumQueues = useRef(new Map<string, Promise<PlayerTrack[]>>())
  const acquisitions = useAcquisitions()
  const importOperations = useBeetsImportOperations(acquisitions.refresh)
  const beets = useBeetsReadModel(acquisitions.items, acquisitions.refresh)
  const library = useLibrary()
  const navigate = (next: View) => {
    if (next !== 'library') library.cancelPending()
    setSelectedJourneyId(null)
    setView(next)
  }
  const openJourney = (id: string) => {
    setSelectedJourneyId(id)
    setView('wanted')
  }
  const activeActivity = acquisitions.items.filter(item => !['completed', 'failed', 'cancelled'].includes(item.state)).length
  const playTrack = (track: PlayerTrack) => {
    setPlayback({ track, requestId: ++playbackRequest.current })
    if (track.albumId) void albumQueue(track.albumId, track)
  }
  const albumQueue = (albumId: string, seed: PlayerTrack) => {
    const existing = albumQueues.current.get(albumId)
    if (existing) return existing
    const pending = (async () => {
      const tracks: PlayerTrack[] = []
      let cursor: string | undefined
      do {
        const query = new URLSearchParams({ limit: '100' })
        if (cursor) query.set('cursor', cursor)
        const page = await getJson<LibraryPage<LibraryTrack>>(`/api/library/albums/${albumId}/tracks?${query}`)
        tracks.push(...page.items.flatMap(item => item.id ? [{
          ...item,
          id: item.id,
          title: item.title ?? 'Untitled track',
          albumId,
          album: item.album ?? seed.album,
          albumArtist: item.albumArtist ?? seed.albumArtist,
        }] : []))
        cursor = page.nextCursor
      } while (cursor)
      return tracks
    })()
    albumQueues.current.set(albumId, pending)
    void pending.catch(() => albumQueues.current.delete(albumId))
    return pending
  }
  const playNext = async () => {
    const current = playback
    if (!current?.track.albumId) return
    try {
      const queue = await albumQueue(current.track.albumId, current.track)
      const currentIndex = queue.findIndex(track => track.id === current.track.id)
      const next = queue[currentIndex + 1]
      if (!next) return
      setPlayback(latest => latest?.requestId === current.requestId ? { track: next, requestId: ++playbackRequest.current } : latest)
    } catch { /* Leave the completed track visible when its album queue is unavailable. */ }
  }

  return (
    <>
      <Suspense fallback={null}><EcoScene zone={view} section={library.section} activity={activeActivity} playing={Boolean(playback)} /></Suspense>
      {playback && <NowPlayingView selection={playback} audioRef={audioRef} open={nowPlayingOpen} close={() => setNowPlayingOpen(false)} />}
      <div className={`app-shell ${playback ? 'has-player' : ''}${nowPlayingOpen ? ' now-playing-active' : ''}`}>
        <Sidebar view={view} setView={navigate} library={library} acquisitions={acquisitions} />
        <main className={view === 'library' ? 'library-main' : undefined}>
          {view === 'library' && <LibraryView library={library} acquisitions={acquisitions} playTrack={playTrack} />}
          {view === 'imports' && <ImportsView beets={beets} />}
          {view === 'wanted' && <WantedView acquisitions={acquisitions} selectedJourneyId={selectedJourneyId} openJourney={openJourney} closeJourney={() => setSelectedJourneyId(null)} beets={beets} library={library} setView={navigate} />}
          {view === 'activity' && <ActivityView acquisitions={acquisitions} imports={importOperations} openJourney={openJourney} sectionNumber={acquisitions.configured ? '04' : '03'} />}
        </main>
        {playback && <PlayerBar selection={playback} audioRef={audioRef} openNowPlaying={() => setNowPlayingOpen(true)} playNext={() => { void playNext() }} close={() => { setNowPlayingOpen(false); setPlayback(null) }} />}
      </div>
    </>
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
    sources.artists === 'available' ? null : `Artist index ${sources.artists}`,
    sources.tracks === 'available' ? null : `Song index ${sources.tracks}`,
    sources.catalog === 'available' ? null : `MusicBrainz catalog ${sources.catalog === 'unconfigured' ? 'not configured' : 'unavailable'}`,
    sources.wanted === 'available' ? null : 'Adding music is not configured',
  ].filter(Boolean)
  return messages.join(' · ')
}

const root = document.getElementById('root')
if (!root) throw new Error('Needle root element is missing')
createRoot(root).render(<App />)

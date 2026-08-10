import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CatalogRelease } from '../integrations/catalog.js'
import type { AcquisitionDefaults, AcquisitionJob, AcquisitionState } from './acquisition.js'

const SCHEMA_VERSION = 7

export type DirectSubmissionState = 'none' | 'submitting' | 'submitted' | 'submission-unknown'
export interface DirectAcquisitionWorkflow {
  acquisitionId: string; candidates: readonly import('../integrations/slskd-candidates.js').SoulseekCandidate[]
  editions: readonly import('../integrations/musicbrainz.js').ConcreteRelease[]; searchIds: readonly string[]
  selectedCandidateId?: string; selectedEditionId?: string; selectionExplanation?: string
  submissionState: DirectSubmissionState; batchIds: readonly string[]; expectedFileCount: number
  relativeDestination: string; outputProviderPath?: string; outputNeedlePath?: string
  error?: string; createdAt: string; updatedAt: string
}
interface DirectRow { acquisition_id: string; candidates_json: string; editions_json: string; search_ids_json: string; selected_candidate_id: string | null; selected_edition_id: string | null; selection_explanation: string | null; submission_state: DirectSubmissionState; batch_ids_json: string; expected_file_count: number; relative_destination: string; output_provider_path: string | null; output_needle_path: string | null; error: string | null; created_at: string; updated_at: string }

export type BeetsImportOperationState = 'submitting' | 'submitted' | 'submission-unknown' | 'provider-completed' | 'library-confirmed'
export interface BeetsImportSelection {
  taskId: string
  candidateId: string
  duplicateAction: 'skip' | 'keep'
  artist?: string
  album?: string
  year?: number
  trackCount: number
}
export interface BeetsImportOperation {
  id: string
  sessionId: string
  providerPath: string
  hash: string
  state: BeetsImportOperationState
  selections: readonly BeetsImportSelection[]
  acquisitionId?: string
  providerJobId?: string
  libraryAlbumIds: readonly string[]
  createdAt: string
  updatedAt: string
}
interface BeetsImportOperationRow {
  id: string; session_id: string; provider_path: string; hash: string; state: BeetsImportOperationState
  selections_json: string; provider_job_id: string | null; library_album_ids_json: string
  acquisition_id: string | null
  created_at: string; updated_at: string
}

interface AcquisitionRow {
  id: string
  state: AcquisitionState
  adapter_id: string
  native_id: string
  artist: string | null
  release: string
  release_date: string | null
  release_type: string | null
  track_count: number | null
  musicbrainz_release_group_id: string | null
  import_adapter_id: string | null
  import_native_id: string | null
  created_at: string
  updated_at: string
}

interface DefaultsRow {
  root_adapter_id: string
  root_native_id: string
  quality_adapter_id: string
  quality_native_id: string
  metadata_adapter_id: string | null
  metadata_native_id: string | null
}

export interface WantReleaseResult {
  job: AcquisitionJob
  created: boolean
}

export class AcquisitionLinkConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'AcquisitionLinkConflictError' }
}

/** SQLite persistence for Needle-owned acquisition intent. */
export class AcquisitionRepository {
  readonly #database: DatabaseSync

  constructor(path: string) {
    const databasePath = resolve(path)
    mkdirSync(dirname(databasePath), { recursive: true })
    this.#database = new DatabaseSync(databasePath)
    try {
      this.#database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
      `)
      this.#migrate()
      this.#recoverInterruptedBeetsSubmissions()
      this.#recoverInterruptedDirectSubmissions()
    } catch (error) {
      this.#database.close()
      throw error
    }
  }

  close(): void {
    this.#database.close()
  }

  list(): readonly AcquisitionJob[] {
    const rows = this.#database.prepare(`
      SELECT id, state, adapter_id, native_id, artist, release, release_date, release_type, track_count, musicbrainz_release_group_id, import_adapter_id, import_native_id, created_at, updated_at
      FROM acquisitions
      ORDER BY created_at DESC, id DESC
    `).all() as unknown as AcquisitionRow[]
    return rows.map(toJob)
  }

  get(id: string): AcquisitionJob | null {
    const row = this.#database.prepare('SELECT * FROM acquisitions WHERE id = ?').get(id) as unknown as AcquisitionRow | undefined
    return row ? toJob(row) : null
  }

  getDefaults(): AcquisitionDefaults | null {
    const row = this.#database.prepare(`
      SELECT
        root_adapter_id,
        root_native_id,
        quality_adapter_id,
        quality_native_id,
        metadata_adapter_id,
        metadata_native_id
      FROM acquisition_defaults
      WHERE id = 1
    `).get() as unknown as DefaultsRow | undefined
    if (!row) return null
    return {
      root: { adapterId: row.root_adapter_id, nativeId: row.root_native_id },
      qualityProfile: { adapterId: row.quality_adapter_id, nativeId: row.quality_native_id },
      ...(row.metadata_adapter_id && row.metadata_native_id
        ? { metadataProfile: { adapterId: row.metadata_adapter_id, nativeId: row.metadata_native_id } }
        : {}),
    }
  }

  setDefaults(defaults: AcquisitionDefaults): AcquisitionDefaults {
    this.#database.prepare(`
      INSERT INTO acquisition_defaults (
        id,
        root_adapter_id,
        root_native_id,
        quality_adapter_id,
        quality_native_id,
        metadata_adapter_id,
        metadata_native_id
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        root_adapter_id = excluded.root_adapter_id,
        root_native_id = excluded.root_native_id,
        quality_adapter_id = excluded.quality_adapter_id,
        quality_native_id = excluded.quality_native_id,
        metadata_adapter_id = excluded.metadata_adapter_id,
        metadata_native_id = excluded.metadata_native_id
    `).run(
      defaults.root.adapterId,
      defaults.root.nativeId,
      defaults.qualityProfile.adapterId,
      defaults.qualityProfile.nativeId,
      defaults.metadataProfile?.adapterId ?? null,
      defaults.metadataProfile?.nativeId ?? null,
    )
    return this.getDefaults()!
  }

  wantRelease(release: CatalogRelease): WantReleaseResult {
    const id = randomUUID()
    const now = new Date().toISOString()
    const musicBrainzReleaseGroupId = release.musicBrainzReleaseGroupId?.trim().toLowerCase() ?? null
    if (musicBrainzReleaseGroupId) {
      const existing = this.#database.prepare(`
        SELECT id, state, adapter_id, native_id, artist, release, release_date, release_type, track_count, musicbrainz_release_group_id, import_adapter_id, import_native_id, created_at, updated_at
        FROM acquisitions
        WHERE adapter_id = ? AND musicbrainz_release_group_id = ?
      `).get(release.ref.adapterId, musicBrainzReleaseGroupId) as unknown as AcquisitionRow | undefined
      if (existing) return { job: toJob(existing), created: false }
    }
    const result = this.#database.prepare(`
      INSERT INTO acquisitions (
        id, state, adapter_id, native_id, artist, release, release_date, release_type, track_count, musicbrainz_release_group_id, created_at, updated_at
      ) VALUES (?, 'wanted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (adapter_id, native_id) DO NOTHING
    `).run(
      id,
      release.ref.adapterId,
      release.ref.nativeId,
      release.artistName ?? null,
      release.title,
      release.releaseDate ?? null,
      release.releaseType ?? null,
      release.trackCount ?? null,
      musicBrainzReleaseGroupId,
      now,
      now,
    )

    const row = this.#database.prepare(`
      SELECT id, state, adapter_id, native_id, artist, release, release_date, release_type, track_count, musicbrainz_release_group_id, import_adapter_id, import_native_id, created_at, updated_at
      FROM acquisitions
      WHERE adapter_id = ? AND native_id = ?
    `).get(release.ref.adapterId, release.ref.nativeId) as unknown as AcquisitionRow | undefined
    if (!row) throw new Error('Acquisition insert did not produce a readable row')

    return { job: toJob(row), created: result.changes === 1 }
  }

  getDirectWorkflow(id: string): DirectAcquisitionWorkflow | null {
    const row = this.#database.prepare('SELECT * FROM direct_acquisitions WHERE acquisition_id = ?').get(id) as unknown as DirectRow | undefined
    return row ? toDirect(row) : null
  }
  beginDirectSearch(id: string, relativeDestination: string): DirectAcquisitionWorkflow {
    const now = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const job = this.get(id); if (!job || !['wanted','failed','selection-required'].includes(job.state)) throw new Error('Direct search requires wanted, failed, or selection-required state')
      const current = this.getDirectWorkflow(id); if (current && current.submissionState !== 'none') throw new Error('Cannot search after transfer submission has begun')
      this.#database.prepare(`INSERT INTO direct_acquisitions (acquisition_id,candidates_json,editions_json,search_ids_json,submission_state,batch_ids_json,expected_file_count,relative_destination,created_at,updated_at)
        VALUES (?,'[]','[]','[]','none','[]',0,?,?,?) ON CONFLICT(acquisition_id) DO UPDATE SET candidates_json='[]', editions_json='[]', search_ids_json='[]', selected_candidate_id=NULL, selected_edition_id=NULL, selection_explanation=NULL, error=NULL, updated_at=excluded.updated_at`).run(id, relativeDestination, now, now)
      this.#database.prepare("UPDATE acquisitions SET state='searching', updated_at=? WHERE id=?").run(now,id); this.#database.exec('COMMIT')
    } catch(e){this.#database.exec('ROLLBACK');throw e} return this.getDirectWorkflow(id)!
  }
  storeDirectCandidates(id: string, editions: readonly unknown[], candidates: readonly unknown[], searchIds: readonly string[]): DirectAcquisitionWorkflow {
    const now=new Date().toISOString(); const state=candidates.length?'selection-required':'failed'
    this.#database.exec('BEGIN IMMEDIATE');try{const result=this.#database.prepare("UPDATE direct_acquisitions SET editions_json=?,candidates_json=?,search_ids_json=?,error=?,updated_at=? WHERE acquisition_id=? AND submission_state='none' AND EXISTS(SELECT 1 FROM acquisitions WHERE id=? AND state='searching')").run(JSON.stringify(editions),JSON.stringify(candidates),JSON.stringify(searchIds),candidates.length?null:'No candidates found',now,id,id)
      if(result.changes!==1) throw new Error('Direct candidate transition guard failed');this.#database.prepare('UPDATE acquisitions SET state=?,updated_at=? WHERE id=?').run(state,now,id);this.#database.exec('COMMIT')}catch(error){this.#database.exec('ROLLBACK');throw error}return this.getDirectWorkflow(id)!
  }
  beginDirectTransfer(id:string,candidateId:string,editionId:string,explanation:string,expected:number,providerPath:string,needlePath:string):DirectAcquisitionWorkflow {
    const now=new Date().toISOString(); const result=this.#database.prepare(`UPDATE direct_acquisitions SET selected_candidate_id=?,selected_edition_id=?,selection_explanation=?,expected_file_count=?,output_provider_path=?,output_needle_path=?,submission_state='submitting',error=NULL,updated_at=? WHERE acquisition_id=? AND submission_state='none' AND EXISTS(SELECT 1 FROM acquisitions WHERE id=? AND state='selection-required')`).run(candidateId,editionId,explanation,expected,providerPath,needlePath,now,id,id)
    if(result.changes!==1) throw new Error('Direct transfer transition guard failed'); return this.getDirectWorkflow(id)!
  }
  confirmDirectBatches(id:string,batchIds:readonly string[]):DirectAcquisitionWorkflow { return this.#directSubmissionTransition(id,'submitting','submitted',batchIds) }
  markDirectSubmissionUnknown(id:string,error:string):DirectAcquisitionWorkflow { const now=new Date().toISOString(); this.#database.exec('BEGIN IMMEDIATE'); try { const r=this.#database.prepare("UPDATE direct_acquisitions SET submission_state='submission-unknown',error=?,updated_at=? WHERE acquisition_id=? AND submission_state='submitting'").run(error,now,id); if(r.changes!==1) throw new Error('Direct submission transition guard failed'); this.#database.prepare("UPDATE acquisitions SET state='selection-required',updated_at=? WHERE id=?").run(now,id); this.#database.exec('COMMIT') }catch(e){this.#database.exec('ROLLBACK');throw e} return this.getDirectWorkflow(id)! }
  reconcileDirect(id:string,state:'queued'|'transferring'|'completed'|'failed',error?:string):DirectAcquisitionWorkflow {const now=new Date().toISOString();this.#database.exec('BEGIN IMMEDIATE');try{const r=this.#database.prepare("UPDATE direct_acquisitions SET error=?,updated_at=? WHERE acquisition_id=? AND submission_state='submitted'").run(error??null,now,id);if(r.changes!==1)throw new Error('Direct reconcile transition guard failed');this.#database.prepare("UPDATE acquisitions SET state=?,updated_at=? WHERE id=? AND state IN ('queued','transferring','completed','failed')").run(state,now,id);this.#database.exec('COMMIT')}catch(error){this.#database.exec('ROLLBACK');throw error}return this.getDirectWorkflow(id)!}
  #directSubmissionTransition(id:string,from:DirectSubmissionState,to:DirectSubmissionState,batches:readonly string[]){const now=new Date().toISOString();this.#database.exec('BEGIN IMMEDIATE');try{const r=this.#database.prepare('UPDATE direct_acquisitions SET submission_state=?,batch_ids_json=?,updated_at=? WHERE acquisition_id=? AND submission_state=?').run(to,JSON.stringify(batches),now,id,from);if(r.changes!==1)throw new Error('Direct submission transition guard failed');this.#database.prepare("UPDATE acquisitions SET state='queued',updated_at=? WHERE id=? AND state='selection-required'").run(now,id);this.#database.exec('COMMIT')}catch(error){this.#database.exec('ROLLBACK');throw error}return this.getDirectWorkflow(id)!}

  createBeetsImportOperation(input: Pick<BeetsImportOperation, 'sessionId' | 'providerPath' | 'hash' | 'selections' | 'acquisitionId'>): { operation: BeetsImportOperation, created: boolean } {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE')
    let changes = 0
    try {
      const existing = this.getBeetsImportOperation(input.sessionId, true)
      if (!existing && input.acquisitionId) {
        const acquisition = this.get(input.acquisitionId)
        const directReady = acquisition?.state === 'completed' && this.getDirectWorkflow(input.acquisitionId)?.submissionState === 'submitted'
        if (!acquisition || (acquisition.state !== 'wanted' && !directReady)) throw new AcquisitionLinkConflictError('Acquisition does not exist or is not ready for import')
      }
      const result = existing ? null : this.#database.prepare(`INSERT INTO beets_import_operations
        (id, session_id, provider_path, hash, state, selections_json, library_album_ids_json, acquisition_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'submitting', ?, '[]', ?, ?, ?) ON CONFLICT (session_id) DO NOTHING`).run(
        id, input.sessionId, input.providerPath, input.hash, JSON.stringify(input.selections), input.acquisitionId ?? null, now, now,
      )
      changes = Number(result?.changes ?? 0)
      if (changes === 1 && input.acquisitionId) this.#database.prepare(`UPDATE acquisitions SET state = 'importing', import_adapter_id = 'beets-import', import_native_id = ?, updated_at = ? WHERE id = ? AND state IN ('wanted','completed')`).run(id, now, input.acquisitionId)
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: beets_import_operations.acquisition_id')) throw new AcquisitionLinkConflictError('Acquisition is already linked to an import operation')
      throw error
    }
    const operation = this.getBeetsImportOperation(changes === 1 ? id : input.sessionId, changes !== 1)
    if (!operation) throw new Error('Beets import operation insert did not produce a readable row')
    return { operation, created: changes === 1 }
  }

  getBeetsImportOperation(id: string, bySessionId = false): BeetsImportOperation | null {
    const row = this.#database.prepare(`SELECT * FROM beets_import_operations WHERE ${bySessionId ? 'session_id' : 'id'} = ?`).get(id) as unknown as BeetsImportOperationRow | undefined
    return row ? toBeetsImportOperation(row) : null
  }

  listBeetsImportOperations(): readonly BeetsImportOperation[] {
    const rows = this.#database.prepare('SELECT * FROM beets_import_operations ORDER BY created_at DESC, id DESC').all() as unknown as BeetsImportOperationRow[]
    return rows.map(toBeetsImportOperation)
  }

  transitionBeetsImportOperation(id: string, expectedState: BeetsImportOperationState, state: BeetsImportOperationState, update: { providerJobId?: string, libraryAlbumIds?: readonly string[] } = {}): BeetsImportOperation | null {
    const allowed = (expectedState === 'submitting' && (state === 'submitted' || state === 'submission-unknown'))
      || (expectedState === 'submitted' && state === 'provider-completed')
      || (expectedState === 'provider-completed' && state === 'library-confirmed')
    if (!allowed) throw new Error(`Invalid beets import operation transition: ${expectedState} -> ${state}`)
    const now = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
    const result = this.#database.prepare(`UPDATE beets_import_operations SET state = ?,
      provider_job_id = COALESCE(?, provider_job_id), library_album_ids_json = COALESCE(?, library_album_ids_json), updated_at = ? WHERE id = ? AND state = ?`).run(
      state, update.providerJobId ?? null, update.libraryAlbumIds ? JSON.stringify([...new Set(update.libraryAlbumIds)]) : null, now, id, expectedState,
    )
    if (result.changes === 1 && state === 'submission-unknown') this.#database.prepare("UPDATE acquisitions SET state = 'selection-required', updated_at = ? WHERE id = (SELECT acquisition_id FROM beets_import_operations WHERE id = ?)").run(now, id)
    if (result.changes === 1 && state === 'library-confirmed') this.#database.prepare("UPDATE acquisitions SET state = 'completed', updated_at = ? WHERE id = (SELECT acquisition_id FROM beets_import_operations WHERE id = ?)").run(now, id)
    this.#database.exec('COMMIT')
    } catch (error) { this.#database.exec('ROLLBACK'); throw error }
    return this.getBeetsImportOperation(id)
  }

  abortBeetsImportOperation(id: string): boolean {
    const now = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const operation = this.getBeetsImportOperation(id)
      if (!operation || operation.state !== 'submitting') { this.#database.exec('COMMIT'); return false }
      const result = this.#database.prepare("DELETE FROM beets_import_operations WHERE id = ? AND state = 'submitting'").run(id)
      if (result.changes === 1 && operation.acquisitionId) this.#database.prepare(`UPDATE acquisitions
        SET state = CASE WHEN EXISTS (SELECT 1 FROM direct_acquisitions d WHERE d.acquisition_id = acquisitions.id AND d.submission_state = 'submitted') THEN 'completed' ELSE 'wanted' END, import_adapter_id = NULL, import_native_id = NULL, updated_at = ?
        WHERE id = ? AND state = 'importing' AND import_adapter_id = 'beets-import' AND import_native_id = ?`).run(now, operation.acquisitionId, id)
      this.#database.exec('COMMIT')
      return result.changes === 1
    } catch (error) { this.#database.exec('ROLLBACK'); throw error }
  }

  #recoverInterruptedBeetsSubmissions(): void {
    const now = new Date().toISOString()
    this.#transaction(`UPDATE acquisitions SET state = 'selection-required', updated_at = '${now}' WHERE id IN (SELECT acquisition_id FROM beets_import_operations WHERE state = 'submitting');
      UPDATE beets_import_operations SET state = 'submission-unknown', updated_at = '${now}' WHERE state = 'submitting';`)
  }
  #recoverInterruptedDirectSubmissions():void { const now=new Date().toISOString(); this.#transaction(`UPDATE acquisitions SET state='selection-required',updated_at='${now}' WHERE id IN(SELECT acquisition_id FROM direct_acquisitions WHERE submission_state='submitting'); UPDATE direct_acquisitions SET submission_state='submission-unknown',error='Submission outcome unknown after restart',updated_at='${now}' WHERE submission_state='submitting';`) }

  #migrate(): void {
    const row = this.#database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (row.user_version > SCHEMA_VERSION) {
      throw new Error(`Needle database schema ${row.user_version} is newer than supported schema ${SCHEMA_VERSION}`)
    }
    if (row.user_version < 1) {
      this.#transaction(`
        CREATE TABLE acquisitions (
          id TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK (state = 'wanted'),
          adapter_id TEXT NOT NULL,
          native_id TEXT NOT NULL,
          artist TEXT,
          release TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (adapter_id, native_id)
        );
        PRAGMA user_version = 1;
      `)
    }
    if (row.user_version < 2) {
      this.#transaction(`
        CREATE TABLE acquisition_defaults (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          root_adapter_id TEXT NOT NULL,
          root_native_id TEXT NOT NULL,
          quality_adapter_id TEXT NOT NULL,
          quality_native_id TEXT NOT NULL,
          metadata_adapter_id TEXT,
          metadata_native_id TEXT,
          CHECK (
            (metadata_adapter_id IS NULL AND metadata_native_id IS NULL)
            OR (metadata_adapter_id IS NOT NULL AND metadata_native_id IS NOT NULL)
          )
        );
        PRAGMA user_version = 2;
      `)
    }
    if (row.user_version < 3) {
      this.#transaction(`
        ALTER TABLE acquisitions ADD COLUMN musicbrainz_release_group_id TEXT;
        CREATE INDEX acquisitions_musicbrainz_release_group
          ON acquisitions (musicbrainz_release_group_id);
        PRAGMA user_version = 3;
      `)
    }
    if (row.user_version < 4) {
      this.#transaction(`
        CREATE TABLE beets_import_operations (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL UNIQUE,
          provider_path TEXT NOT NULL,
          hash TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('submitting', 'submitted', 'submission-unknown', 'provider-completed', 'library-confirmed')),
          selections_json TEXT NOT NULL,
          provider_job_id TEXT,
          library_album_ids_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        PRAGMA user_version = 4;
      `)
    }
    if (row.user_version < 5) {
      this.#transaction(`
        ALTER TABLE acquisitions RENAME TO acquisitions_v4;
        CREATE TABLE acquisitions (
          id TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK (state IN ('wanted','searching','selection-required','queued','transferring','importing','completed','failed','cancelled')),
          adapter_id TEXT NOT NULL, native_id TEXT NOT NULL, artist TEXT, release TEXT NOT NULL,
          musicbrainz_release_group_id TEXT, import_adapter_id TEXT, import_native_id TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (adapter_id, native_id),
          CHECK ((import_adapter_id IS NULL AND import_native_id IS NULL) OR (import_adapter_id IS NOT NULL AND import_native_id IS NOT NULL))
        );
        INSERT INTO acquisitions (id,state,adapter_id,native_id,artist,release,musicbrainz_release_group_id,created_at,updated_at)
          SELECT id,state,adapter_id,native_id,artist,release,musicbrainz_release_group_id,created_at,updated_at FROM acquisitions_v4;
        DROP TABLE acquisitions_v4;
        CREATE INDEX acquisitions_musicbrainz_release_group ON acquisitions (musicbrainz_release_group_id);
        ALTER TABLE beets_import_operations ADD COLUMN acquisition_id TEXT REFERENCES acquisitions(id);
        CREATE UNIQUE INDEX beets_import_operations_acquisition ON beets_import_operations(acquisition_id) WHERE acquisition_id IS NOT NULL;
        PRAGMA user_version = 5;
      `)
    }
    if (row.user_version < 6) {
      this.#transaction(`
        ALTER TABLE acquisitions ADD COLUMN release_date TEXT;
        ALTER TABLE acquisitions ADD COLUMN release_type TEXT;
        ALTER TABLE acquisitions ADD COLUMN track_count INTEGER;
        PRAGMA user_version = 6;
      `)
    }
    if (row.user_version < 7) {
      this.#transaction(`CREATE TABLE direct_acquisitions (acquisition_id TEXT PRIMARY KEY REFERENCES acquisitions(id) ON DELETE CASCADE,candidates_json TEXT NOT NULL,editions_json TEXT NOT NULL,search_ids_json TEXT NOT NULL,selected_candidate_id TEXT,selected_edition_id TEXT,selection_explanation TEXT,submission_state TEXT NOT NULL CHECK(submission_state IN('none','submitting','submitted','submission-unknown')),batch_ids_json TEXT NOT NULL,expected_file_count INTEGER NOT NULL,relative_destination TEXT NOT NULL,output_provider_path TEXT,output_needle_path TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); PRAGMA user_version=7;`)
    }
  }

  #transaction(sql: string): void {
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database.exec(sql)
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }
}

function toDirect(r:DirectRow):DirectAcquisitionWorkflow{return{acquisitionId:r.acquisition_id,candidates:JSON.parse(r.candidates_json),editions:JSON.parse(r.editions_json),searchIds:JSON.parse(r.search_ids_json),...(r.selected_candidate_id?{selectedCandidateId:r.selected_candidate_id}:{}),...(r.selected_edition_id?{selectedEditionId:r.selected_edition_id}:{}),...(r.selection_explanation?{selectionExplanation:r.selection_explanation}:{}),submissionState:r.submission_state,batchIds:JSON.parse(r.batch_ids_json),expectedFileCount:r.expected_file_count,relativeDestination:r.relative_destination,...(r.output_provider_path?{outputProviderPath:r.output_provider_path}:{}),...(r.output_needle_path?{outputNeedlePath:r.output_needle_path}:{}),...(r.error?{error:r.error}:{}),createdAt:r.created_at,updatedAt:r.updated_at}}

function toBeetsImportOperation(row: BeetsImportOperationRow): BeetsImportOperation {
  return {
    id: row.id, sessionId: row.session_id, providerPath: row.provider_path, hash: row.hash,
    state: row.state, selections: JSON.parse(row.selections_json) as BeetsImportSelection[],
    ...(row.acquisition_id ? { acquisitionId: row.acquisition_id } : {}),
    ...(row.provider_job_id ? { providerJobId: row.provider_job_id } : {}),
    libraryAlbumIds: JSON.parse(row.library_album_ids_json) as string[],
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toJob(row: AcquisitionRow): AcquisitionJob {
  return {
    id: row.id,
    state: row.state,
    artist: row.artist ?? undefined,
    release: row.release,
    ...(row.release_date ? { releaseDate: row.release_date } : {}),
    ...(row.release_type ? { releaseType: row.release_type } : {}),
    ...(row.track_count !== null ? { trackCount: row.track_count } : {}),
    ...(row.musicbrainz_release_group_id
      ? { musicBrainzReleaseGroupId: row.musicbrainz_release_group_id }
      : {}),
    searchRefs: [{ adapterId: row.adapter_id, nativeId: row.native_id }],
    ...(row.import_adapter_id && row.import_native_id ? { importRef: { adapterId: row.import_adapter_id, nativeId: row.import_native_id } } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

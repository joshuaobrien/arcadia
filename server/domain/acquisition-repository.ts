import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CatalogRelease } from '../integrations/catalog.js'
import type { AcquisitionDefaults, AcquisitionJob } from './acquisition.js'

const SCHEMA_VERSION = 4

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
  providerJobId?: string
  libraryAlbumIds: readonly string[]
  createdAt: string
  updatedAt: string
}
interface BeetsImportOperationRow {
  id: string; session_id: string; provider_path: string; hash: string; state: BeetsImportOperationState
  selections_json: string; provider_job_id: string | null; library_album_ids_json: string
  created_at: string; updated_at: string
}

interface AcquisitionRow {
  id: string
  state: 'wanted'
  adapter_id: string
  native_id: string
  artist: string | null
  release: string
  musicbrainz_release_group_id: string | null
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
      SELECT id, state, adapter_id, native_id, artist, release, musicbrainz_release_group_id, created_at, updated_at
      FROM acquisitions
      ORDER BY created_at DESC, id DESC
    `).all() as unknown as AcquisitionRow[]
    return rows.map(toJob)
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
    const result = this.#database.prepare(`
      INSERT INTO acquisitions (
        id, state, adapter_id, native_id, artist, release, musicbrainz_release_group_id, created_at, updated_at
      ) VALUES (?, 'wanted', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (adapter_id, native_id) DO NOTHING
    `).run(
      id,
      release.ref.adapterId,
      release.ref.nativeId,
      release.artistName ?? null,
      release.title,
      musicBrainzReleaseGroupId,
      now,
      now,
    )

    const row = this.#database.prepare(`
      SELECT id, state, adapter_id, native_id, artist, release, musicbrainz_release_group_id, created_at, updated_at
      FROM acquisitions
      WHERE adapter_id = ? AND native_id = ?
    `).get(release.ref.adapterId, release.ref.nativeId) as unknown as AcquisitionRow | undefined
    if (!row) throw new Error('Acquisition insert did not produce a readable row')

    return { job: toJob(row), created: result.changes === 1 }
  }

  createBeetsImportOperation(input: Pick<BeetsImportOperation, 'sessionId' | 'providerPath' | 'hash' | 'selections'>): { operation: BeetsImportOperation, created: boolean } {
    const id = randomUUID()
    const now = new Date().toISOString()
    const result = this.#database.prepare(`INSERT INTO beets_import_operations
      (id, session_id, provider_path, hash, state, selections_json, library_album_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'submitting', ?, '[]', ?, ?) ON CONFLICT (session_id) DO NOTHING`).run(
      id, input.sessionId, input.providerPath, input.hash, JSON.stringify(input.selections), now, now,
    )
    const operation = this.getBeetsImportOperation(result.changes === 1 ? id : input.sessionId, result.changes !== 1)
    if (!operation) throw new Error('Beets import operation insert did not produce a readable row')
    return { operation, created: result.changes === 1 }
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
    this.#database.prepare(`UPDATE beets_import_operations SET state = ?,
      provider_job_id = COALESCE(?, provider_job_id), library_album_ids_json = COALESCE(?, library_album_ids_json), updated_at = ? WHERE id = ? AND state = ?`).run(
      state, update.providerJobId ?? null, update.libraryAlbumIds ? JSON.stringify([...new Set(update.libraryAlbumIds)]) : null, now, id, expectedState,
    )
    return this.getBeetsImportOperation(id)
  }

  #recoverInterruptedBeetsSubmissions(): void {
    const now = new Date().toISOString()
    this.#database.prepare("UPDATE beets_import_operations SET state = 'submission-unknown', updated_at = ? WHERE state = 'submitting'").run(now)
  }

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

function toBeetsImportOperation(row: BeetsImportOperationRow): BeetsImportOperation {
  return {
    id: row.id, sessionId: row.session_id, providerPath: row.provider_path, hash: row.hash,
    state: row.state, selections: JSON.parse(row.selections_json) as BeetsImportSelection[],
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
    ...(row.musicbrainz_release_group_id
      ? { musicBrainzReleaseGroupId: row.musicbrainz_release_group_id }
      : {}),
    searchRefs: [{ adapterId: row.adapter_id, nativeId: row.native_id }],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CatalogRelease } from '../integrations/catalog.js'
import type { AcquisitionJob } from './acquisition.js'

const SCHEMA_VERSION = 1

interface AcquisitionRow {
  id: string
  state: 'wanted'
  adapter_id: string
  native_id: string
  artist: string | null
  release: string
  created_at: string
  updated_at: string
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
      SELECT id, state, adapter_id, native_id, artist, release, created_at, updated_at
      FROM acquisitions
      ORDER BY created_at DESC, id DESC
    `).all() as unknown as AcquisitionRow[]
    return rows.map(toJob)
  }

  wantRelease(release: CatalogRelease): WantReleaseResult {
    const id = randomUUID()
    const now = new Date().toISOString()
    const result = this.#database.prepare(`
      INSERT INTO acquisitions (
        id, state, adapter_id, native_id, artist, release, created_at, updated_at
      ) VALUES (?, 'wanted', ?, ?, ?, ?, ?, ?)
      ON CONFLICT (adapter_id, native_id) DO NOTHING
    `).run(
      id,
      release.ref.adapterId,
      release.ref.nativeId,
      release.artistName ?? null,
      release.title,
      now,
      now,
    )

    const row = this.#database.prepare(`
      SELECT id, state, adapter_id, native_id, artist, release, created_at, updated_at
      FROM acquisitions
      WHERE adapter_id = ? AND native_id = ?
    `).get(release.ref.adapterId, release.ref.nativeId) as unknown as AcquisitionRow | undefined
    if (!row) throw new Error('Acquisition insert did not produce a readable row')

    return { job: toJob(row), created: result.changes === 1 }
  }

  #migrate(): void {
    const row = this.#database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (row.user_version > SCHEMA_VERSION) {
      throw new Error(`Needle database schema ${row.user_version} is newer than supported schema ${SCHEMA_VERSION}`)
    }
    if (row.user_version === SCHEMA_VERSION) return

    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database.exec(`
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
        PRAGMA user_version = ${SCHEMA_VERSION};
      `)
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }
}

function toJob(row: AcquisitionRow): AcquisitionJob {
  return {
    id: row.id,
    state: row.state,
    artist: row.artist ?? undefined,
    release: row.release,
    searchRefs: [{ adapterId: row.adapter_id, nativeId: row.native_id }],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

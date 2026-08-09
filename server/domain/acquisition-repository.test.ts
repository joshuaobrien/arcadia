import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { CatalogRelease } from '../integrations/catalog.js'
import { AcquisitionLinkConflictError, AcquisitionRepository } from './acquisition-repository.js'

const release: CatalogRelease = {
  ref: { adapterId: 'lidarr', nativeId: 'album:id:42' },
  artistRef: { adapterId: 'lidarr', nativeId: 'artist:id:7' },
  artistName: 'Broadcast',
  title: 'Tender Buttons',
  musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
}

test('acquisition repository persists wanted releases and deduplicates provider references', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-acquisitions-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const repository = new AcquisitionRepository(path)
  const first = repository.wantRelease(release)
  const duplicate = repository.wantRelease(release)
  repository.close()

  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(first.job.id, duplicate.job.id)
  assert.equal(first.job.state, 'wanted')
  assert.equal(first.job.artist, 'Broadcast')
  assert.equal(first.job.release, 'Tender Buttons')
  assert.equal(first.job.musicBrainzReleaseGroupId, release.musicBrainzReleaseGroupId)

  const reopened = new AcquisitionRepository(path)
  assert.deepEqual(reopened.list(), [first.job])
  reopened.close()
})

test('acquisition repository persists explicit Lidarr defaults', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-defaults-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const defaults = {
    root: { adapterId: 'lidarr', nativeId: 'root:id:1' },
    qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:2' },
    metadataProfile: { adapterId: 'lidarr', nativeId: 'profile:metadata:id:3' },
  }

  const repository = new AcquisitionRepository(path)
  assert.equal(repository.getDefaults(), null)
  assert.deepEqual(repository.setDefaults(defaults), defaults)
  repository.close()

  const reopened = new AcquisitionRepository(path)
  assert.deepEqual(reopened.getDefaults(), defaults)
  const replacement = {
    root: { adapterId: 'lidarr', nativeId: 'root:id:4' },
    qualityProfile: { adapterId: 'lidarr', nativeId: 'profile:quality:id:5' },
  }
  assert.deepEqual(reopened.setDefaults(replacement), replacement)
  reopened.close()

  const replaced = new AcquisitionRepository(path)
  assert.deepEqual(replaced.getDefaults(), replacement)
  replaced.close()
})

test('acquisition repository migrates version 1 without changing wanted releases', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-acquisitions-v1-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const database = new DatabaseSync(path)
  database.exec(`
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
    INSERT INTO acquisitions VALUES (
      'legacy-job',
      'wanted',
      'lidarr',
      'album:id:42',
      'Broadcast',
      'Tender Buttons',
      '2026-08-08T00:00:00.000Z',
      '2026-08-08T00:00:00.000Z'
    );
    PRAGMA user_version = 1;
  `)
  database.close()

  const repository = new AcquisitionRepository(path)
  assert.deepEqual(repository.list(), [{
    id: 'legacy-job',
    state: 'wanted',
    artist: 'Broadcast',
    release: 'Tender Buttons',
    searchRefs: [{ adapterId: 'lidarr', nativeId: 'album:id:42' }],
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  }])
  assert.equal(repository.getDefaults(), null)
  repository.close()

  const migrated = new DatabaseSync(path)
  const version = migrated.prepare('PRAGMA user_version').get() as { user_version: number }
  assert.equal(version.user_version, 5)
  migrated.close()
})

test('acquisition repository rejects a database created by a newer schema', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-acquisitions-newer-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const database = new DatabaseSync(path)
  database.exec('PRAGMA user_version = 6')
  database.close()

  assert.throws(
    () => new AcquisitionRepository(path),
    /database schema 6 is newer than supported schema 5/,
  )
})

test('beets import operations persist exact selections, deduplicate sessions, and transition', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-beets-operations-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(path)
  const input = { sessionId: 'session-1', providerPath: '/inbox/Album', hash: 'hash-1', selections: [{
    taskId: 'task-1', candidateId: 'candidate-1', duplicateAction: 'keep' as const,
    artist: 'Artist', album: 'Album', year: 2026, trackCount: 9,
  }] }
  const first = repository.createBeetsImportOperation(input)
  const duplicate = repository.createBeetsImportOperation({ ...input, hash: 'must-not-replace', selections: [] })
  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.deepEqual(duplicate.operation, first.operation)
  const submitted = repository.transitionBeetsImportOperation(first.operation.id, 'submitting', 'submitted', { providerJobId: 'job-1' })!
  assert.equal(submitted.state, 'submitted')
  assert.equal(submitted.providerJobId, 'job-1')
  repository.transitionBeetsImportOperation(first.operation.id, 'submitted', 'provider-completed')!
  const confirmed = repository.transitionBeetsImportOperation(first.operation.id, 'provider-completed', 'library-confirmed', { libraryAlbumIds: ['album-1', 'album-1'] })!
  assert.deepEqual(confirmed.libraryAlbumIds, ['album-1'])
  assert.equal(repository.transitionBeetsImportOperation(first.operation.id, 'submitted', 'provider-completed')!.state, 'library-confirmed')
  repository.close()

  const reopened = new AcquisitionRepository(path)
  assert.deepEqual(reopened.getBeetsImportOperation(first.operation.id), confirmed)
  assert.deepEqual(reopened.listBeetsImportOperations(), [confirmed])
  reopened.close()
})

test('beets import operations recover interrupted submissions as unknown on reopen', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-beets-recovery-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(path)
  const created = repository.createBeetsImportOperation({ sessionId: 'session-interrupted', providerPath: '/inbox/Album', hash: 'hash', selections: [] }).operation
  repository.close()

  const reopened = new AcquisitionRepository(path)
  assert.equal(reopened.getBeetsImportOperation(created.id)?.state, 'submission-unknown')
  reopened.close()
})

test('linked beets imports move wanted acquisitions through importing, attention, and completion', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-linked-imports-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(path)
  const firstWanted = repository.wantRelease(release).job
  const input = { sessionId: 'linked-session', providerPath: '/inbox/Album', hash: 'hash', acquisitionId: firstWanted.id, selections: [] }
  const linked = repository.createBeetsImportOperation(input).operation
  assert.equal(linked.acquisitionId, firstWanted.id)
  assert.equal(repository.get(firstWanted.id)?.state, 'importing')
  assert.deepEqual(repository.get(firstWanted.id)?.importRef, { adapterId: 'beets-import', nativeId: linked.id })
  assert.throws(
    () => repository.createBeetsImportOperation({ ...input, sessionId: 'another-session' }),
    AcquisitionLinkConflictError,
  )
  repository.transitionBeetsImportOperation(linked.id, 'submitting', 'submission-unknown')
  assert.equal(repository.get(firstWanted.id)?.state, 'selection-required')

  const secondWanted = repository.wantRelease({ ...release, ref: { adapterId: 'lidarr', nativeId: 'album:id:43' } }).job
  const completed = repository.createBeetsImportOperation({ ...input, sessionId: 'completed-session', acquisitionId: secondWanted.id }).operation
  repository.transitionBeetsImportOperation(completed.id, 'submitting', 'submitted', { providerJobId: 'job' })
  repository.transitionBeetsImportOperation(completed.id, 'submitted', 'provider-completed')
  repository.transitionBeetsImportOperation(completed.id, 'provider-completed', 'library-confirmed', { libraryAlbumIds: ['library-album'] })
  assert.equal(repository.get(secondWanted.id)?.state, 'completed')
  repository.close()
})

test('definitely rejected linked imports release the session and restore wanted state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-rejected-import-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(path)
  const wanted = repository.wantRelease(release).job
  const input = { sessionId: 'rejected-session', providerPath: '/inbox/Album', hash: 'hash', acquisitionId: wanted.id, selections: [] }
  const operation = repository.createBeetsImportOperation(input).operation
  assert.equal(repository.abortBeetsImportOperation(operation.id), true)
  assert.equal(repository.getBeetsImportOperation(operation.id), null)
  assert.equal(repository.get(wanted.id)?.state, 'wanted')
  assert.equal(repository.get(wanted.id)?.importRef, undefined)
  assert.equal(repository.createBeetsImportOperation(input).created, true)
  repository.close()
})

test('schema version 4 migrates existing acquisitions and import operations to lifecycle linking', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-acquisitions-v4-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE acquisitions (
      id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK (state = 'wanted'), adapter_id TEXT NOT NULL, native_id TEXT NOT NULL,
      artist TEXT, release TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      musicbrainz_release_group_id TEXT, UNIQUE (adapter_id, native_id)
    );
    CREATE INDEX acquisitions_musicbrainz_release_group ON acquisitions (musicbrainz_release_group_id);
    CREATE TABLE acquisition_defaults (
      id INTEGER PRIMARY KEY CHECK (id = 1), root_adapter_id TEXT NOT NULL, root_native_id TEXT NOT NULL,
      quality_adapter_id TEXT NOT NULL, quality_native_id TEXT NOT NULL, metadata_adapter_id TEXT, metadata_native_id TEXT
    );
    CREATE TABLE beets_import_operations (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, provider_path TEXT NOT NULL, hash TEXT NOT NULL,
      state TEXT NOT NULL, selections_json TEXT NOT NULL, provider_job_id TEXT, library_album_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO acquisitions VALUES ('wanted-v4','wanted','lidarr','album:42','Artist','Album','2026-08-09T00:00:00Z','2026-08-09T00:00:00Z','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    INSERT INTO beets_import_operations VALUES ('operation-v4','session-v4','/inbox/Album','hash','submitted','[]','job','[]','2026-08-09T00:00:00Z','2026-08-09T00:00:00Z');
    PRAGMA user_version = 4;
  `)
  database.close()

  const repository = new AcquisitionRepository(path)
  assert.equal(repository.get('wanted-v4')?.state, 'wanted')
  assert.equal(repository.getBeetsImportOperation('operation-v4')?.acquisitionId, undefined)
  repository.close()
  const migrated = new DatabaseSync(path)
  assert.equal((migrated.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 5)
  migrated.close()
})

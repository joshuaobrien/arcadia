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
  releaseDate: '2005-09-19T00:00:00Z',
  releaseType: 'Album',
  trackCount: 12,
  musicBrainzReleaseGroupId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
}

test('acquisition repository persists wanted releases and deduplicates provider references', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-acquisitions-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const repository = new AcquisitionRepository(path)
  const first = repository.wantRelease(release)
  const duplicate = repository.wantRelease(release)
  const sameReleaseWithLocalRef = repository.wantRelease({
    ...release,
    ref: { adapterId: 'lidarr', nativeId: 'album:id:99' },
  })
  repository.close()

  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(sameReleaseWithLocalRef.created, false)
  assert.equal(first.job.id, duplicate.job.id)
  assert.equal(first.job.id, sameReleaseWithLocalRef.job.id)
  assert.equal(first.job.state, 'wanted')
  assert.equal(first.job.artist, 'Broadcast')
  assert.equal(first.job.release, 'Tender Buttons')
  assert.equal(first.job.releaseDate, release.releaseDate)
  assert.equal(first.job.releaseType, release.releaseType)
  assert.equal(first.job.trackCount, release.trackCount)
  assert.equal(first.job.musicBrainzReleaseGroupId, release.musicBrainzReleaseGroupId)

  const reopened = new AcquisitionRepository(path)
  assert.deepEqual(reopened.list(), [first.job])
  reopened.close()
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
  repository.close()

  const migrated = new DatabaseSync(path)
  const version = migrated.prepare('PRAGMA user_version').get() as { user_version: number }
  assert.equal(version.user_version, 9)
  migrated.close()
})

test('acquisition repository rejects a database created by a newer schema', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-acquisitions-newer-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const database = new DatabaseSync(path)
  database.exec('PRAGMA user_version = 10')
  database.close()

  assert.throws(
    () => new AcquisitionRepository(path),
    /database schema 10 is newer than supported schema 9/,
  )
})

test('track shares persist metadata while storing only a token hash', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-track-share-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(path)
  const track = { id: 'b'.repeat(32), title: 'Echo', artists: ['Broadcast'], albumId: 'a'.repeat(32), album: 'Tender Buttons' }
  const created = repository.createTrackShare(track)
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/)
  assert.deepEqual(repository.getTrackShare(created.token)?.track, track)
  assert.equal(repository.getTrackShare('x'.repeat(43)), null)
  repository.close()

  const database = new DatabaseSync(path)
  const row = database.prepare('SELECT token_hash, track_id FROM track_shares').get() as { token_hash: string; track_id: string }
  assert.equal(row.track_id, track.id)
  assert.match(row.token_hash, /^[a-f0-9]{64}$/)
  assert.notEqual(row.token_hash, created.token)
  database.close()
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

  const secondWanted = repository.wantRelease({
    ...release,
    ref: { adapterId: 'lidarr', nativeId: 'album:id:43' },
    musicBrainzReleaseGroupId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
  }).job
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
  assert.equal((migrated.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 9)
  migrated.close()
})

test('direct workflow persists exact selection and recovers interrupted submission without permitting duplicates', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-direct-recovery-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(path)
  const job = repository.wantRelease({ ...release, ref: { adapterId: 'musicbrainz', nativeId: `release-group:mbid:${release.musicBrainzReleaseGroupId}` } }).job
  repository.beginDirectSearch(job.id, `needle/${job.id}/Broadcast - Tender Buttons`)
  const candidate = { id: 'candidate', peer: 'peer', path: 'Artist\\Album', sourceSearchIds: ['search'], audioFiles: [{ filename: 'Artist\\Album\\01.flac', path: 'Artist\\Album\\01.flac', name: '01.flac', extension: 'flac', size: 123 }], metadataFiles: [], matches: [{ editionId: 'edition', score: 100, reasons: ['exact'], mappedTracks: 1, missingTracks: 0, extraTracks: 0, rejected: false }], score: 100, autoSelectEligible: true }
  repository.storeDirectCandidates(job.id, [{ id: 'edition', media: [], tracks: [] }], [candidate], ['search'])
  repository.beginDirectTransfer(job.id, candidate.id, 'edition', 'exact', 1, `/downloads/needle/${job.id}/Broadcast - Tender Buttons`, `/music_path/inbox/needle/${job.id}/Broadcast - Tender Buttons`)
  repository.close()

  const reopened = new AcquisitionRepository(path)
  assert.equal(reopened.getDirectWorkflow(job.id)?.submissionState, 'submission-unknown')
  assert.equal(reopened.get(job.id)?.state, 'selection-required')
  assert.throws(() => reopened.beginDirectTransfer(job.id, candidate.id, 'edition', 'duplicate', 1, '/downloads/x', '/inbox/x'), /guard failed/)
  assert.throws(() => reopened.beginDirectSearch(job.id, 'needle/retry'), /Cannot search after transfer submission/)
  reopened.close()
})

test('confirmed direct preview reservation remains submitted across reopen and rejects duplicates', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-direct-preview-confirmed-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(path)
  const job = repository.wantRelease(release).job
  repository.beginDirectSearch(job.id, `needle/${job.id}/Broadcast - Tender Buttons`)
  repository.storeDirectCandidates(job.id, [], [{ id: 'candidate' } as never], [])
  repository.beginDirectTransfer(job.id, 'candidate', 'edition', 'Automatic selection: exact', 1, '/downloads/album', '/inbox/album')
  repository.confirmDirectBatches(job.id, ['batch'])
  repository.reconcileDirect(job.id, 'completed')
  repository.beginDirectPreview(job.id)
  repository.confirmDirectPreview(job.id)
  repository.close()

  const reopened = new AcquisitionRepository(path)
  assert.equal(reopened.getDirectWorkflow(job.id)?.previewSubmissionState, 'submitted')
  assert.throws(() => reopened.beginDirectPreview(job.id), /preview transition guard failed/)
  reopened.close()
})

test('interrupted direct preview becomes submission-unknown across reopen and cannot be resubmitted', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-direct-preview-unknown-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(path)
  const job = repository.wantRelease(release).job
  repository.beginDirectSearch(job.id, `needle/${job.id}/Broadcast - Tender Buttons`)
  repository.storeDirectCandidates(job.id, [], [{ id: 'candidate' } as never], [])
  repository.beginDirectTransfer(job.id, 'candidate', 'edition', 'Automatic selection: exact', 1, '/downloads/album', '/inbox/album')
  repository.confirmDirectBatches(job.id, ['batch'])
  repository.reconcileDirect(job.id, 'completed')
  repository.beginDirectPreview(job.id)
  repository.close()

  const reopened = new AcquisitionRepository(path)
  assert.equal(reopened.getDirectWorkflow(job.id)?.previewSubmissionState, 'submission-unknown')
  assert.throws(() => reopened.beginDirectPreview(job.id), /preview transition guard failed/)
  reopened.close()
})

test('direct workflow recovers an interrupted search as safely retryable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-direct-search-recovery-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(path)
  const job = repository.wantRelease({
    ...release,
    ref: { adapterId: 'musicbrainz', nativeId: `release-group:mbid:${release.musicBrainzReleaseGroupId}` },
  }).job
  repository.beginDirectSearch(job.id, `needle/${job.id}/Broadcast - Tender Buttons`)
  repository.close()

  const reopened = new AcquisitionRepository(path)
  assert.equal(reopened.get(job.id)?.state, 'failed')
  assert.equal(reopened.getDirectWorkflow(job.id)?.submissionState, 'none')
  assert.equal(reopened.getDirectWorkflow(job.id)?.error, 'Search interrupted by restart')
  assert.doesNotThrow(() => reopened.beginDirectSearch(job.id, `needle/${job.id}/Broadcast - Tender Buttons`))
  reopened.close()
})

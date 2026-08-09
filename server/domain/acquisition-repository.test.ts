import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { CatalogRelease } from '../integrations/catalog.js'
import { AcquisitionRepository } from './acquisition-repository.js'

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
  assert.equal(version.user_version, 3)
  migrated.close()
})

test('acquisition repository rejects a database created by a newer schema', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-acquisitions-newer-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const database = new DatabaseSync(path)
  database.exec('PRAGMA user_version = 4')
  database.close()

  assert.throws(
    () => new AcquisitionRepository(path),
    /database schema 4 is newer than supported schema 3/,
  )
})

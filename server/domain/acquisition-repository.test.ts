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

  const reopened = new AcquisitionRepository(path)
  assert.deepEqual(reopened.list(), [first.job])
  reopened.close()
})

test('acquisition repository rejects a database created by a newer schema', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-acquisitions-newer-'))
  const path = join(directory, 'needle.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const database = new DatabaseSync(path)
  database.exec('PRAGMA user_version = 2')
  database.close()

  assert.throws(
    () => new AcquisitionRepository(path),
    /database schema 2 is newer than supported schema 1/,
  )
})

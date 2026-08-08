import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AcquisitionLedger } from './acquisition-ledger.ts'

const release = {
  ref: { adapterId: 'lidarr', nativeId: 'album:id:42' },
  artistRef: { adapterId: 'lidarr', nativeId: 'artist:id:7' },
  artistName: 'Broadcast',
  title: 'Tender Buttons',
}

test('acquisition ledger persists wanted releases and deduplicates provider references', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-ledger-'))
  const path = join(directory, 'state.json')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const ledger = new AcquisitionLedger(path)
  const [first, duplicate] = await Promise.all([
    ledger.wantRelease(release),
    ledger.wantRelease(release),
  ])

  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(first.job.id, duplicate.job.id)
  assert.equal(first.job.state, 'wanted')
  assert.equal(first.job.artist, 'Broadcast')
  assert.equal(first.job.release, 'Tender Buttons')

  const reopened = new AcquisitionLedger(path)
  assert.deepEqual(await reopened.list(), [first.job])
})

test('acquisition ledger rejects invalid jobs instead of replacing them', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-ledger-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  const invalidJobs = [
    { ...validJob(), state: 'garbage' },
    { ...validJob(), release: 42 },
    { ...validJob(), transferRef: { adapterId: 'lidarr', nativeId: 'queue:id:1' } },
  ]
  for (const [index, job] of invalidJobs.entries()) {
    const path = join(directory, `state-${index}.json`)
    await writeFile(path, JSON.stringify({ schemaVersion: 1, jobs: [job] }))
    await assert.rejects(
      () => new AcquisitionLedger(path).list(),
      /Unsupported or invalid acquisition ledger/,
    )
  }
})

test('acquisition ledger does not retain a job when its durable write fails', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-ledger-write-'))
  const blockedDirectory = join(directory, 'blocked')
  const path = join(blockedDirectory, 'state.json')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const ledger = new AcquisitionLedger(path)
  assert.deepEqual(await ledger.list(), [])
  await writeFile(blockedDirectory, 'not a directory')

  await assert.rejects(() => ledger.wantRelease(release))

  await rm(blockedDirectory)
  await mkdir(blockedDirectory)
  const retried = await ledger.wantRelease(release)

  assert.equal(retried.created, true)
  assert.deepEqual(await new AcquisitionLedger(path).list(), [retried.job])
})

function validJob() {
  return {
    id: 'job-1',
    state: 'wanted',
    artist: 'Broadcast',
    release: 'Tender Buttons',
    searchRefs: [release.ref],
    createdAt: '2026-08-08T00:00:00Z',
    updatedAt: '2026-08-08T00:00:00Z',
  }
}

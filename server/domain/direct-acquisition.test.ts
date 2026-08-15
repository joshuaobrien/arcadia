import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { ConcreteRelease } from '../integrations/musicbrainz.js'
import type { SearchResults } from '../integrations/slskd-candidates.js'
import type { SlskdTransferSummary } from '../integrations/slskd.js'
import { AcquisitionRepository } from './acquisition-repository.js'
import { DirectAcquisitionService, type DirectSlskdPort } from './direct-acquisition.js'

const releaseGroupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const context = { operationId: 'direct-test' }
const edition: ConcreteRelease = {
  id: 'edition',
  media: [{ position: 1, tracks: [] }],
  tracks: [
    { mediumPosition: 1, position: 1, title: 'Song 1' },
    { mediumPosition: 1, position: 2, title: 'Song 2' },
  ],
}

class FakeSlskd implements DirectSlskdPort {
  result: SearchResults
  submissions: Array<{ searchId: string; peer: string; files: readonly { filename: string; size: number }[]; destination: string }> = []
  rolledBack: readonly string[] = []
  failSubmission = 0
  summary: SlskdTransferSummary = { state: 'queued', visible: 2, completed: 0, bytesTotal: 2000, bytesTransferred: 0 }
  constructor(result: SearchResults) { this.result = result }
  async search(): Promise<SearchResults> { return this.result }
  async submitDownloadBatch(searchId: string, peer: string, files: readonly { filename: string; size: number }[], destination: string): Promise<string> {
    this.submissions.push({ searchId, peer, files, destination })
    if (this.failSubmission === this.submissions.length) throw new Error('enqueue failed')
    return `batch-${this.submissions.length}`
  }
  async rollbackBatches(ids: readonly string[]): Promise<void> { this.rolledBack = ids }
  async summarizeBatches(): Promise<SlskdTransferSummary> { return this.summary }
}

test('direct acquisition auto-submits one complete candidate and reconciles its mapped output', async (t) => {
  const { repository, jobId } = await fixture(t)
  const slskd = new FakeSlskd(searchResult('peer', ['Broadcast\\Tender Buttons\\01 Song 1.flac', 'Broadcast\\Tender Buttons\\02 Song 2.flac']))
  const service = new DirectAcquisitionService(repository, { listReleaseEditions: async () => [edition] }, slskd)
  const workflow = await service.search(jobId, context)
  assert.equal(workflow.submissionState, 'submitted')
  assert.equal(repository.get(jobId)?.state, 'queued')
  assert.deepEqual(workflow.batchIds, ['batch-1'])
  assert.equal(slskd.submissions[0].searchId, 'search')
  assert.match(slskd.submissions[0].destination, new RegExp(`^arcadia/${jobId}/Broadcast - Tender Buttons$`))
  assert.match(workflow.outputNeedlePath!, new RegExp(`^/music_path/inbox/arcadia/${jobId}/`))

  slskd.summary = { state: 'completed', visible: 2, completed: 2, bytesTotal: 2000, bytesTransferred: 2000 }
  await service.reconcile(jobId, context)
  assert.equal(repository.get(jobId)?.state, 'completed')
})

test('direct acquisition deterministically auto-selects the first of equally perfect peer folders', async (t) => {
  const { repository, jobId } = await fixture(t)
  const files = ['Broadcast\\Tender Buttons\\01 Song 1.flac', 'Broadcast\\Tender Buttons\\02 Song 2.flac']
  const slskd = new FakeSlskd({ searchId: 'search', responses: [response('peer-a', files), response('peer-b', files)] })
  const workflow = await new DirectAcquisitionService(repository, { listReleaseEditions: async () => [edition] }, slskd).search(jobId, context)
  assert.equal(workflow.candidates.length, 2)
  assert.equal(workflow.candidates[0].score, 100)
  assert.equal(workflow.submissionState, 'submitted')
  assert.equal(repository.get(jobId)?.state, 'queued')
  assert.equal(slskd.submissions.length, 1)
  assert.match(workflow.selectionExplanation!, /perfect match/)
})

test('direct acquisition still requires selection for equally good non-perfect matches', async (t) => {
  const { repository, jobId } = await fixture(t)
  const timedEdition = { ...edition, tracks: edition.tracks.map(track => ({ ...track, durationMs: 180_000 })) }
  const files = [
    { filename: 'Broadcast\\Tender Buttons\\01 Song 1.flac', size: 1000, length: 190 },
    { filename: 'Broadcast\\Tender Buttons\\02 Song 2.flac', size: 1000, length: 190 },
  ]
  const slskd = new FakeSlskd({ searchId: 'search', responses: [{ username: 'peer-a', files }, { username: 'peer-b', files }] })
  const workflow = await new DirectAcquisitionService(repository, { listReleaseEditions: async () => [timedEdition] }, slskd).search(jobId, context)
  assert.ok(workflow.candidates[0].score < 100)
  assert.equal(workflow.submissionState, 'none')
  assert.equal(repository.get(jobId)?.state, 'selection-required')
  assert.equal(slskd.submissions.length, 0)
})

test('direct acquisition rolls back earlier disc batches and blocks retry after an uncertain partial enqueue', async (t) => {
  const { repository, jobId } = await fixture(t)
  const files = ['Broadcast\\Tender Buttons\\CD1\\01 Song 1.flac', 'Broadcast\\Tender Buttons\\CD2\\02 Song 2.flac']
  const slskd = new FakeSlskd(searchResult('peer', files))
  slskd.failSubmission = 2
  const service = new DirectAcquisitionService(repository, { listReleaseEditions: async () => [edition] }, slskd)
  await assert.rejects(() => service.search(jobId, context), /enqueue failed/)
  assert.deepEqual(slskd.rolledBack, ['batch-1'])
  assert.equal(repository.getDirectWorkflow(jobId)?.submissionState, 'submission-unknown')
  assert.equal(repository.get(jobId)?.state, 'selection-required')
  await assert.rejects(() => service.retry(jobId, context), /Cannot search after transfer submission/)
})

test('direct acquisition removes known failed transfers before retrying', async (t) => {
  const { repository, jobId } = await fixture(t)
  const files = ['Broadcast\\Tender Buttons\\01 Song 1.flac', 'Broadcast\\Tender Buttons\\02 Song 2.flac']
  const slskd = new FakeSlskd(searchResult('peer', files))
  const service = new DirectAcquisitionService(repository, { listReleaseEditions: async () => [edition] }, slskd)
  await service.search(jobId, context)
  slskd.summary = { state: 'failed', visible: 2, completed: 1, bytesTotal: 2000, bytesTransferred: 1000, error: 'Transfer failed' }
  await service.reconcile(jobId, context)
  assert.equal(repository.get(jobId)?.state, 'failed')

  const retried = await service.retry(jobId, context)
  assert.deepEqual(slskd.rolledBack, ['batch-1'])
  assert.equal(retried.submissionState, 'submitted')
  assert.deepEqual(retried.batchIds, ['batch-2'])
  assert.equal(repository.get(jobId)?.state, 'queued')
})

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'needle-direct-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AcquisitionRepository(join(directory, 'needle.sqlite'))
  t.after(() => repository.close())
  const job = repository.wantRelease({
    ref: { adapterId: 'musicbrainz', nativeId: `release-group:mbid:${releaseGroupId}` },
    artistRef: { adapterId: 'musicbrainz', nativeId: 'artist:mbid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' },
    artistName: 'Broadcast', title: 'Tender Buttons', musicBrainzReleaseGroupId: releaseGroupId,
  }).job
  return { repository, jobId: job.id }
}

function response(username: string, filenames: readonly string[]) {
  return { username, files: filenames.map(filename => ({ filename, size: 1000 })) }
}

function searchResult(username: string, filenames: readonly string[]): SearchResults {
  return { searchId: 'search', responses: [response(username, filenames)] }
}

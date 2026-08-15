import assert from 'node:assert/strict'
import test from 'node:test'
import { BeetsFlaskAdapter, createBeetsFlaskAdapterFromEnv } from './beets-flask.js'
import { AdapterError } from './errors.js'

const context = { operationId: 'operation-123' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

test('beets-flask normalizes health, stats, recursive trees, statuses, and operation headers', async () => {
  const paths: string[] = []
  const adapter = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    paths.push(url.pathname)
    assert.equal((init?.headers as Record<string, string>).Accept, 'application/json')
    assert.equal((init?.headers as Record<string, string>)['X-Arcadia-Operation-Id'], context.operationId)
    if (url.pathname.endsWith('/config/')) return json({ beets_version: '2.3.1', gui: { secret: 'not projected' } })
    if (url.pathname.endsWith('/stats')) return json([{ name: 'Inbox', path: '/music/inbox', tagged_via_gui: 4, imported_via_gui: 2, size: -1, nFiles: -1, last_created: '2026-08-09T10:00:00' }])
    if (url.pathname.endsWith('/tree')) return json([{ type: 'directory', full_path: '/music/inbox', hash: 'root', is_album: false, children: [{ type: 'file', full_path: '/music/inbox/track.flac', hash: '', is_album: false }, { type: 'archive', full_path: '/music/inbox/album.zip', hash: 'child', is_album: true }] }])
    return json(Array.from({ length: 10 }, (_, index) => ({ path: `/music/${index}`, hash: `hash-${index}`, status: index - 2, exc: { message: 'not projected' } })))
  } })

  const health = await adapter.probe(context)
  const inboxes = await adapter.listInboxes(context)
  const folders = await adapter.listFolders(context)
  const statuses = await adapter.listFolderStatuses(context)

  assert.equal(health.version, '2.3.1')
  assert.equal(health.kind, 'beets')
  assert.deepEqual(inboxes, [{ name: 'Inbox', providerPath: '/music/inbox', taggedCount: 4, importedCount: 2, bytes: null, fileCount: null, lastCreatedAt: '2026-08-09T10:00:00.000Z' }])
  assert.deepEqual(folders[0], { name: 'inbox', providerPath: '/music/inbox', hash: 'root', album: false, type: 'directory', children: [{ name: 'track.flac', providerPath: '/music/inbox/track.flac', hash: '', album: false, type: 'file', children: [] }, { name: 'album.zip', providerPath: '/music/inbox/album.zip', hash: 'child', album: true, type: 'file', children: [] }] })
  assert.deepEqual(statuses.map(item => item.status), ['unknown', 'failed', 'not-started', 'pending', 'previewing', 'previewed', 'importing', 'imported', 'deleting', 'deleted'])
  assert.deepEqual(paths, ['/api_v1/config/', '/api_v1/inbox/stats', '/api_v1/inbox/tree', '/api_v1/session/status'])
})

test('beets-flask accepts a supplied API prefix and validates provider responses', async () => {
  const adapter = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test/custom/api_v1/', fetch: async (input) => {
    assert.equal(new URL(input instanceof Request ? input.url : input).pathname, '/custom/api_v1/inbox/stats')
    return json([{ name: 'Inbox' }])
  } })
  await assert.rejects(() => adapter.listInboxes(context), error => error instanceof AdapterError && error.code === 'transient-provider-failure' && error.retryable === false)
})

test('beets-flask normalizes provider HTTP errors', async () => {
  const adapter = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async () => json({ error: 'down' }, 503) })
  await assert.rejects(() => adapter.listFolders(context), error => error instanceof AdapterError && error.providerStatus === 503 && error.retryable)
})

test('beets-flask environment factory is null when BEETS_URL is absent', () => {
  assert.equal(createBeetsFlaskAdapterFromEnv({}), null)
  assert.ok(createBeetsFlaskAdapterFromEnv({ BEETS_URL: 'http://beets-flask:5001' }))
})

test('beets-flask submits exact preview and import choices and normalizes candidate review', async () => {
  const requests: { path: string; body: Record<string, unknown>; operationId: string }[] = []
  const adapter = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const operationId = (init?.headers as Record<string, string>)['X-Arcadia-Operation-Id']
    requests.push({ path, body, operationId })
    if (path.endsWith('/by_folder')) return json({
      id: 'session-1', folder_path: '/music/inbox/Album', folder_hash: 'album-hash',
      status: { progress: 20 }, exc: null,
      tasks: [{
        id: 'task-1', current_metadata: { artist: 'Raw Artist', album: 'Raw Album', year: '2026' },
        items: [{ title: null, artist: null, length: 181.5, format: 'FLAC' }],
        candidates: [{ id: 'candidate-1', info: { artist: 'Matched Artist', album: 'Matched Album', year: 2025, data_source: 'MusicBrainz', country: 'JP', label: 'Label', catalognum: 'CAT-1', media: 'CD', mediums: 2 }, distance: 0.08, penalties: ['track_title'], tracks: [{ title: 'Matched Track', artist: 'Matched Artist', length: 180, index: 1, medium: 1 }], mapping: { 0: 0 }, duplicate_ids: ['duplicate-1'] }],
        asis_candidate: { id: 'asis-task-1', info: { artist: 'Raw Artist', album: 'Raw Album' }, distance: 0, penalties: [], tracks: [{}], duplicate_ids: [] },
      }],
    })
    const kind = body.kind as 'preview' | 'import_candidate'
    return json({ num_jobs: 1, exc: null, job_metas: [{ folder_hash: 'album-hash', folder_path: '/music/inbox/Album', job_id: `${kind}-job`, job_kind: kind, job_frontend_ref: operationId }] })
  } })

  const folder = { providerPath: '/music/inbox/Album', hash: 'album-hash' }
  const previewAck = await adapter.enqueuePreview(folder, { operationId: 'preview-operation' })
  const session = await adapter.getPreview(folder, { operationId: 'read-operation' })
  const importAck = await adapter.enqueueImport({ ...folder, sessionId: session.id, choices: [{ taskId: 'task-1', candidateId: 'asis-task-1', duplicateAction: 'keep' }] }, { operationId: 'import-operation' })

  assert.equal(previewAck.jobId, 'preview-job')
  assert.equal(importAck.jobId, 'import_candidate-job')
  assert.deepEqual(session.tasks[0].candidates.map(candidate => ({ id: candidate.id, kind: candidate.kind })), [
    { id: 'candidate-1', kind: 'candidate' },
    { id: 'asis-task-1', kind: 'as-is' },
  ])
  assert.equal(session.tasks[0].candidates[0].duplicateCount, 1)
  assert.equal(session.tasks[0].candidates[0].country, 'JP')
  assert.equal(session.tasks[0].candidates[0].catalogNumber, 'CAT-1')
  assert.equal(session.tasks[0].candidates[0].mediumCount, 2)
  assert.deepEqual(session.tasks[0].candidates[0].tracks[0], { title: 'Matched Track', artist: 'Matched Artist', length: 180, index: 1, medium: 1 })
  assert.deepEqual(session.tasks[0].candidates[0].trackMapping, { 0: 0 })
  assert.equal(session.tasks[0].items[0].title, undefined)
  assert.deepEqual(requests[0], {
    path: '/api_v1/session/enqueue', operationId: 'preview-operation',
    body: { kind: 'preview', folder_hashes: ['album-hash'], folder_paths: ['/music/inbox/Album'], job_frontend_refs: ['preview-operation'], group_albums: false, autotag: true },
  })
  assert.deepEqual(requests[2], {
    path: '/api_v1/session/enqueue', operationId: 'import-operation',
    body: { kind: 'import_candidate', folder_hashes: ['album-hash'], folder_paths: ['/music/inbox/Album'], job_frontend_refs: ['import-operation'], candidate_ids: { 'task-1': 'asis-task-1' }, duplicate_actions: { 'task-1': 'keep' } },
  })
})

test('beets-flask rejects HTTP-200 exceptions and mismatched mutation acknowledgements', async () => {
  const providerException = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async () => json({ type: 'Exception', message: 'preview exploded' }) })
  await assert.rejects(
    () => providerException.getPreview({ providerPath: '/inbox/Album', hash: 'hash' }, context),
    error => error instanceof AdapterError && error.retryable === false && error.message.includes('preview exploded'),
  )

  const mismatched = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async () => json({
    num_jobs: 1, exc: null,
    job_metas: [{ folder_hash: 'different', folder_path: '/inbox/Album', job_id: 'job', job_kind: 'preview', job_frontend_ref: context.operationId }],
  }) })
  await assert.rejects(
    () => mismatched.enqueuePreview({ providerPath: '/inbox/Album', hash: 'hash' }, context),
    error => error instanceof AdapterError && error.providerCode === 'outcome-unknown' && error.retryable === false,
  )

  const staleSession = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async () => json({
    id: 'old-session', folder_path: '/inbox/Album', folder_hash: 'old-hash', status: { progress: 20 }, exc: null, tasks: [],
  }) })
  await assert.rejects(
    () => staleSession.getPreview({ providerPath: '/inbox/Album', hash: 'hash' }, context),
    error => error instanceof AdapterError && error.code === 'not-found' && error.retryable === false,
  )

  const wrongPath = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async () => json({
    id: 'wrong-session', folder_path: '/inbox/Other', folder_hash: 'hash', status: { progress: 20 }, exc: null, tasks: [],
  }) })
  await assert.rejects(
    () => wrongPath.getPreview({ providerPath: '/inbox/Album', hash: 'hash' }, context),
    error => error instanceof AdapterError && error.code === 'transient-provider-failure' && error.message.includes('does not match'),
  )

  const unknownOutcome = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async () => { throw new Error('connection reset') } })
  await assert.rejects(
    () => unknownOutcome.enqueuePreview({ providerPath: '/inbox/Album', hash: 'hash' }, context),
    error => error instanceof AdapterError && error.providerCode === 'outcome-unknown' && error.retryable === false,
  )
})

test('beets-flask fails closed for every uncertain enqueue response but keeps preview reads retryable', async () => {
  const folder = { providerPath: '/inbox/Album', hash: 'hash' }
  const responses = [
    async () => json({ error: 'failed while responding' }, 503),
    async () => new Response('{"num_jobs":', { status: 200, headers: { 'content-type': 'application/json' } }),
    async () => json({ num_jobs: 1, exc: null, job_metas: [] }),
    async () => json({ type: 'Exception', message: 'failed while acknowledging' }),
  ]

  for (const fetch of responses) {
    const adapter = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch })
    await assert.rejects(
      () => adapter.enqueuePreview(folder, context),
      error => error instanceof AdapterError && error.providerCode === 'outcome-unknown' && error.retryable === false,
    )
  }

  const failedRead = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async () => json({ error: 'temporarily down' }, 503) })
  await assert.rejects(
    () => failedRead.getPreview(folder, context),
    error => error instanceof AdapterError && error.providerCode === undefined && error.providerStatus === 503 && error.retryable,
  )
})

test('beets-flask maps provider NotFoundException responses to not-found', async () => {
  const adapter = new BeetsFlaskAdapter({ baseUrl: 'http://beets.test:5001', fetch: async () => json({ type: 'NotFoundException', message: 'No session exists' }) })
  await assert.rejects(
    () => adapter.getPreview({ providerPath: '/inbox/Album', hash: 'hash' }, context),
    error => error instanceof AdapterError && error.code === 'not-found' && error.retryable === false,
  )
})

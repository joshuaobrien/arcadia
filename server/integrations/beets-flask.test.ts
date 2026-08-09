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
    assert.equal((init?.headers as Record<string, string>)['X-Needle-Operation-Id'], context.operationId)
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { SlskdAdapter } from './slskd.js'

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })
test('slskd waits for delayed responses and sends API key only as a header', async () => { let gets = 0
  const adapter = new SlskdAdapter({ baseUrl: 'https://slskd.test', apiKey: 'secret', sleep: async () => {}, fetch: async (input, init) => { assert.equal((init?.headers as Record<string, string>)['X-API-Key'], 'secret'); assert.ok(!String(input).includes('secret')); if (init?.method === 'POST') return json({ id: 'id', state: 'InProgress' }); gets++; if (!String(input).includes('includeResponses=true')) return json({ id: 'id', isComplete: true, responseCount: 1, responses: [] }); return json({ id: 'id', isComplete: true, responseCount: 1, responses: gets > 2 ? [{ username: 'peer', files: [{ filename: 'A\\x.flac', size: 1 }] }] : [] }) } })
  assert.equal((await adapter.search('query', { operationId: 'op' })).responses.length, 1)
})
test('slskd cancels timed-out searches', async () => { let deleted = false
  const adapter = new SlskdAdapter({ baseUrl: 'https://slskd.test', apiKey: 'key', searchDeadlineMs: 1, pollIntervalMs: 2, sleep: ms => new Promise(r => setTimeout(r, ms)), fetch: async (_input, init) => { if (init?.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }) } return json(init?.method === 'POST' ? { id: 'id', state: 'InProgress' } : { id: 'id', state: 'InProgress' }) } })
  await assert.rejects(() => adapter.search('query', { operationId: 'op' }), /timed out/); assert.equal(deleted, true)
})

test('slskd submits exact files using the 0.26 batch request and response envelope', async () => {
  const adapter = new SlskdAdapter({ baseUrl: 'https://slskd.test', apiKey: 'key', fetch: async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), {
      searchId: 'search-id', username: 'peer', files: [{ filename: 'Share\\Album\\01.flac', size: 42 }],
      options: { destination: 'needle/job/Artist - Album', externalId: 'job' },
    })
    return json({ batch: { id: 'batch-id', transfers: [] }, failures: [] })
  } })
  assert.equal(await adapter.submitDownloadBatch('search-id', 'peer', [{ filename: 'Share\\Album\\01.flac', size: 42 }], 'needle/job/Artist - Album', { operationId: 'op' }, 'job'), 'batch-id')
})

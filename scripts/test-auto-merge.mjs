import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const workflow = readFileSync(new URL('../.gitea/workflows/auto-merge.yml', import.meta.url), 'utf8');
const source = ('const base =' + workflow.split('          const base =')[1].split('\n          JS')[0]).replace(/^          /gm, '');
const initial = { state: 'open', merged: false, draft: false, title: 'Ready change', user: { login: 'arcadia-pilot-bot' }, base: { ref: 'main' }, head: { sha: 'abc', repo: { full_name: 'jj/arcadia' } } };
async function run(pr = initial, env = {}, errorStatus = 0) {
  const calls = [];
  const process = { env: { MERGE_TOKEN: 'test-only', PR_NUMBER: '28', EVENT_HEAD: 'abc', ...env } };
  await vm.runInNewContext(source, {
    process, console: { log() {}, error() {} }, AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
      const result = options.method === 'GET' ? pr : options.method === 'PATCH' ? { ...pr, draft: false } : null;
      return { ok: !errorStatus, status: errorStatus || 200, text: async () => JSON.stringify(result) };
    },
  });
  return { calls, exitCode: process.exitCode };
}
test('queues exact bot head without force and requires first-party checks', async () => {
  const { calls, exitCode } = await run();
  assert.equal(exitCode, undefined);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { do: 'squash', head_commit_id: 'abc', merge_when_checks_succeed: true, force_merge: false });
});
test('superseded event cannot queue another head', async () => assert.equal((await run(initial, { EVENT_HEAD: 'old' })).calls.length, 1));
test('human PR cannot be enrolled', async () => {
  const result = await run({ ...initial, user: { login: 'jj' } });
  assert.equal(result.exitCode, 1); assert.equal(result.calls.length, 1);
});
test('foreign source or base cannot be enrolled', async () => {
  for (const pr of [{ ...initial, base: { ref: 'other' } }, { ...initial, head: { ...initial.head, repo: { full_name: 'fork/arcadia' } } }]) {
    const result = await run(pr); assert.equal(result.exitCode, 1); assert.equal(result.calls.length, 1);
  }
});
test('draft is promoted before queue request', async () => {
  const result = await run({ ...initial, draft: true, title: 'WIP: Count fix' });
  assert.equal(result.calls[1].method, 'PATCH'); assert.equal(result.calls[1].body.title, 'Count fix');
  assert.equal(result.calls[2].method, 'POST');
});
test('missing token and API failure fail closed', async () => {
  const missing = await run(initial, { MERGE_TOKEN: '' });
  assert.equal(missing.exitCode, 1); assert.equal(missing.calls.length, 0);
  const failed = await run(initial, {}, 500);
  assert.equal(failed.exitCode, 1); assert.equal(failed.calls.length, 1);
});
test('closed or merged PR is untouched', async () => {
  for (const pr of [{ ...initial, state: 'closed' }, { ...initial, merged: true }]) assert.equal((await run(pr)).calls.length, 1);
});

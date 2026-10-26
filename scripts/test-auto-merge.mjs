import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const workflow = readFileSync(new URL('../.gitea/workflows/auto-merge.yml', import.meta.url), 'utf8');
const source = ('const base =' + workflow.split('          const base =')[1].split('\n          JS')[0]).replace(/^          /gm, '');
const initial = { state: 'open', merged: false, draft: false, title: 'Ready change', user: { login: 'arcadia-pilot-bot' }, base: { ref: 'main' }, head: { sha: 'abc', repo: { full_name: 'jj/arcadia' } } };
async function run(pr = initial, env = {}, errorStatus = 0, mergeError = null, evidence = {}) {
  const calls = [];
  const process = { env: { MERGE_TOKEN: 'test-only', PR_NUMBER: '28', EVENT_HEAD: 'abc', ...env } };
  await vm.runInNewContext(source, {
    process, require, Buffer, console: { log() {}, error() {} }, AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
      const failedMerge = options.method === 'POST' && mergeError;
      const status = failedMerge ? 409 : errorStatus || 200;
      if (url.includes('/attachments/')) return {ok: !evidence.inaccessible, arrayBuffer: async () => evidence.bytes ?? (url.endsWith('1') ? Buffer.concat([imageBytes,Buffer.from('before')]) : imageBytes)};
      const result = url.includes('/files?') ? evidence.files ?? [] : url.endsWith('/assets') ? evidence.assets ?? [] : failedMerge ? { message: mergeError } : options.method === 'GET' ? pr : options.method === 'PATCH' ? { ...pr, draft: false } : null;
      return { ok: status < 400, status, text: async () => JSON.stringify(result) };
    },
  });
  return { calls, exitCode: process.exitCode };
}
test('queues exact bot head without force and requires first-party checks', async () => {
  const { calls, exitCode } = await run();
  assert.equal(exitCode, undefined);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].body, { do: 'squash', head_commit_id: 'abc', merge_when_checks_succeed: true, force_merge: false });
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
  assert.equal(result.calls[2].method, 'PATCH'); assert.equal(result.calls[2].body.title, 'Count fix');
  assert.equal(result.calls[3].method, 'POST');
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

test('already scheduled is an idempotent success, other conflicts still fail', async () => {
  const duplicate = await run(initial, {}, 0, 'pull request is already scheduled to auto merge when checks succeed [pull_id: 17]');
  assert.equal(duplicate.exitCode, undefined); assert.equal(duplicate.calls.length, 3);
  for (const message of ['head out of date', 'merge push out of date', 'unknown conflict']) {
    const conflict = await run(initial, {}, 0, message);
    assert.equal(conflict.exitCode, 1); assert.equal(conflict.calls.length, 3);
  }
});

const imageBytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
function visualFixture() {
  const assets = [1,2].map(id => ({id, uuid:`00000000-0000-0000-0000-00000000000${id}`,size:imageBytes.length}));
  const pair={platform:'mac'};
  for(const [i,stage] of ['before','after'].entries()) pair[stage]={asset_id:i+1,url:`https://joshs-mac-mini.tail81f644.ts.net/attachments/${assets[i].uuid}`,sha256:createHash('sha256').update(i===0?Buffer.concat([imageBytes,Buffer.from('before')]):imageBytes).digest('hex'),source_sha256:'b'.repeat(64),run_id:stage};
  const manifest={head_sha:'abc',pairs:[pair]};
  const pr={...initial,body:`<!-- arcadia-visual-evidence:v1\n${JSON.stringify(manifest)}\n-->\n![mac before](${pair.before.url})\n![mac after](${pair.after.url})`};
  return {pr,manifest,pair,files:[{filename:'Arcadia/Arcadia/AlbumArtwork.swift'}],assets};
}
test('visual PR without embedded evidence is never queued',async()=>{
 const f=visualFixture();const r=await run(initial,{},0,null,f);
 assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'));
});
test('stale-head evidence is rejected before merge',async()=>{
 const f=visualFixture();f.pr.body=f.pr.body.replace('"head_sha":"abc"','"head_sha":"old"');
 const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'));
});
test('missing image embed or inaccessible attachment cannot pass',async()=>{
 for(const mode of ['missing','inaccessible']) {
  const f=visualFixture();if(mode==='missing')f.pr.body=f.pr.body.replace('![mac before]','link');else f.inaccessible=true;
  const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'));
 }
});
test('changed attachment content cannot pass',async()=>{
 const f=visualFixture();f.bytes=Buffer.from('not the screenshot');
 const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'));
});
test('valid embedded, downloadable screenshots allow guarded queue',async()=>{
 const f=visualFixture();const r=await run(f.pr,{},0,null,f);
 assert.equal(r.exitCode,undefined);assert.ok(r.calls.some(c=>c.method==='POST'&&c.body.force_merge===false));
});

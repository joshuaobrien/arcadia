import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const workflow = readFileSync(new URL('../.gitea/workflows/auto-merge.yml', import.meta.url), 'utf8');
const source = ('const base =' + workflow.split('          const base =')[1].split('\n          JS')[0]).replace(/^          /gm, '');
const initial = { merge_base: 'before', state: 'open', merged: false, draft: false, title: 'Ready change', user: { login: 'arcadia-pilot-bot' }, base: { ref: 'main' }, head: { sha: 'abc', repo: { full_name: 'jj/arcadia' } } };
async function run(pr = initial, env = {}, errorStatus = 0, mergeError = null, evidence = {}) {
  const calls = [];
  let reads = 0;
  const process = { env: { MERGE_TOKEN: 'test-only', PR_NUMBER: '28', EVENT_HEAD: 'abc', ...env } };
  await vm.runInNewContext(source, {
    process, require, Buffer, console: { log() {}, error() {} }, AbortSignal,
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
      const failedMerge = options.method === 'POST' && mergeError;
      const status = failedMerge ? 409 : errorStatus || 200;
      if (url.includes('/attachments/')) return {ok: !evidence.inaccessible, arrayBuffer: async () => evidence.bytes ?? (parseInt(url.at(-1),16)%2 ? Buffer.concat([imageBytes,Buffer.from('before')]) : imageBytes)};
      if (!url.includes('/api/') && url.includes('/jj/arcadia/pulls/')) return {ok:true,text:async()=>evidence.html ?? evidence.manifest?.pairs.flatMap(p=>['before','after'].map(stage=>`<img alt="${p.platform} ${stage}" src="${p[stage].url}">`)).join('') ?? ''};
      const treeRef=url.split('/git/trees/')[1];
      const trees={abc:{tree:[{path:'Arcadia',sha:'native-after'}]},before:{tree:[{path:'Arcadia',sha:'native-before'}]}};
      for(const stage of ['before','after']) {
        trees['native-'+stage]={tree:[{path:'Arcadia',sha:'app-'+stage},{path:'Arcadia.xcodeproj',sha:'project-'+stage}]};
        trees['project-'+stage]={tree:[{path:'project.pbxproj',sha:'config-'+stage}]};
      }
      const isPR=url.endsWith('/pulls/28')&&options.method==='GET';
      if(isPR)reads++;
      const current=evidence.newHead&&reads>1?{...pr,head:{...pr.head,sha:'new-head'}}:evidence.withdrawn&&reads>1?{...pr,draft:true}:evidence.bodyRemoved&&reads>1?{...pr,body:'images removed'}:pr;
      const policy = { encoding: 'base64', size: 500, content: Buffer.from(JSON.stringify(evidence.policy ?? {version:1,waivers:[]})).toString('base64') };
      const result = url.includes('/contents/.gitea/evidence-waivers.json?ref=main') ? policy : treeRef ? trees[treeRef] : url.includes('/commits?') ? [] : url.includes('/files?') ? evidence.files ?? [] : url.endsWith('/assets') ? evidence.assets ?? [] : failedMerge ? { message: mergeError } : options.method === 'GET' ? current : options.method === 'PATCH' ? { ...pr, draft: false } : null;
      return { ok: status < 400, status, text: async () => JSON.stringify(result) };
    },
  });
  return { calls, exitCode: process.exitCode };
}
test('queues exact bot head without force and requires first-party checks', async () => {
  const { calls, exitCode } = await run();
  assert.equal(exitCode, undefined);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[3].body, { do: 'squash', head_commit_id: 'abc', merge_when_checks_succeed: true, force_merge: false });
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
test('draft and withdrawn work is never promoted or queued', async () => {
  for (const pr of [{...initial,draft:true}, {...initial,title:'WIP: Cancelled by Josh'}, {...initial,labels:[{name:'agent:cancelled'}]}]) {
    const r=await run(pr); assert.equal(r.exitCode,1);
    assert.ok(!r.calls.some(c=>c.method==='POST'||c.method==='PATCH'));
  }
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
  assert.equal(duplicate.exitCode, undefined); assert.equal(duplicate.calls.length, 4);
  for (const message of ['head out of date', 'merge push out of date', 'unknown conflict']) {
    const conflict = await run(initial, {}, 0, message);
    assert.equal(conflict.exitCode, 1); assert.equal(conflict.calls.length, 6);
  }
});

const imageBytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
function visualFixture() {
  const assets = Array.from({length:6},(_,i)=>({id:i+1,uuid:`00000000-0000-0000-0000-00000000000${i+1}`,size:imageBytes.length}));
  const pairs=['mac','iphone','duo'].map((platform,index)=>{
    const pair={platform};
    for(const [i,stage] of ['before','after'].entries()) {
      const asset=assets[index*2+i];
      pair[stage]={asset_id:asset.id,url:`https://joshs-mac-mini.tail81f644.ts.net/attachments/${asset.uuid}`,sha256:createHash('sha256').update(i===0?Buffer.concat([imageBytes,Buffer.from('before')]):imageBytes).digest('hex'),source_sha256:'b'.repeat(64),run_id:stage,app_tree_sha:'app-'+stage,project_sha:'config-'+stage};
    }
    return pair;
  });
  const manifest={head_sha:'abc',before_ref:'before',pairs};
  const pr={...initial};
  const update=()=>{pr.body=`<!-- arcadia-visual-evidence:v1\n${JSON.stringify(manifest)}\n-->\n`+pairs.flatMap(pair=>['before','after'].map(stage=>`![${pair.platform} ${stage}](${pair[stage].url})`)).join('\n');};
  update();
  return {pr,manifest,pair:pairs[0],files:[{filename:'Arcadia/Arcadia/AlbumArtwork.swift'}],assets,update};
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

test('shared native changes require all three platforms',async()=>{
 const f=visualFixture();f.manifest.pairs.splice(1);f.update();
 const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'));
});
test('old capture source cannot be relabelled with the new head',async()=>{
 const f=visualFixture();f.pair.after.app_tree_sha='old-app';f.update();
 const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'));
});
test('hidden markdown and evidence removal during verification fail closed and clear schedule',async()=>{
 for(const mode of ['hidden','removed']) {
  const f=visualFixture();if(mode==='hidden')f.html='';else f.bodyRemoved=true;
  const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,1);
  assert.equal(r.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/merge')),mode==='hidden');assert.ok(!r.calls.some(c=>c.method==='POST'));
 }
});
test('native view files without conventional suffixes still require evidence',async()=>{
 for(const name of ['CurrentPlaybackIndicator','LibraryPresentation','SongActions']) {
  const r=await run(initial,{},0,null,{files:[{filename:`Arcadia/Arcadia/${name}.swift`}]});
  assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'));
 }
});

test('superseded verifier preserves the newer head merge schedule',async()=>{
 const f=visualFixture();f.newHead=true;
 const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='DELETE'||c.method==='POST'));
});
test('current-head baseline cannot masquerade as before evidence',async()=>{
 const f=visualFixture();f.manifest.before_ref='abc';f.update();
 const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'));
});


test('audio fixture implementation needs behavioral evidence instead of screenshots', async () => {
  const r = await run(initial, {}, 0, null, { files: [{ filename: 'Arcadia/Arcadia/Development/FixtureAudio.swift' }] });
  assert.equal(r.exitCode, undefined);
  assert.ok(r.calls.some(c => c.method === 'POST'));
});
test('mixed or renamed visual files retain screenshot requirements', async () => {
  for (const files of [
    [{ filename: 'Arcadia/Arcadia/Development/FixtureAudio.swift' }, { filename: 'Arcadia/Arcadia/ContentView.swift' }],
    [{ filename: 'Arcadia/Arcadia/Development/FixtureAudio.swift', previous_filename: 'Arcadia/Arcadia/ContentView.swift' }],
    [{ filename: 'Arcadia/Arcadia/Development/FixtureArtwork.swift' }],
  ]) {
    const r = await run(initial, {}, 0, null, { files });
    assert.equal(r.exitCode, 1);
    assert.ok(!r.calls.some(c => c.method === 'POST'));
  }
});


test('Mac-only sidebar change accepts Mac evidence without phone captures', async()=>{
 const f=visualFixture(); f.files=[{filename:'Arcadia/Arcadia/NowPlayingSidebar.swift'}];f.manifest.pairs.splice(1);f.update();
 const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,undefined);assert.ok(r.calls.some(c=>c.method==='POST'));
});
test('shared or renamed changes cannot claim Mac-only scope',async()=>{
 for(const files of [
  [{filename:'Arcadia/Arcadia/NowPlayingSidebar.swift'},{filename:'Arcadia/Arcadia/AlbumArtwork.swift'}],
  [{filename:'Arcadia/Arcadia/NowPlayingSidebar.swift',previous_filename:'Arcadia/Arcadia/AlbumArtwork.swift'}]
 ]) {
  const f=visualFixture();f.files=files;f.manifest.pairs.splice(1);f.update();
  const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'));
 }
});
test('protected-main waiver is exact-head, expiring, and limited to listed platforms',async()=>{
 for(const mode of ['valid','wrong-head','expired','wrong-pr','wrong-platform','body-only']) {
  const f=visualFixture();f.manifest.pairs.pop();f.update();
  const waiver={pr:28,head_sha:'abc',expires_at:'2099-01-01T00:00:00Z',platforms:['duo'],reason:'Owner approved capture waiver'};
  if(mode==='wrong-head')waiver.head_sha='old';if(mode==='expired')waiver.expires_at='2020-01-01';if(mode==='wrong-pr')waiver.pr=29;if(mode==='wrong-platform')waiver.platforms=['mac'];
  if(mode!=='body-only')f.policy={version:1,waivers:[waiver]};else f.pr.body+='\nDuo waived by owner';
  const r=await run(f.pr,{},0,null,f);assert.equal(r.exitCode,mode==='valid'?undefined:1,mode);
 }
});

test('withdrawal during verification prevents enqueueing',async()=>{
 for(const f of [{withdrawn:true},Object.assign(visualFixture(),{withdrawn:true})]) {
  const r=await run(f.pr??initial,{},0,null,f);assert.equal(r.exitCode,1);assert.ok(!r.calls.some(c=>c.method==='POST'||c.method==='PATCH'));
 }
});

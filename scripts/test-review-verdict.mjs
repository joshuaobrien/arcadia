import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const workflow=readFileSync(new URL('../.gitea/workflows/review-verdict.yml',import.meta.url),'utf8');
const source=('const apiRoot ='+workflow.split('          const apiRoot =')[1].split('\n          JS')[0]).replace(/^          /gm,'');
const pr={state:'open',merged:false,user:{login:'arcadia-pilot-bot'},base:{ref:'main'},head:{sha:'abc',repo:{full_name:'jj/arcadia'}}};
const pass={id:1,user:{login:'arcadia-pilot-bot'},commit_id:'abc',state:'COMMENT',body:'Pass — reviewed exact head abc',stale:false,dismissed:false};
async function run(reviews=[],options={}) {
 const calls=[];let reads=0;
 const process={env:{MERGE_TOKEN:'test-only',PR_NUMBER:'28'}};
 await vm.runInNewContext(source,{process,console:{error(){}},AbortSignal,fetch:async(url,request={})=>{
  calls.push({url,method:request.method,body:request.body&&JSON.parse(request.body)});
  let value;
  if(url.includes('/reviews?'))value=reviews;
  else if(request.method==='POST')value={};
  else {reads++;value=options.foreign?{...pr,user:{login:'someone'}}:options.superseded&&reads>1?{...pr,head:{...pr.head,sha:'new'}}:pr;}
  return {ok:!options.apiFailure,status:options.apiFailure?503:200,text:async()=>JSON.stringify(value)};
 }});
 return {calls,exitCode:process.exitCode,status:calls.find(c=>c.url.includes('/statuses/'))?.body};
}
test('completed review without an explicit verdict remains pending',async()=>{
 for(const reviews of [[],[{...pass,body:'Reviewed the change'}]])assert.equal((await run(reviews)).status.state,'pending');
});
test('explicit pass publishes the constant protected status for this exact head',async()=>{
 const r=await run([pass]);assert.equal(r.status.state,'success');assert.equal(r.status.context,'agentconnect/arcadia-verdict');assert.match(r.calls.at(-1).url,/statuses\/abc$/);
});
test('a failing COMMENT cannot masquerade as a successful completed review',async()=>{
 assert.equal((await run([{...pass,body:'Fail — two changes needed'}])).status.state,'failure');
});
test('latest current-head verdict wins regardless of API order',async()=>{
 const fail={...pass,id:2,body:'Fail — unresolved finding'};
 for(const reviews of [[pass,fail],[fail,pass]])assert.equal((await run(reviews)).status.state,'failure');
 assert.equal((await run([fail,{...pass,id:3}])).status.state,'success');
});
test('stale, dismissed, wrong-head or wrong-author reviews cannot pass',async()=>{
 for(const review of [{...pass,stale:true},{...pass,dismissed:true},{...pass,commit_id:'old'},{...pass,user:{login:'other'}}])assert.equal((await run([review])).status.state,'pending');
});
test('formal request-changes blocks even with misleading pass prose',async()=>assert.equal((await run([{...pass,state:'REQUEST_CHANGES'}])).status.state,'failure'));
test('superseded head and foreign PR cannot receive a passing status',async()=>{
 for(const options of [{superseded:true},{foreign:true}])assert.equal((await run([pass],options)).status,undefined);
});
test('API failure never publishes success',async()=>{
 const r=await run([pass],{apiFailure:true});assert.equal(r.exitCode,1);assert.equal(r.status,undefined);
});

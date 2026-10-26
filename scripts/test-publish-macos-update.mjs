import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {appcast} from './publish-macos-update.mjs';

const sha='a'.repeat(40);
test('appcast has a monotonic version and signed enclosure, with XML escaping', () => {
  const feed=appcast({version:'42',sha,url:'https://host/a?b=1&c=2',signature:'signature',length:99});
  assert.match(feed, /<sparkle:version>42<\/sparkle:version>/);
  assert.match(feed, /b=1&amp;c=2/);
  assert.match(feed, /sparkle:edSignature="signature"/);
  assert.throws(()=>appcast({version:'0',sha}),/identity/);
});

for (const scenario of ['publish','private','superseded','older','conflict','bad-signature','wrong-tag','upload-fails']) {
  test('public publishing command: '+scenario, async () => {
    const directory=await mkdtemp(join(tmpdir(),'arcadia-publisher-test-'));
    let feedWrites=0, upload=0, signCalls=0, reads=0;
    const requests=[];
    const server=createServer(async(req,res)=>{
      requests.push(req.method+' '+req.url);
      const chunks=[]; for await(const c of req) chunks.push(c);
      const body=Buffer.concat(chunks).toString();
      function answer(status,value) {res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
      const route=req.url;
      if (route==='/api') return answer(200,{private:scenario==='private'});
      if (route==='/api/branches/main') return answer(200,{commit:{id:scenario==='superseded'?'b'.repeat(40):sha}});
      if (route==='/api/releases/tags/macos-42') return answer(404,{});
      if (route==='/api/releases' && req.method==='POST') {assert.equal(JSON.parse(body).target_commitish,sha);return answer(201,{id:1});}
      if (route==='/api/git/refs/tags/macos-42') return answer(200,[{ref:'refs/tags/macos-42',object:{sha:scenario==='wrong-tag'?'c'.repeat(40):sha}}]);
      if (route==='/api/releases/1/assets') return answer(200,[]);
      if (route==='/api/releases/1/assets?name=Arcadia-42.zip') {upload++;return answer(scenario==='upload-fails'?500:201,{id:1,size:7,uuid:'00000000-0000-0000-0000-000000000001'});}
      if (route==='/attachments/00000000-0000-0000-0000-000000000001') {res.end('archive');return;}
      if (route==='/api/branches/macos-updates') return answer(200,{name:'macos-updates'});
      if (route==='/api/contents/appcast.xml?ref=macos-updates') {
        reads++;
        return answer(200,{sha:'feed-'+reads,content:Buffer.from(`<sparkle:version>${scenario==='older'?43:41}</sparkle:version>`).toString('base64')});
      }
      if (route==='/api/contents/appcast.xml' && req.method==='PUT') {
        feedWrites++;
        if(scenario==='conflict' && feedWrites===1) return answer(409,{});
        const data=JSON.parse(body);
        assert.equal(data.sha,'feed-'+reads);
        assert.match(Buffer.from(data.content,'base64').toString(),/signed-feed/);
        return answer(200,{});
      }
      return answer(500,{unexpected:route});
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const archive=join(directory,'archive.zip');await writeFile(archive,'archive');
      const signer=join(directory,'sign');
      await writeFile(signer, `#!/bin/sh\nread private\n[ "$private" = test-only-secret ] || exit 2\n${scenario==='bad-signature'?'exit 1\n':''}if [ "$3" = -p ]; then echo signature; else echo '<!-- signed-feed -->' >> "$3"; fi\n`,{mode:0o700});
      const url='http://127.0.0.1:'+server.address().port;
      const entry=join(directory,'publisher.mjs');await symlink(resolve('scripts/publish-macos-update.mjs'),entry);
      const child=spawn(process.execPath,[entry,signer,archive,sha,'42'],{
        env:{...process.env,ARCADIA_UPDATE_API:url+'/api',ARCADIA_UPDATE_PUBLIC_REPO:url,ARCADIA_UPDATE_TOKEN:'test-only-token',ARCADIA_UPDATE_KEY:'test-only-secret'},stdio:['ignore','pipe','pipe']
      });
      let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
      const exit=await new Promise(resolve=>child.on('exit',resolve));
      assert.doesNotMatch(output,/test-only-secret|test-only-token/);
      if(['private','bad-signature','wrong-tag','upload-fails'].includes(scenario)) {assert.equal(exit,1,output);assert.equal(feedWrites,0);}
      else {assert.equal(exit,0,output);assert.equal(feedWrites,scenario==='publish'?1:scenario==='conflict'?2:0);}
      if(scenario==='superseded') {assert.equal(upload,0);assert.equal(requests.length,2);}
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
  });
}

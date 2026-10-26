import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const publicRepo = 'https://joshs-mac-mini.tail81f644.ts.net/jj/arcadia';
const namespace = 'http://www.andymatuschak.org/xml-namespaces/sparkle';
const xml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]));

export function appcast({version, sha, url, signature, length}) {
  if (!/^[1-9][0-9]*$/.test(version) || !/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid release identity');
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="${namespace}"><channel>
<title>Arcadia for macOS</title><link>${publicRepo}</link><description>Main builds</description>
<item><title>Arcadia ${version}</title><description>Build ${sha}</description>
<sparkle:version>${version}</sparkle:version><sparkle:shortVersionString>1.0 (${version})</sparkle:shortVersionString>
<sparkle:minimumSystemVersion>26.0</sparkle:minimumSystemVersion>
<enclosure url="${xml(url)}" length="${length}" type="application/octet-stream" sparkle:edSignature="${xml(signature)}"/>
</item></channel></rss>\n`;
}

export async function publish({api, token, archive, sha, version, sign, key, publicURL = publicRepo}) {
  if (!/^[1-9][0-9]*$/.test(version) || !/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid release identity');
  if (!token || !key) throw Error('Update publishing credentials are missing');
  const base = new URL(api);
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) throw Error('Publishing requires HTTPS');
  async function request(path, method='GET', body, raw=false) {
    const response = await fetch(api + path, {
      method, redirect:'error', signal:AbortSignal.timeout(60000),
      headers:{Authorization:'token '+token, ...(body === undefined ? {} : {'Content-Type':raw ? 'application/zip':'application/json'})},
      body:body === undefined ? undefined : raw ? body : JSON.stringify(body)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`Gitea ${method} ${path.split('?')[0]} failed (${response.status})`);
    return response.status === 204 ? {} : response.json();
  }
  async function mainIsCurrent() {
    const main = await request('/branches/main');
    return main?.commit?.id === sha;
  }
  if (!await mainIsCurrent()) { console.log('Skip superseded main build'); return; }
  // One immutable release per verified source revision; never replace its archive.
  const tag = 'macos-' + version;
  let release = await request('/releases/tags/' + tag);
  if (!release) release = await request('/releases', 'POST', {
    tag_name:tag, target_commitish:sha, name:`Arcadia macOS ${version}`,
    body:`Verified main build ${sha}. Sparkle installs the signed macOS archive.`, draft:false, prerelease:true
  });
  const tagInfo = await request('/git/refs/tags/' + tag);
  if (!tagInfo?.some(ref => ref.ref === 'refs/tags/' + tag && ref.object?.sha === sha)) throw Error('Release tag does not identify this source revision');
  const name = `Arcadia-${version}.zip`;
  const assets = await request(`/releases/${release.id}/assets`);
  let asset = assets.find(a => a.name === name);
  const bytes = await readFile(archive);
  if (!asset) {
    const form = new FormData();
    form.append('attachment', new Blob([bytes], {type:'application/zip'}), name);
    const response = await fetch(`${api}/releases/${release.id}/assets?name=${name}`, {
      method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{Authorization:'token '+token},body:form
    });
    if (!response.ok) throw Error(`Archive upload failed (${response.status})`);
    asset = await response.json();
  }
  // Always sign the bytes Gitea serves, including an earlier successful run of this revision.
  const url = `${publicURL}/releases/download/${tag}/${name}`;
  const served = await fetch(url, {redirect:'error',signal:AbortSignal.timeout(120000)});
  if (!served.ok) throw Error('Published archive is unavailable');
  const servedBytes = Buffer.from(await served.arrayBuffer());
  if (servedBytes.length !== asset.size) throw Error('Published archive length mismatch');
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-update-'));
  try {
    const file = join(directory, 'Arcadia.zip');
    await writeFile(file, servedBytes);
    function signed(path, signatureOnly) {
      const result = spawnSync(sign, ['--ed-key-file','-', ...(signatureOnly ? ['-p'] : []), path], {input:key+'\n',encoding:'utf8',timeout:60000});
      if (result.status !== 0) throw Error('Sparkle signing failed');
      return result.stdout.trim();
    }
    const signature = signed(file, true);
    const feed = join(directory, 'appcast.xml');
    await writeFile(feed, appcast({version, sha, url, signature, length:servedBytes.length}));
    signed(feed, false);
    const content = (await readFile(feed)).toString('base64');
    // Gitea's content SHA is a compare-and-swap: cancellation/races leave the old feed intact.
    let branch = await request('/branches/macos-updates');
    if (!branch) branch = await request('/branches', 'POST', {new_branch_name:'macos-updates',old_ref_name:sha});
    for (let attempt=0; attempt<3; attempt++) {
      const previous = await request('/contents/appcast.xml?ref=macos-updates');
      const previousXml = previous?.content ? Buffer.from(previous.content,'base64').toString() : '';
      const oldVersion = previousXml.match(/<sparkle:version>([0-9]+)<\/sparkle:version>/)?.[1];
      if (oldVersion && BigInt(oldVersion) >= BigInt(version)) { console.log('Update channel already at this build or newer'); return; }
      if (!await mainIsCurrent()) { console.log('Skip superseded channel publication'); return; }
      try {
        await request('/contents/appcast.xml', previous ? 'PUT':'POST', {
          branch:'macos-updates',content,message:`Publish verified macOS build ${version} (${sha})`,
          ...(previous ? {sha:previous.sha} : {})
        });
        console.log(`Published signed macOS update ${version}: ${url}`);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  } finally { await rm(directory, {recursive:true,force:true}); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sign, archive, sha, version] = process.argv.slice(2);
  try {
    await publish({api:process.env.ARCADIA_UPDATE_API || publicRepo.replace('/jj/arcadia','/api/v1/repos/jj/arcadia'),
      publicURL:process.env.ARCADIA_UPDATE_PUBLIC_REPO || publicRepo, token:process.env.ARCADIA_UPDATE_TOKEN, key:process.env.ARCADIA_UPDATE_KEY, sign,archive,sha,version});
  } catch (error) { console.error(error.message); process.exitCode=1; }
}

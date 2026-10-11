#!/usr/bin/env python3
"""Task-owned direct Jellyfin fixture. Runs on the VM host, not in CI by default."""
import argparse
import json
import secrets
import subprocess
import time
import urllib.request
from pathlib import Path

IMAGE = 'jellyfin/jellyfin@sha256:c2544f368e2e6c317832caebe96c375f5161b8ab73e2a041f6cf4af519d58805'

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['start', 'stop'])
    parser.add_argument('--root', required=True)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=18096)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    state = root / 'fixture.json'
    if args.operation == 'stop':
        data = json.loads(state.read_text())
        name = data['container']
        if docker('inspect', '--format', '{{index .Config.Labels "arcadia.task"}}', name) != str(root):
            raise RuntimeError('Fixture ownership mismatch; refusing cleanup')
        docker('rm', '-f', name)
        print('Owned Jellyfin container removed; disposable files remain for evidence export.')
        return
    root.mkdir(parents=True, mode=0o700, exist_ok=False)
    for directory in ['config', 'cache', 'music']:
        (root / directory).mkdir()
    name = 'arcadia-jellyfin-' + secrets.token_hex(4)
    password = secrets.token_hex(20)
    data = {'container':name, 'server':f'http://{args.bind}:{args.port}', 'username':'arcadia', 'password':password, 'image':IMAGE}
    state.write_text(json.dumps(data)); state.chmod(0o600)
    docker('run', '-d', '--name', name, '--label', 'arcadia.task='+str(root),
           '-p', f'{args.bind}:{args.port}:8096', '-v', str(root/'config')+':/config',
           '-v', str(root/'cache')+':/cache', '-v', str(root/'music')+':/music', IMAGE)
    base = data['server']
    authorization = 'MediaBrowser Client="ArcadiaFixture", Device="TaskVM", DeviceId="arcadia-fixture", Version="1"'
    def request(path, body=None, method=None):
        headers={'Content-Type':'application/json','Authorization':authorization}
        req=urllib.request.Request(base+path, headers=headers, data=json.dumps(body).encode() if body is not None else None, method=method)
        with urllib.request.urlopen(req, timeout=20) as response:
            payload=response.read()
            return json.loads(payload) if payload else None
    deadline=time.monotonic()+180
    while True:
        try:
            info=request('/System/Info/Public')
            if 'Version' in info:break
        except Exception:
            if time.monotonic()>deadline:raise
            time.sleep(2)
    if info['Version'] != '12.2.0':
        raise RuntimeError('Fixture version does not match pinned integration baseline')
    request('/Startup/Configuration', {'ServerName':'Arcadia disposable music', 'UICulture':'en-US','MetadataCountryCode':'US','PreferredMetadataLanguage':'en'}, 'POST')
    request('/Startup/User')
    request('/Startup/User', {'Name':data['username'],'Password':password}, 'POST')
    request('/Startup/RemoteAccess', {'EnableRemoteAccess':True,'EnableAutomaticPortMapping':False}, 'POST')
    request('/Startup/Complete', method='POST')
    auth=request('/Users/AuthenticateByName', {'Username':data['username'],'Pw':password}, 'POST')
    authorization+=', Token="'+auth['AccessToken']+'"'
    for album in range(1,25):
        title='Orb Sessions' if album==1 else f'Fixture Album {album:02}'
        folder='/music/Arcadia Test Ensemble/'+title
        docker('exec', name, 'mkdir', '-p', folder)
        docker('exec',name,'/usr/lib/jellyfin-ffmpeg/ffmpeg','-hide_banner','-loglevel','error','-y',
               '-f','lavfi','-i','color=c=0x405b72:s=300x300','-frames:v','1',folder+'/cover.jpg')
        for track in range(1,4) if album==1 else range(1,2):
            song=['First Contact','Persistent State','Range Request'][track-1]
            docker('exec',name,'/usr/lib/jellyfin-ffmpeg/ffmpeg','-hide_banner','-loglevel','error','-y',
                   '-f','lavfi','-i',f'sine=frequency={440+track*80}:duration=12', '-c:a','libmp3lame',
                   '-metadata','title='+song,'-metadata','artist=Arcadia Test Ensemble','-metadata','album='+title,
                   '-metadata','album_artist=Arcadia Test Ensemble','-metadata','track='+str(track),
                   '-metadata','date=2026',folder+f'/{track:02}.mp3')
    request('/Library/VirtualFolders?name=Music&collectionType=music&refreshLibrary=true',
            {'LibraryOptions':{'PathInfos':[{'Path':'/music'}],'EnableInternetProviders':False,
                               'TypeOptions':[{'Type':'MusicAlbum','MetadataFetchers':[],'ImageFetchers':[]},
                                              {'Type':'MusicArtist','MetadataFetchers':[],'ImageFetchers':[]}]}},'POST')
    user=auth['User']['Id']
    deadline=time.monotonic()+180
    while True:
        albums=request(f'/Users/{user}/Items?Recursive=true&IncludeItemTypes=MusicAlbum&Limit=30')
        if albums['TotalRecordCount']==24:break
        if time.monotonic()>deadline:raise RuntimeError('Fixture library did not contain 24 albums')
        time.sleep(2)
    data['version']=info['Version'];data['album_count']=24
    state.write_text(json.dumps(data));state.chmod(0o600)
    (root/'evidence.json').write_text(json.dumps({k:v for k,v in data.items() if k!='password'},indent=2))
    print(json.dumps({'version':info['Version'],'albums':24,'server':base,'image':IMAGE}))

if __name__ == '__main__':
    main()

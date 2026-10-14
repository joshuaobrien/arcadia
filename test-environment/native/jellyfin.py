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
    parser.add_argument('--artist-count', type=int, choices=[1,23], default=1)
    parser.add_argument('--sustained-seconds', type=int, help='Isolated one-track600Hz fixture for native pose continuity')
    args = parser.parse_args()
    if args.sustained_seconds is not None and not 240 <= args.sustained_seconds <= 3600:
        parser.error('sustained-seconds must be240...3600')
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
    expected_albums = 1 if args.sustained_seconds else 24
    for album in range(1,expected_albums+1):
        title='Orb Sessions' if album==1 else f'Fixture Album {album:02}'
        artist = 'Arcadia Test Ensemble' if args.artist_count == 1 or album <= 2 else f'Fixture Artist {album-1:02}'
        folder='/music/'+artist+'/'+title
        docker('exec', name, 'mkdir', '-p', folder)
        docker('exec',name,'/usr/lib/jellyfin-ffmpeg/ffmpeg','-hide_banner','-loglevel','error','-y',
               '-f','lavfi','-i','color=c=0x405b72:s=300x300','-frames:v','1',folder+'/cover.jpg')
        for track in (range(2,3) if args.sustained_seconds else (range(1,4) if album==1 else range(1,2))):
            song=['First Contact','Persistent State','Range Request'][track-1]
            docker('exec',name,'/usr/lib/jellyfin-ffmpeg/ffmpeg','-hide_banner','-loglevel','error','-y',
                   '-f','lavfi','-i',(
                     f'sine=frequency=600:duration={args.sustained_seconds}' if args.sustained_seconds else (
                       'sine=frequency=520:duration=10[a];sine=frequency=600:duration=10[b];'
                       'sine=frequency=680:duration=10[c];[a][b][c]concat=n=3:v=0:a=1'
                       if album == 1 and track == 1 else f'sine=frequency={440+track*80}:duration=12'
                     )
                   ), '-c:a','libmp3lame',
                   '-metadata','title='+song,'-metadata','artist='+artist,'-metadata','album='+title,
                   '-metadata','album_artist='+artist,'-metadata','track='+str(track),
                   '-metadata','date=2026',folder+f'/{track:02}.mp3')
    request('/Library/VirtualFolders?name=Music&collectionType=music&refreshLibrary=true',
            {'LibraryOptions':{'PathInfos':[{'Path':'/music'}],'EnableInternetProviders':False,
                               'TypeOptions':[{'Type':'MusicAlbum','MetadataFetchers':[],'ImageFetchers':[]},
                                              {'Type':'MusicArtist','MetadataFetchers':[],'ImageFetchers':[]}]}},'POST')
    user=auth['User']['Id']
    deadline=time.monotonic()+180
    while True:
        albums=request(f'/Users/{user}/Items?Recursive=true&IncludeItemTypes=MusicAlbum&Limit=30')
        if albums['TotalRecordCount']==expected_albums:break
        if time.monotonic()>deadline:raise RuntimeError(f'Fixture library did not contain {expected_albums} albums')
        time.sleep(2)
    if args.sustained_seconds:
        tracks=request(f'/Users/{user}/Items?Recursive=true&IncludeItemTypes=Audio')['Items']
        if len(tracks)!=1 or tracks[0]['Name']!='Persistent State':
            raise RuntimeError('Sustained fixture must contain one controlled track')
        import hashlib
        media=root/'music/Arcadia Test Ensemble/Orb Sessions/02.mp3'
        data.update(secondSongID=tracks[0]['Id'], serverID=info['Id'],
                    duration_seconds=args.sustained_seconds, expected_hz=600,
                    media_sha256=hashlib.sha256(media.read_bytes()).hexdigest())
    elif args.artist_count == 23:
        artists=request(f'/Artists?UserId={user}&Limit=100')
        if artists['TotalRecordCount'] != 23 or len({item['Id'] for item in artists['Items']}) != 23:
            raise RuntimeError('Richer fixture did not contain 23 distinct artists')
        artist=next(item for item in artists['Items'] if item['Name']=='Arcadia Test Ensemble')
        last=next(item for item in artists['Items'] if item['Name']=='Fixture Artist 23')
        album=next(item for item in albums['Items'] if item['Name']=='Orb Sessions')
        tracks=request(f'/Items?UserId={user}&ParentId={album["Id"]}&IncludeItemTypes=Audio')['Items']
        data.update({'artistID':artist['Id'],'lastArtistID':last['Id'],'albumID':album['Id'],
                     'firstSongID':next(item['Id'] for item in tracks if item['Name']=='First Contact'),
                     'secondSongID':next(item['Id'] for item in tracks if item['Name']=='Persistent State')})
    data['version']=info['Version'];data['album_count']=expected_albums;data['artist_count']=args.artist_count
    state.write_text(json.dumps(data));state.chmod(0o600)
    (root/'evidence.json').write_text(json.dumps({k:v for k,v in data.items() if k!='password'},indent=2))
    print(json.dumps({'version':info['Version'],'albums':expected_albums,'server':base,'image':IMAGE}))

if __name__ == '__main__':
    main()

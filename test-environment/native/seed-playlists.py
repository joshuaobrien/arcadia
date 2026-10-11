#!/usr/bin/env python3
"""Seed ordered playlists only in the explicitly owned disposable fixture."""
import argparse
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
args = parser.parse_args()
root = Path(args.root).resolve()
config = json.loads((root / 'fixture.json').read_text())
if config.get('version') != '12.2.0' or not config.get('container', '').startswith('arcadia-jellyfin-'):
    raise SystemExit('Only the owned Jellyfin12.2 fixture may be seeded')
base = config['server']
headers = {'Content-Type': 'application/json', 'Authorization': 'MediaBrowser Client="Arcadia fixture", Device="fixture", DeviceId="playlist54", Version="1"'}
def request(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        content = response.read()
        return json.loads(content) if content else None
session = request('/Users/AuthenticateByName', {'Username': config['username'], 'Pw': config['password']})
headers['Authorization'] += ', Token="' + session['AccessToken'] + '"'
user = session['User']['Id']
albums = request('/Items?UserId=' + user + '&Recursive=true&IncludeItemTypes=MusicAlbum&Limit=100')['Items']
config['albumID'] = next(item['Id'] for item in albums if item['Name'] == 'Orb Sessions')
artists = request('/Artists?UserId=' + user + '&Limit=100')['Items']
config['artistID'] = next(item['Id'] for item in artists if item['Name'] == 'Arcadia Test Ensemble')
config['lastArtistID'] = next(item['Id'] for item in artists if item['Name'] == 'Fixture Artist 23')
tracks = request('/Items?UserId=' + user + '&ParentId=' + config['albumID'] + '&IncludeItemTypes=Audio')['Items']
config['firstSongID'] = next(item['Id'] for item in tracks if item['Name'] == 'First Contact')
config['secondSongID'] = next(item['Id'] for item in tracks if item['Name'] == 'Persistent State')
third = next(item['Id'] for item in tracks if item['Name'] == 'Range Request')
sequence = [config['secondSongID'], config['firstSongID'], config['secondSongID'], third] * 6
existing = request('/Items?UserId=' + user + '&Recursive=true&IncludeItemTypes=Playlist&Limit=100')['Items']
existing_by_name = {item['Name']: item['Id'] for item in existing}
created = []
for number in range(24):
    title = 'Fixture Mix' if number == 0 else ('Fixture Empty' if number == 1 else f'Fixture List {number:02}')
    ids = sequence if number == 0 else ([] if number == 1 else [config['firstSongID']])
    if title in existing_by_name:
        created.append(existing_by_name[title])
    else:
        playlist = request('/Playlists', {'Name': title, 'Ids': ids, 'UserId': user, 'MediaType': 'Audio', 'IsPublic': False})
        created.append(playlist['Id'])
ordered = request('/Playlists/' + created[0] + '/Items?UserId=' + user + '&Limit=100')['Items']
if [item['Id'] for item in ordered] != sequence:
    raise SystemExit('The disposable playlist did not preserve declared occurrence order')
# Jellyfin12.2 repeats PlaylistItemId for repeated songs; absolute source order
# is part of Arcadia occurrence identity so none are lost during paging.
config.update({'playlistID': created[0], 'emptyPlaylistID': created[1], 'playlistSongIDs': sequence})
(root / 'fixture.json').write_text(json.dumps(config))
(root / 'fixture.json').chmod(0o600)
(root / 'playlist-evidence.json').write_text(json.dumps({'playlistCount': 24, 'mixCount': 24, 'mixSongIDs': sequence, 'version': config['version']}, indent=2))
print('Verified 24 disposable playlists with ordered duplicate song occurrences')

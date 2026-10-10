"""Name app screenshots consistently and prepare a before/after comparison."""
import json
from pathlib import Path
import shutil
import struct


def dimensions(path):
    data = Path(path).read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError('Screenshot must be a PNG')
    return struct.unpack('>II', data[16:24])


def capture(directory, run_id, label, test, name=None):
    directory = Path(directory)
    attachments = directory / 'artifacts' / run_id / 'tests-attachments'
    candidates = []
    for group in json.loads((attachments / 'manifest.json').read_text()):
        if group['testIdentifier'].removesuffix('()') != '/'.join(test.split('/')[1:]):
            continue
        for item in group['attachments']:
            if item['isAssociatedWithFailure'] or not item['exportedFileName'].endswith('.png'):
                continue
            if name and not item['suggestedHumanReadableName'].startswith(name + '_'):
                continue
            path = attachments / item['exportedFileName']
            if path.name != item['exportedFileName']:
                raise ValueError('Invalid screenshot filename')
            candidates.append(path)
    if len(candidates) != 1:
        raise ValueError('Capture needs exactly one screenshot; use --screenshot-name to select one')
    destination = directory / 'comparison'
    destination.mkdir(exist_ok=True)
    size = dimensions(candidates[0])
    other = destination / ('after.png' if label == 'before' else 'before.png')
    if other.exists() and dimensions(other) != size:
        raise ValueError('Before/after window sizes differ; recapture at the same size')
    shutil.copy2(candidates[0], destination / (label + '.png'))
    metadata_path = destination / 'manifest.json'
    metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
    metadata[label] = {'run_id': run_id, 'test': test, 'size': list(size)}
    metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    (destination / 'README.md').write_text('| Before | After |\n| --- | --- |\n| ![Before](before.png) | ![After](after.png) |\n')
    return destination

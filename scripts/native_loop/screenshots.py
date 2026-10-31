"""Name app screenshots consistently and prepare a before/after comparison."""
import json
import hashlib
import os
import sys
import tarfile
from pathlib import Path
import shutil
import struct


def dimensions(path):
    data = Path(path).read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError('Screenshot must be a PNG')
    return struct.unpack('>II', data[16:24])


def attachment_image(attachments, test, name=None):
    attachments = Path(attachments)
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
    return candidates[0]


def capture(directory, run_id, label, test, name=None):
    directory = Path(directory)
    attachments = directory / 'artifacts' / run_id / 'tests-attachments'
    candidates = [attachment_image(attachments, test, name)]
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


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def record_integrity(workspace, archive_path, output):
    expected = {}
    with tarfile.open(archive_path) as archive:
        for member in archive:
            if not member.isfile():
                continue
            name = Path(member.name)
            if name.is_absolute() or '..' in name.parts:
                raise ValueError('Unsafe source archive entry')
            expected[member.name] = hashlib.sha256(archive.extractfile(member).read()).hexdigest()
    intact = all((workspace / name).is_file() and file_hash(workspace / name) == sha for name, sha in expected.items())
    output.write_text(json.dumps({'source_sha256': file_hash(archive_path), 'files': expected,
                                  'unchanged_after_test': intact}) + '\n')
    if not intact:
        raise ValueError('Tests changed pinned source inputs')


def seal_attachments(directory):
    receipt_path = directory / 'verification.json'
    integrity_path = directory / 'source-integrity.json'
    if not receipt_path.exists() or not integrity_path.exists():
        return  # Old runs remain exportable diagnostics, but cannot claim sealed evidence.
    receipt = json.loads(receipt_path.read_text())
    integrity = json.loads(integrity_path.read_text())
    if receipt.get('verified') is not True or integrity.get('unchanged_after_test') is not True or integrity.get('source_sha256') != receipt.get('source_sha256'):
        return
    attachments = directory / 'tests-attachments'
    manifest = attachments / 'manifest.json'
    if not manifest.exists():
        return
    hashes = {}
    for group in json.loads(manifest.read_text()):
        for item in group['attachments']:
            name = item['exportedFileName']
            if not name.endswith('.png'):
                continue
            path = attachments / name
            if Path(name).name != name or path.is_symlink():
                raise ValueError('Invalid screenshot filename')
            hashes[name] = file_hash(path)
    fields = {'attachment_manifest_sha256': file_hash(manifest), 'attachment_sha256': hashes}
    if 'attachment_sha256' in receipt:
        if any(receipt.get(key) != value for key, value in fields.items()):
            raise ValueError('Previously sealed XCTest attachments changed')
        return
    receipt.update(fields)
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    if sys.argv[1] == 'seal':
        seal_attachments(Path(sys.argv[2]))
    elif sys.argv[1] == 'integrity':
        record_integrity(*map(Path, sys.argv[2:]))
    else:
        raise SystemExit('Unknown screenshot proof operation')

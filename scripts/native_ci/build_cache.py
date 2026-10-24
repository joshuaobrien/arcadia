"""Checksummed dependency seeds shared through a task-private mount."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
from native_loop.dependencies import stage


def extract(seed, destination):
    with tarfile.open(seed) as archive:
        for member in archive:
            target = (destination / member.name).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError('Unsafe cache path')
            if not (member.isfile() or member.isdir() or member.issym()):
                raise ValueError('Unsafe cache member')
            if member.issym() and not (target.parent / member.linkname).resolve().is_relative_to(destination.resolve()):
                raise ValueError('Unsafe cache symlink')
        archive.extractall(destination)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['restore', 'publish'])
    parser.add_argument('--derived', type=Path, required=True)
    parser.add_argument('--shared', type=Path, required=True)
    parser.add_argument('--name', choices=['debug', 'release', 'ios'], required=True)
    args = parser.parse_args(argv)
    args.shared.mkdir(parents=True, exist_ok=True)
    seed = args.shared / (args.name + '.tgz')
    receipt = seed.with_suffix('.json')
    if args.operation == 'restore':
        hit = False
        if seed.is_file() and receipt.is_file():
            try:
                facts = json.loads(receipt.read_text())
                if facts['sha256'] != hashlib.sha256(seed.read_bytes()).hexdigest():
                    raise ValueError('Cache checksum mismatch')
                with tempfile.TemporaryDirectory() as tmp:
                    validated = Path(tmp) / 'derived'
                    validated.mkdir()
                    extract(seed, validated)
                    # A seed never owns the live derived directory until validation succeeds.
                    shutil.copytree(validated, args.derived, dirs_exist_ok=True, symlinks=True)
                hit = True
            except (OSError, ValueError, KeyError, tarfile.TarError) as error:
                print('[ci-cache] cold fallback: ' + str(error), flush=True)
        print('[ci-cache] ' + args.name + (' hit' if hit else ' miss'), flush=True)
        return 0
    if seed.is_file() and receipt.is_file():
        try:
            if json.loads(receipt.read_text())['sha256'] == hashlib.sha256(seed.read_bytes()).hexdigest():
                print('[ci-cache] retained compatible ' + args.name, flush=True)
                return 0
        except (OSError, ValueError, KeyError):
            pass
    if not args.derived.is_dir():
        print('[ci-cache] no dependency products to publish', flush=True)
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        staged = Path(tmp) / 'derived'
        stage(args.derived, staged)
        temporary = seed.with_suffix('.tmp')
        with tarfile.open(temporary, 'w:gz', compresslevel=1) as output:
            for child in staged.iterdir():
                output.add(child, arcname=child.name)
        os.replace(temporary, seed)
    receipt.write_text(json.dumps({'sha256': hashlib.sha256(seed.read_bytes()).hexdigest(),
                                  'scope': 'dependency products only'}) + '\n')
    print('[ci-cache] published ' + args.name, flush=True)
    return 0

"""Host-safe immutable native source archive verification shared by mobile drivers."""
import hashlib
import json
from pathlib import Path
import tarfile


def guard_source(repository, archive_path, report_path):
    mismatches = []
    count = 0
    repository = repository.resolve()
    with tarfile.open(archive_path) as archive:
        for entry in archive:
            if not entry.isfile():
                continue
            path = (repository / entry.name).resolve()
            if not path.is_relative_to(repository):
                raise RuntimeError('Unsafe source archive member')
            expected = hashlib.sha256(archive.extractfile(entry).read()).hexdigest()
            actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
            count += 1
            if actual != expected:
                mismatches.append(entry.name)
    report = {'source_guard_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'source_sha256': hashlib.sha256(archive_path.read_bytes()).hexdigest(),
              'checked_files': count, 'mismatches': mismatches, 'passed': count > 0 and not mismatches}
    report_path.write_text(json.dumps(report, indent=2))
    if not report['passed']:
        raise RuntimeError('Immutable source archive mismatch')


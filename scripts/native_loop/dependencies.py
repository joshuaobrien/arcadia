"""Versioned, private dependency seeds; no application outputs or runtime state."""
import hashlib
import shutil
from pathlib import Path

VERSION = 'dependencies-v4-module-maps'
# Only package products and build intermediates are reusable. Never Arcadia targets.
PACKAGES = {'swift-syntax', 'Mockable', 'mockable', 'xctest-dynamic-overlay'}


def cache_key(image, resolved, project):
    return hashlib.sha256(b'\0'.join([VERSION.encode(), image.encode(), resolved, project])).hexdigest()[:24]


def application_outputs(directory, names):
    return [name for name in names if name.startswith('Arcadia') or Path(name).suffix in {'.app', '.xctest', '.xctestrun'}]


def stage(source, target):
    source, target = Path(source), Path(target)
    target.mkdir(parents=True, exist_ok=True)
    for name in ('SourcePackages', 'ModuleCache.noindex', 'SDKStatCaches.noindex'):
        if (source / name).is_dir():
            shutil.copytree(source / name, target / name, symlinks=True, ignore=None if name == 'SourcePackages' else application_outputs)
    # Xcode's build database retains dependency signatures. It contains build metadata,
    # not application data. App target intermediates/products are deliberately omitted.
    intermediates = source / 'Build/Intermediates.noindex'
    if intermediates.exists():
        for entry in intermediates.iterdir():
            if entry.name in {'XCBuildData', 'ExplicitPrecompiledModules', 'SwiftExplicitPrecompiledModules', 'GeneratedModuleMaps'} or entry.name.removesuffix('.build') in PACKAGES:
                shutil.copytree(entry, target / 'Build/Intermediates.noindex' / entry.name, symlinks=True, ignore=application_outputs)
    products = source / 'Build/Products'
    if products.exists():
        for configuration in products.iterdir():
            if not configuration.is_dir():
                continue
            for entry in configuration.iterdir():
                if entry.name.startswith('Arcadia') or entry.suffix in {'.app', '.xctest', '.xctestrun'}:
                    continue
                destination = target / 'Build/Products' / configuration.name / entry.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                if entry.is_dir():
                    shutil.copytree(entry, destination, symlinks=True, ignore=application_outputs)
                else:
                    shutil.copy2(entry, destination)

#!/usr/bin/env python3
"""Assert actual captured Arcadia output against independent known fixture tones."""
import array
import json
import math
from pathlib import Path
import sys

root = Path(sys.argv[1])
chunks = json.loads((root / 'chunks.json').read_text())
phases = json.loads((root / 'phases.json').read_text())
raw = (root / 'captured-float32.raw').read_bytes()
expected = {'playing': 520, 'paused': None, 'resumed': 520, 'seeked': 680, 'advanced': 600}
summary = []
for phase in phases:
    selected = [chunk for chunk in chunks if phase['start'] + 0.5 < chunk['time'] < phase['end'] - 0.15]
    samples = array.array('f')
    for chunk in selected:
        values = array.array('f')
        values.frombytes(raw[chunk['offset']:chunk['offset'] + chunk['bytes']])
        samples.extend(values[::2])  # 48kHz stereo Float32, verified helper format.
    assert len(samples) > 20_000, f"{phase['name']}: no adequate rendered output capture"
    rms = math.sqrt(sum(float(value) ** 2 for value in samples) / len(samples))
    target = expected[phase['name']]
    bands = {}
    for frequency in (520, 600, 680):
        coefficient = 2 * math.cos(2 * math.pi * frequency / 48_000)
        first = second = 0.0
        for value in samples:
            next_value = value + coefficient * first - second
            second, first = first, next_value
        bands[frequency] = max(0, first * first + second * second - coefficient * first * second) / len(samples) ** 2
    if target is None:
        assert rms < 0.001, f"{phase['name']}: pause still rendered audible samples ({rms})"
    else:
        assert rms > 0.01, f"{phase['name']}: playback did not render actual audio ({rms})"
        strongest = max(bands, key=bands.get)
        assert strongest == target, f"{phase['name']}: rendered {strongest}Hz, expected {target}Hz"
        assert bands[target] > 3 * max(value for key, value in bands.items() if key != target), 'Ambiguous fixture identity'
    summary.append({'phase': phase['name'], 'samples': len(samples), 'rms': rms,
                    'expected_hz': target, 'power': bands})
assert {phase['name'] for phase in phases} == set(expected), 'Missing required transport phase'
(root / 'audio-assertions.json').write_text(json.dumps({'passed': True, 'phases': summary}, indent=2) + '\n')
print('PASS: actual app PCM verifies play, pause, resume, seek segment and natural next song')

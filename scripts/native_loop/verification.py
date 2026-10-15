"""Validate selected XCTest results and retain their actual identifiers."""
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlparse, unquote


def verify(tree, requested):
    cases = []
    def visit(node):
        if node.get('nodeType') == 'Test Case':
            path = unquote(urlparse(node.get('nodeIdentifierURL', '')).path)
            parts = path.strip('/').split('/')
            if len(parts) < 4:
                raise ValueError('Test result lacks a target-qualified identifier')
            identifier = '/'.join(parts[1:]).removesuffix('()')
            cases.append((identifier, node.get('result')))
        for child in node.get('children', []):
            visit(child)
    for node in tree.get('testNodes', []):
        visit(node)
    if not cases:
        raise ValueError('No executed tests')
    def matches(identifier, selection):
        return identifier == selection or identifier.startswith(selection + '/')
    for selection in requested:
        matched = [(identifier, outcome) for identifier, outcome in cases if matches(identifier, selection)]
        if not matched:
            raise ValueError('Missing requested test: ' + selection)
        # Optional skips in target/class selections remain visible; an exact requested
        # method must have passed, and every broad selection must contain a pass.
        if not any(outcome == 'Passed' for _, outcome in matched):
            raise ValueError('Requested tests did not pass: ' + repr(matched))
        if selection.count('/') == 2 and any(outcome != 'Passed' for _, outcome in matched):
            raise ValueError('Requested test was not Passed: ' + repr(matched))
    unexpected = [identifier for identifier, _ in cases if not any(matches(identifier, selection) for selection in requested)]
    if unexpected:
        raise ValueError('Unexpected executed tests: ' + repr(unexpected))
    if any(outcome not in {'Passed', 'Skipped'} for _, outcome in cases):
        raise ValueError('Non-passing test results: ' + repr(cases))
    return {'requested_tests': requested, 'executed_tests': sorted({identifier for identifier, _ in cases}),
            'results': [{'identifier': identifier, 'result': outcome} for identifier, outcome in cases]}


if __name__ == '__main__':
    output = Path(sys.argv[2])
    requested = [argument.removeprefix('-only-testing:') for argument in sys.argv[3:]]
    try:
        evidence = verify(json.loads(Path(sys.argv[1]).read_text()), requested)
    except ValueError as error:
        output.write_text(json.dumps({'requested_tests': requested, 'verified': False, 'error': str(error), 'source_sha256': os.environ.get('ARCADIA_SOURCE_SHA256'), 'test_tree': json.loads(Path(sys.argv[1]).read_text())}, indent=2) + '\n')
        raise SystemExit(str(error))
    evidence['source_sha256'] = os.environ.get('ARCADIA_SOURCE_SHA256')
    evidence['verified'] = True
    output.write_text(json.dumps(evidence, indent=2) + '\n')

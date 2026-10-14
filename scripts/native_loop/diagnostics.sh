#!/bin/bash
# Prints optional xcodebuild arguments, one per line. XCTest evidence stays enabled.
set -euo pipefail
case "${1:?Diagnostics policy required}" in
  full) exit 0 ;;
  targeted)
    help=$(xcodebuild -help 2>&1) || { echo 'Cannot inspect Xcode diagnostics support; retaining defaults' >&2; exit 0; }
    if [[ "$help" == *'-collect-test-diagnostics'* ]]; then
      printf '%s\n' -collect-test-diagnostics never
    else
      echo 'Xcode lacks diagnostics collection policy; retaining defaults' >&2
    fi
    ;;
  *) echo 'Unknown diagnostics policy' >&2; exit 2 ;;
esac

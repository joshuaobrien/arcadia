#!/usr/bin/env bash
set -euo pipefail
exec /usr/bin/python3 "$(dirname "$0")/sign-release.py" "${1:?App bundle required}"

#!/bin/bash
# Owns and reaps all guest capture helpers. Run before the explicit UI test.
set -euo pipefail
run=${1:?Run identifier required}
[[ "$run" =~ ^[A-Za-z0-9_-]+$ ]] || exit 2
runner_home=${ARCADIA_CAPTURE_RUNNER_HOME:-/Users/admin/Library/Containers/tokyo.drift.Arcadia.Development.xctrunner/Data}
root="$runner_home/tmp/arcadia-audio-capture-56"
keys="$runner_home/tmp/arcadia-media-keys-56"
lock="$runner_home/tmp/arcadia-capture-owner-56"
mkdir -p "$runner_home/tmp"
mkdir "$lock" || { echo 'Another capture session owns these guest helpers.'; exit 2; }
owned_pids=""
cleanup() {
  status=$?
  trap - EXIT INT TERM
  for phase in before after quiet; do touch "$root/$phase/done" 2>/dev/null || true; done
  if [[ "${owns_media:-0}" == 1 ]]; then touch "$keys/done" 2>/dev/null || true; fi
  for pid in $owned_pids; do
    for attempt in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      for attempt in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
      kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
    fi
    wait "$pid" || true
  done
  for phase in before after quiet; do rm -f "$root/$phase/armed"; done
  if [[ "${owns_media:-0}" == 1 ]]; then rm -f "$keys/armed"; fi
  rmdir "$lock"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Never delete the lock file inode; duplicate media producers cannot acquire it.
mkdir -p "$keys"
# Clear stale protocol files only while no legacy media owner holds its lock.
python3 - "$keys" <<'PYTHON'
import fcntl, pathlib, sys
root = pathlib.Path(sys.argv[1])
with (root / 'owner.lock').open('a') as owner:
    try:
        fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit('A media-key helper already owns this directory.')
    for name in ('request', 'completed', 'done', 'armed'):
        (root / name).unlink(missing_ok=True)
PYTHON
rm -rf "$root"
mkdir -p "$root/before" "$root/after" "$root/quiet"
media=${ARCADIA_MEDIA_KEY_HELPER:-/tmp/arcadia-media-key}
audio=${ARCADIA_AUDIO_CAPTURE_HELPER:-/tmp/AudioCapture.app/Contents/MacOS/pilot}
"$media" "$keys" > "$root/media-key.log" 2>&1 &
media_pid=$!
owned_pids="$media_pid"
for n in $(seq 1 40); do
  [[ "$(cat "$keys/owner.pid" 2>/dev/null || true)" == "$media_pid" ]] && break
  kill -0 "$media_pid" 2>/dev/null || { echo 'Media-key ownership was rejected.'; exit 2; }
  sleep 0.05
 done
[[ "$(cat "$keys/owner.pid" 2>/dev/null || true)" == "$media_pid" ]] || exit 2
owns_media=1
"$audio" "$root/before" --unmuted > "$root/before/helper.log" 2>&1 &
before_pid=$!
owned_pids="$owned_pids $before_pid"
wait "$before_pid"
owned_pids="$media_pid"
"$audio" "$root/quiet" --paused-output > "$root/quiet/helper.log" 2>&1 &
quiet_pid=$!
owned_pids="$owned_pids $quiet_pid"
"$audio" "$root/after" --unmuted > "$root/after/helper.log" 2>&1 &
after_pid=$!
owned_pids="$owned_pids $after_pid"
wait "$after_pid"
wait "$quiet_pid"
touch "$keys/done"
wait "$media_pid"
owned_pids=""
cp -R "$root" "/Volumes/My Shared Files/artifacts/$run-audio"
printf '%s\n' "all owned helpers reaped" > "/Volumes/My Shared Files/artifacts/$run-helper-cleanup.txt"

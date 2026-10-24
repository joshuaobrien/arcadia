#!/usr/bin/env bash
# Lint, build and test the native macOS app inside an ephemeral Tart VM.
#
# Runs on the mini's host runner: clones the golden Xcode image, copies the
# checkout in, runs the checks, then destroys the clone. The host never runs
# xcodebuild itself -- it only orchestrates.
#
# Host prerequisites: tart, and node (actions/checkout is a JavaScript action;
# in host mode there is no container to supply a runtime, so the job fails with
# "Cannot find: node in PATH" without it).

set -euo pipefail

if [[ "${ARCADIA_CI_MANAGED:-}" != 1 ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  exec python3 "$SCRIPT_DIR/ci-worker" \
    --template "${TART_IMAGE:-arcadia-ci-xcode-26-5-fastlane-2-241-1}" --source "${1:-$PWD}" \
    --artifacts "${CI_EVIDENCE_DIR:-${ARTIFACT_DIR:-$PWD/artifacts/native-mac}}" \
    -- bash "$SCRIPT_DIR/ci-native.sh" "$@"
fi

IMAGE="${TART_IMAGE:-ghcr.io/cirruslabs/macos-tahoe-xcode:26.5}"
VM="$ARCADIA_CI_VM"
VM_USER=admin
VM_PASS=admin
SRC_DIR="${1:-$PWD}"
ARTIFACT_DIR="${ARTIFACT_DIR:-}"
# SwiftLint is built from source by Mint at the Mintfile-pinned version, which
# takes ~5 minutes. Share a host directory as the Mint cache so that cost is
# paid once rather than on every run.
MINT_CACHE="${MINT_CACHE:-$HOME/.cache/arcadia-ci-mint}"
mkdir -p "$MINT_CACHE"

if [[ -n "$ARTIFACT_DIR" ]]; then
  [[ -n "${ARCADIA_BASE_URL:-}" ]] || {
    echo "ARCADIA_BASE_URL is required when producing a release artifact" >&2
    exit 1
  }
  mkdir -p "$ARTIFACT_DIR"
  ARTIFACT_DIR="$(cd "$ARTIFACT_DIR" && pwd)"
  rm -f "$ARTIFACT_DIR/Arcadia.zip"
fi

echo "==> Booting"
TART_RUN_ARGS=(--no-graphics --no-audio --no-clipboard "--dir=mint:$MINT_CACHE" "--dir=derived:$ARCADIA_CI_DERIVED_DIR" "--dir=evidence:$ARCADIA_CI_EVIDENCE_DIR")
if [[ -n "$ARTIFACT_DIR" ]]; then
  TART_RUN_ARGS+=("--dir=artifacts:$ARTIFACT_DIR")
fi
tart run "${TART_RUN_ARGS[@]}" "$VM" >/dev/null 2>&1 &

for _ in $(seq 1 60); do
  IP=$(tart ip "$VM" 2>/dev/null) && [ -n "$IP" ] && break
  sleep 2
done
[ -n "${IP:-}" ] || { echo "VM never got an IP"; exit 1; }

for _ in $(seq 1 60); do
  nc -z -G 2 "$IP" 22 2>/dev/null && break
  sleep 2
done
echo "==> VM up at $IP"

# The image ships fixed admin/admin credentials, so drive ssh with expect(1),
# which is part of macOS. sshpass has no bottle and needs a compiler.
# Note the password pattern must be brace-quoted: Tcl interpolates inside
# "..." and the interpolated form silently fails to match, hanging the run.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cat > "$WORK/ssh.exp" <<'EOF'
#!/usr/bin/expect -f
log_user 1
set timeout 2400
spawn -noecho ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o NumberOfPasswordPrompts=1 [lindex $argv 0]@[lindex $argv 1] [lindex $argv 2]
expect {
  -re {[Pp]assword} { send "[lindex $argv 3]\r"; exp_continue }
  timeout { puts "TIMED_OUT"; exit 1 }
  eof
}
catch wait result
exit [lindex $result 3]
EOF

cat > "$WORK/scp.exp" <<'EOF'
#!/usr/bin/expect -f
log_user 1
set timeout 900
spawn -noecho scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o NumberOfPasswordPrompts=1 [lindex $argv 0] [lindex $argv 1]@[lindex $argv 2]:[lindex $argv 3]
expect {
  -re {[Pp]assword} { send "[lindex $argv 4]\r"; exp_continue }
  timeout { puts "TIMED_OUT"; exit 1 }
  eof
}
catch wait result
exit [lindex $result 3]
EOF

chmod +x "$WORK"/*.exp
vm_run() { /usr/bin/expect -f "$WORK/ssh.exp" "$VM_USER" "$IP" "$1" "$VM_PASS"; }

echo "==> Copying source"
tar --format=pax -czf "$WORK/src.tgz" -C "$SRC_DIR" --exclude='.git' \
  Arcadia .swiftlint.yml .swift-format Mintfile Gemfile Gemfile.lock fastlane
/usr/bin/expect -f "$WORK/scp.exp" "$WORK/src.tgz" "$VM_USER" "$IP" /tmp/src.tgz "$VM_PASS"
vm_run "rm -rf /tmp/build && mkdir -p /tmp/build && tar xzf /tmp/src.tgz -C /tmp/build"

# Each step is its own ssh invocation, so a non-zero exit propagates via set -e.
echo "==> SwiftLint (Mintfile-pinned)"
# Tart mounts --dir shares automatically for macOS guests; there is no
# mount step to run. Pointing MINT_PATH at the share keeps the compiled
# SwiftLint on the host, so only the first run pays the ~5 minute build.
vm_run "cd /tmp/build && export PATH=/opt/homebrew/bin:\$PATH MINT_PATH='/Volumes/My Shared Files/mint/packages' MINT_LINK_PATH='/Volumes/My Shared Files/mint/bin' && MINT_NO_TTY=1 mint bootstrap && mint run swiftlint swiftlint lint --strict"

echo "==> swift-format"
vm_run "cd /tmp/build && xcrun swift-format lint --configuration .swift-format --recursive --strict Arcadia/Arcadia"

FASTLANE="export PATH=/opt/homebrew/opt/ruby@3.4/bin:/opt/homebrew/bin:\$PATH BUNDLE_GEMFILE=/tmp/build/Gemfile BUNDLE_PATH=/Users/admin/.cache/arcadia-fastlane BUNDLE_FROZEN=1 FASTLANE_SKIP_UPDATE_CHECK=1 FASTLANE_HIDE_CHANGELOG=1 FASTLANE_OPT_OUT_USAGE=1 && cd /tmp/build && bundle exec fastlane"
echo "==> Building and testing (Fastlane)"
TEST_STATUS=0
vm_run "$FASTLANE mac_ci" || TEST_STATUS=$?
vm_run "xcrun xcresulttool get test-results summary --path /tmp/arcadia-ci-tests.xcresult > '/Volumes/My Shared Files/evidence/tests-summary.json'" || true
[[ "$TEST_STATUS" == 0 ]] || exit "$TEST_STATUS"

if [[ -n "$ARTIFACT_DIR" ]]; then
  printf -v ESCAPED_BASE_URL '%q' "$ARCADIA_BASE_URL"
  echo "==> Release build, signing and packaging (Fastlane)"
  vm_run "export ARCADIA_BASE_URL=$ESCAPED_BASE_URL; $FASTLANE mac_release"
  [[ -f "$ARTIFACT_DIR/Arcadia.zip" ]] || {
    echo "Release artifact was not copied out of the VM" >&2
    exit 1
  }
fi

echo "==> Done"

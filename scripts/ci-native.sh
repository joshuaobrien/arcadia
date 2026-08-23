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

IMAGE="${TART_IMAGE:-ghcr.io/cirruslabs/macos-tahoe-xcode:26.5}"
VM="arcadia-ci-${GITHUB_RUN_ID:-$$}"
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

cleanup() {
  tart stop "$VM" >/dev/null 2>&1 || true
  sleep 2
  tart delete "$VM" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Cloning $IMAGE -> $VM"
tart clone "$IMAGE" "$VM"

echo "==> Booting"
TART_RUN_ARGS=(--no-graphics "--dir=mint:$MINT_CACHE")
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
tar czf "$WORK/src.tgz" -C "$SRC_DIR" --exclude='.git' \
  Arcadia .swiftlint.yml .swift-format Mintfile
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

echo "==> Building"
vm_run "set -o pipefail; cd /tmp/build/Arcadia && xcodebuild -project Arcadia.xcodeproj -scheme Arcadia -configuration Debug -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO | tail -20"

echo "==> Testing"
vm_run "set -o pipefail; cd /tmp/build/Arcadia && xcodebuild -project Arcadia.xcodeproj -scheme Arcadia -configuration Debug -destination 'platform=macOS' -only-testing:ArcadiaTests test CODE_SIGNING_ALLOWED=NO | tail -20"

if [[ -n "$ARTIFACT_DIR" ]]; then
  printf -v ESCAPED_BASE_URL '%q' "$ARCADIA_BASE_URL"

  echo "==> Building unsigned Release artifact"
  vm_run "set -o pipefail; cd /tmp/build/Arcadia && xcodebuild -project Arcadia.xcodeproj -scheme Arcadia -configuration Release -destination 'platform=macOS' -derivedDataPath /tmp/arcadia-release CODE_SIGNING_ALLOWED=NO ARCADIA_BASE_URL=$ESCAPED_BASE_URL | tail -20"

  echo "==> Ad-hoc signing Release artifact"
  vm_run "codesign --force --deep --sign - /tmp/arcadia-release/Build/Products/Release/Arcadia.app"
  vm_run "codesign --verify --deep --strict --verbose=2 /tmp/arcadia-release/Build/Products/Release/Arcadia.app"

  echo "==> Packaging Arcadia.zip"
  vm_run "ditto -c -k --sequesterRsrc --keepParent /tmp/arcadia-release/Build/Products/Release/Arcadia.app '/Volumes/My Shared Files/artifacts/Arcadia.zip'"
  [[ -f "$ARTIFACT_DIR/Arcadia.zip" ]] || {
    echo "Release artifact was not copied out of the VM" >&2
    exit 1
  }
fi

echo "==> Done"

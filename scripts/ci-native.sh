#!/usr/bin/env bash
# Build and test the native macOS app inside an ephemeral Tart VM.
#
# Runs on the mini's host runner: clones the golden Xcode image, copies the
# checkout in, builds and tests, then destroys the clone. The host never runs
# xcodebuild itself -- it only orchestrates.

set -euo pipefail

IMAGE="${TART_IMAGE:-ghcr.io/cirruslabs/macos-tahoe-xcode:26.5}"
VM="arcadia-ci-${GITHUB_RUN_ID:-$$}"
VM_USER=admin
VM_PASS=admin
SRC_DIR="${1:-$PWD}"

cleanup() {
  tart stop "$VM" >/dev/null 2>&1 || true
  sleep 2
  tart delete "$VM" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Cloning $IMAGE -> $VM"
tart clone "$IMAGE" "$VM"

echo "==> Booting"
tart run --no-graphics "$VM" >/dev/null 2>&1 &

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

# The image ships fixed admin/admin credentials, so drive ssh with expect.
# expect(1) is part of macOS; sshpass is not and needs a compiler.
EXP=$(mktemp)
cat > "$EXP" <<'EOF'
#!/usr/bin/expect -f
log_user 1
set timeout 1800
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
chmod +x "$EXP"

vm_run() { /usr/bin/expect -f "$EXP" "$VM_USER" "$IP" "$1" "$VM_PASS"; }

EXP_SCP=$(mktemp)
cat > "$EXP_SCP" <<'EOF'
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
chmod +x "$EXP_SCP"

echo "==> Copying source"
TARBALL=$(mktemp -d)/src.tgz
tar czf "$TARBALL" -C "$SRC_DIR" --exclude='.git' Arcadia
/usr/bin/expect -f "$EXP_SCP" "$TARBALL" "$VM_USER" "$IP" "/tmp/src.tgz" "$VM_PASS"
vm_run "rm -rf /tmp/build && mkdir -p /tmp/build && tar xzf /tmp/src.tgz -C /tmp/build"

echo "==> Building"
vm_run "cd /tmp/build/Arcadia && xcodebuild -project Arcadia.xcodeproj -scheme Arcadia -configuration Debug -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO | tail -20"

echo "==> Testing"
vm_run "cd /tmp/build/Arcadia && xcodebuild -project Arcadia.xcodeproj -scheme Arcadia -configuration Debug -destination 'platform=macOS' -only-testing:ArcadiaTests test CODE_SIGNING_ALLOWED=NO | tail -20"

echo "==> Done"

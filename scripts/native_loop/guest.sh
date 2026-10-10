#!/bin/bash
# Runs only through Tart exec in the task guest.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
operation="$1"; task="$2"; run_id="$3"; shift 3
exchange='/Volumes/My Shared Files/artifacts'
tools="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Each VM is task-owned, so stable guest paths preserve dependency build signatures.
workspace="/tmp/arcadia-loop/source"
derived="/tmp/arcadia-loop/derived"
artifacts="$exchange/$run_id"
mkdir -p "$artifacts" "$workspace"
export ARCADIA_RUN_ID="$run_id"
export TEST_RUNNER_ARCADIA_RUN_ID="$run_id"

sync_source() {
  local staging
  staging=$(mktemp -d)
  tar xzf "${ARCADIA_SOURCE_ARCHIVE:?Pinned task source archive required}" -C "$staging"
  rsync -a --delete "$staging/" "$workspace/"
  rm -rf "$staging"
}

collect() {
  local status=$?
  trap - EXIT
  if [[ -n "${dependency_staging:-}" ]]; then rm -rf "$dependency_staging"; fi
  if [[ -n "${original_fixture:-}" ]]; then cp "$original_fixture" "$workspace/Arcadia/$fixture"; fi
  /usr/bin/log show --last 20m --style ndjson --predicate "subsystem == 'tokyo.drift.Arcadia' AND eventMessage CONTAINS '$run_id'" > "$artifacts/app.ndjson" 2>/dev/null || true
  printf '%s\n' "$status" > "$artifacts/exit-status"
  exit "$status"
}
trap collect EXIT
common=(-project Arcadia.xcodeproj -scheme Arcadia -configuration Debug -destination 'platform=macOS'
  -derivedDataPath "$derived" -skipMacroValidation CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
  CODE_SIGNING_REQUIRED=NO PRODUCT_BUNDLE_IDENTIFIER=tokyo.drift.Arcadia.Development)

logged() {
  python3 "$tools/progress.py" "$1" "${@:2}"
}

case "$operation" in
  sync) sync_source ;;
  preflight)
    test "$(stat -f %Su /dev/console)" = "$(id -un)" || { echo 'GUI session is not logged in as guest user'; exit 1; }
    xcodebuild -version > "$artifacts/xcode.txt"
    sw_vers > "$artifacts/macos.txt"
    touch "$artifacts/write-probe"
    ;;
  dependency-reset)
    rm -rf "$derived"
    ;;
  dependency-restore)
    if [[ -f "$exchange/dependency-seed.tgz" && ! -d "$derived" ]]; then
      mkdir -p "$derived"
      tar xzf "$exchange/dependency-seed.tgz" -C "$derived"
    fi
    ;;
  dependency-save)
    dependency_staging=$(mktemp -d /tmp/arcadia-dependencies.XXXXXX)
    python3 - "$derived" "$dependency_staging" "$tools" <<'PYTHON'
import sys
sys.path.insert(0, sys.argv[3])
from dependencies import stage
stage(sys.argv[1], sys.argv[2])
PYTHON
    tar czf "$exchange/dependency-candidate.tgz" -C "$dependency_staging" .
    rm -rf "$dependency_staging"
    ;;
  build|test|oracle|review|lint|release)
    sync_source
    cd "$workspace/Arcadia"
    case "$operation" in
      build)
        logged "$artifacts/build.log" xcodebuild "${common[@]}" build
        codesign --verify --deep --strict "$derived/Build/Products/Debug/Arcadia.app" > "$artifacts/signature.log" 2>&1
        ;;
      test|review|oracle)
        test_arguments=(-only-testing:ArcadiaTests -only-testing:ArcadiaUITests/FeedbackLoopTests)
        if [[ "$operation" == review ]]; then
          test_arguments=(-only-testing:ArcadiaUITests/FeedbackLoopTests/testSuccess)
          if [[ "${1:-}" == live-review ]]; then
            shift
            export ARCADIA_REVIEW=1
            test_arguments=(-only-testing:ArcadiaUITests/FeedbackLoopTests/testReviewSession)
          fi
        elif [[ "$operation" == oracle ]]; then
          # The oracle mutation is confined to the guest; restored even on failure.
          fixture=Arcadia/Development/FixtureAlbumClient.swift
          original_fixture="$artifacts/FixtureAlbumClient.original.swift"
          cp "$fixture" "$original_fixture"
          sed -i '' 's/"Hyperballad"/"Mutation control"/' "$fixture"
          set +e
          logged "$artifacts/mutation.log" xcodebuild "${common[@]}" -only-testing:ArcadiaUITests/FeedbackLoopTests/testSuccess -resultBundlePath "$artifacts/mutation.xcresult" test
          mutation_status=$?
          set -e
          cp "$artifacts/FixtureAlbumClient.original.swift" "$fixture"
          printf '%s\n' "$mutation_status" > "$artifacts/mutation-status"
          [[ "$mutation_status" == 65 ]] || { echo 'Mutation did not produce an XCTest failure'; exit 1; }
          grep -q 'XCTAssertTrue failed' "$artifacts/mutation.log" || { echo 'Mutation failed outside the behavioral assertion'; exit 1; }
          test_arguments=(-only-testing:ArcadiaUITests/FeedbackLoopTests/testSuccess)
        fi
        if [[ "${1:-}" == integration ]]; then
          test_arguments=(-only-testing:ArcadiaUITests/FeedbackLoopTests/testIntegrationBrowse)
          export ARCADIA_INTEGRATION_URL="${2:?Guest integration URL required}"
        fi
        if [[ "${1:-}" == only-testing ]]; then
          shift
          test_arguments=()
          for identifier in "$@"; do test_arguments+=("-only-testing:$identifier"); done
        fi
        # Xcode copies TEST_RUNNER_ variables into the test process environment.
        export TEST_RUNNER_ARCADIA_RUN_ID="$ARCADIA_RUN_ID"
        export TEST_RUNNER_ARCADIA_REVIEW="${ARCADIA_REVIEW:-0}"
        export TEST_RUNNER_ARCADIA_INTEGRATION_URL="${ARCADIA_INTEGRATION_URL:-}"
        logged "$artifacts/test.log" xcodebuild "${common[@]}" "${test_arguments[@]}" -resultBundlePath "$artifacts/tests.xcresult" test
        xcrun xcresulttool get test-results summary --path "$artifacts/tests.xcresult" > "$artifacts/tests-summary.json"
        python3 - "$artifacts/tests-summary.json" <<'PYTHON'
import json, sys
summary = json.load(open(sys.argv[1]))
if summary.get('passedTests', 0) < 1 or summary.get('failedTests', 0) != 0:
    raise SystemExit('No passing behavioral tests: check the selected test identifier and skips')
PYTHON
        codesign --verify --deep --strict "$derived/Build/Products/Debug/ArcadiaUITests-Runner.app" > "$artifacts/runner-signature.log" 2>&1
        ;;
      lint)
        cd "$workspace"
        export MINT_PATH='/Volumes/My Shared Files/mint/packages' MINT_LINK_PATH='/Volumes/My Shared Files/mint/bin'
        MINT_NO_TTY=1 logged "$artifacts/mint.log" mint bootstrap
        logged "$artifacts/lint.log" mint run swiftlint swiftlint lint --strict
        logged "$artifacts/format.log" xcrun swift-format lint --configuration .swift-format --recursive --strict Arcadia/Arcadia
        ;;
      release)
        release_url="${1:?Release base URL required}"
        logged "$artifacts/release.log" xcodebuild -project Arcadia.xcodeproj -scheme Arcadia -configuration Release -destination 'platform=macOS' -derivedDataPath "$derived/release" -skipMacroValidation CODE_SIGNING_ALLOWED=NO "ARCADIA_BASE_URL=$release_url" build
        codesign --force --deep --sign - "$derived/release/Build/Products/Release/Arcadia.app"
        codesign --verify --deep --strict "$derived/release/Build/Products/Release/Arcadia.app"
        ditto -c -k --sequesterRsrc --keepParent "$derived/release/Build/Products/Release/Arcadia.app" "$exchange/Arcadia.zip"
        ;;
    esac
    ;;
  export)
    for result in "$exchange"/*/*.xcresult; do
      [[ -d "$result" ]] || continue
      destination="${result%.xcresult}-attachments"
      [[ -d "$destination" ]] || xcrun xcresulttool export attachments --path "$result" --output-path "$destination"
      xcrun xcresulttool get test-results summary --path "$result" > "${result%.xcresult}-summary.json"
    done
    ;;
  *) echo "Unknown guest operation: $operation"; exit 2 ;;
esac

#!/bin/bash
# Runs only through Tart exec in the task guest.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
operation="$1"; task="$2"; run_id="$3"; shift 3
exchange='/Volumes/My Shared Files/artifacts'
tools='/Volumes/My Shared Files/tools'
workspace="/tmp/arcadia-loop/$task/source"
derived="/tmp/arcadia-loop/$task/derived"
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
  if [[ -n "${original_fixture:-}" ]]; then cp "$original_fixture" "$workspace/Arcadia/$fixture"; fi
  /usr/bin/log show --last 20m --style ndjson --predicate "subsystem == 'tokyo.drift.Arcadia' AND eventMessage CONTAINS '$run_id'" > "$artifacts/app.ndjson" 2>/dev/null || true
  printf '%s\n' "$status" > "$artifacts/exit-status"
  exit "$status"
}
trap collect EXIT
common=(-project Arcadia.xcodeproj -scheme Arcadia -configuration Debug -destination 'platform=macOS'
  -derivedDataPath "$derived" -skipMacroValidation CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
  CODE_SIGNING_REQUIRED=NO "PRODUCT_BUNDLE_IDENTIFIER=tokyo.drift.Arcadia.Development.$task")

case "$operation" in
  sync) sync_source ;;
  preflight)
    test "$(stat -f %Su /dev/console)" = "$(id -un)" || { echo 'GUI session is not logged in as guest user'; exit 1; }
    xcodebuild -version > "$artifacts/xcode.txt"
    sw_vers > "$artifacts/macos.txt"
    touch "$artifacts/write-probe"
    ;;
  build|test|oracle|review|lint|release)
    sync_source
    cd "$workspace/Arcadia"
    case "$operation" in
      build)
        /usr/bin/time -p xcodebuild "${common[@]}" build > "$artifacts/build.log" 2>&1
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
          /usr/bin/time -p xcodebuild "${common[@]}" -only-testing:ArcadiaUITests/FeedbackLoopTests/testSuccess -resultBundlePath "$artifacts/mutation.xcresult" test > "$artifacts/mutation.log" 2>&1
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
        # Xcode copies TEST_RUNNER_ variables into the test process environment.
        export TEST_RUNNER_ARCADIA_RUN_ID="$ARCADIA_RUN_ID"
        export TEST_RUNNER_ARCADIA_REVIEW="${ARCADIA_REVIEW:-0}"
        export TEST_RUNNER_ARCADIA_INTEGRATION_URL="${ARCADIA_INTEGRATION_URL:-}"
        /usr/bin/time -p xcodebuild "${common[@]}" "${test_arguments[@]}" -resultBundlePath "$artifacts/tests.xcresult" test > "$artifacts/test.log" 2>&1
        codesign --verify --deep --strict "$derived/Build/Products/Debug/ArcadiaUITests-Runner.app" > "$artifacts/runner-signature.log" 2>&1
        ;;
      lint)
        cd "$workspace"
        export MINT_PATH='/Volumes/My Shared Files/mint/packages' MINT_LINK_PATH='/Volumes/My Shared Files/mint/bin'
        MINT_NO_TTY=1 mint bootstrap > "$artifacts/lint.log" 2>&1
        mint run swiftlint swiftlint lint --strict >> "$artifacts/lint.log" 2>&1
        xcrun swift-format lint --configuration .swift-format --recursive --strict Arcadia/Arcadia > "$artifacts/format.log" 2>&1
        ;;
      release)
        release_url="${1:?Release base URL required}"
        /usr/bin/time -p xcodebuild -project Arcadia.xcodeproj -scheme Arcadia -configuration Release -destination 'platform=macOS' -derivedDataPath "$derived/release" -skipMacroValidation CODE_SIGNING_ALLOWED=NO "ARCADIA_BASE_URL=$release_url" build > "$artifacts/release.log" 2>&1
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

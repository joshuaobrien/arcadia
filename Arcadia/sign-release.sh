#!/usr/bin/env bash
# Ad-hoc packaging for the private Sparkle channel. Sign nested helpers inside out.
set -euo pipefail
app="${1:?App bundle required}"
sparkle="$app/Contents/Frameworks/Sparkle.framework"
for nested in Versions/B/XPCServices/Installer.xpc Versions/B/XPCServices/Downloader.xpc Versions/B/Autoupdate Versions/B/Updater.app; do
  codesign --force --sign - --options runtime --preserve-metadata=entitlements "$sparkle/$nested"
done
codesign --force --sign - "$sparkle"
entitlements=$(mktemp)
trap 'rm -f "$entitlements"' EXIT
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
# Build settings expansion is not available when packaging an unsigned archive.
sed "s/\$(PRODUCT_BUNDLE_IDENTIFIER)/$bundle_id/g" "$(dirname "$0")/Arcadia/Arcadia.entitlements" > "$entitlements"
codesign --force --sign - --entitlements "$entitlements" "$app"
codesign --verify --deep --strict --verbose=2 "$app"

#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != archive && "${1:-}" != export && "${1:-}" != upload ]]; then
  echo 'Usage: bash scripts/ios-testflight.sh archive|export|upload' >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
[[ "$(node --version)" == "v$(cat .nvmrc)" ]] || { echo 'Use the Node version pinned in .nvmrc.' >&2; exit 1; }
: "${APPLE_TEAM_ID:?Set the Apple distribution team ID}"
: "${IOS_PROVISIONING_PROFILE:?Set the installed App Store provisioning profile name}"
: "${EXPO_PUBLIC_GAME_SERVER:?Set the hosted HTTPS multiplayer origin}"
[[ "$EXPO_PUBLIC_GAME_SERVER" == https://* ]] || { echo 'TestFlight requires an HTTPS multiplayer origin.' >&2; exit 1; }
out="${IOS_RELEASE_DIR:-$root/ios/build/testflight}"

if [[ "$1" == archive ]]; then
  [[ ! -e "$out/Machination.xcarchive" ]] || { echo "Archive already exists: $out/Machination.xcarchive" >&2; exit 1; }
  node_modules/.bin/expo prebuild --platform ios --no-install
  (cd ios && pod install)
  # Expo skips Metro's requested cache reset on CI.
  printf '\nexport CI=0\n' >> ios/.xcode.env.local
  mkdir -p "$out"
  xcodebuild archive -workspace ios/Machination.xcworkspace -scheme Machination \
    -configuration Release -destination 'generic/platform=iOS' -jobs 2 \
    -derivedDataPath "${IOS_DERIVED_DATA_DIR:-$out/DerivedData}" -archivePath "$out/Machination.xcarchive" \
    DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Manual \
    CODE_SIGN_IDENTITY='Apple Distribution' PROVISIONING_PROFILE_SPECIFIER="$IOS_PROVISIONING_PROFILE" \
    EXPO_PUBLIC_GAME_SERVER="$EXPO_PUBLIC_GAME_SERVER" \
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" \
    EXPO_PUBLIC_EAS_PROJECT_ID="${EXPO_PUBLIC_EAS_PROJECT_ID:-}"
  node scripts/verify-ios-release.mjs "$out/Machination.xcarchive"
else
  if [[ "$1" == upload ]]; then
    : "${ASC_KEY_ID:?Set the App Store Connect API key ID}"
    : "${ASC_ISSUER_ID:?Set the App Store Connect API issuer ID}"
  fi
  [[ -d "$out/Machination.xcarchive" ]] || { echo 'Build the archive first.' >&2; exit 1; }
  node scripts/verify-ios-release.mjs "$out/Machination.xcarchive"
  cat > "$out/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict>
    <key>com.mcclowes.machination</key><string>$IOS_PROVISIONING_PROFILE</string>
  </dict>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
  xcodebuild -exportArchive -archivePath "$out/Machination.xcarchive" \
    -exportPath "$out/export" -exportOptionsPlist "$out/ExportOptions.plist"
  if [[ "$1" == upload ]]; then
    xcrun altool --upload-app --type ios --file "$out/export/Machination.ipa" \
      --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
  fi
fi

#!/bin/bash
# Verifies a built Driftsky DMG on a real Mac the way a customer gets it: mount, install to
# /Applications, inspect the bundle, run the self-test natively and under Rosetta, first launch.
# Usage: scripts/verify-mac-package.sh <results-dir>     (run from apps/desktop after electron-builder --mac)
set -u
R="${1:?results dir}/package"
mkdir -p "$R"
fail=0
note() { echo "$*" | tee -a "$R/summary.txt"; }

DMG=$(ls release/*.dmg 2>/dev/null | head -1)
[ -n "$DMG" ] || { note "FAIL no DMG built"; exit 1; }
ls -la release > "$R/release-files.txt"
note "dmg: $DMG ($(du -h "$DMG" | cut -f1))"

MNT=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG" > "$R/hdiutil.txt" 2>&1 || { note "FAIL cannot mount DMG"; exit 1; }
ls -la "$MNT" > "$R/dmg-contents.txt"
[ -L "$MNT/Applications" ] && note "ok   DMG has the Applications shortcut" || { note "FAIL no Applications link in DMG"; fail=1; }
rm -rf /Applications/Driftsky.app
cp -R "$MNT/Driftsky.app" /Applications/ || { note "FAIL copy to /Applications"; fail=1; }
hdiutil detach "$MNT" -quiet || true

APP=/Applications/Driftsky.app
EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")
BIN="$APP/Contents/MacOS/$EXE"
plutil -p "$APP/Contents/Info.plist" > "$R/Info.plist.txt"
for k in CFBundleIdentifier CFBundleShortVersionString LSMinimumSystemVersion LSUIElement NSAppleEventsUsageDescription; do
  note "plist $k = $(/usr/libexec/PlistBuddy -c "Print :$k" "$APP/Contents/Info.plist" 2>/dev/null || echo MISSING)"
done
[ "$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$APP/Contents/Info.plist" 2>/dev/null)" = "true" ] || { note "FAIL LSUIElement not set (Dock icon would show)"; fail=1; }

ARCHS=$(lipo -archs "$BIN")
note "main binary archs: $ARCHS"
[[ "$ARCHS" == *x86_64* && "$ARCHS" == *arm64* ]] || { note "FAIL main binary is not universal"; fail=1; }
find "$APP" -name '*.node' | while read -r f; do echo "$(lipo -archs "$f" 2>&1)  ${f#$APP/}"; done > "$R/native-modules.txt"
grep -q "koffi/build/koffi/darwin_arm64" "$R/native-modules.txt" && grep -q "koffi/build/koffi/darwin_x64" "$R/native-modules.txt" && note "ok   koffi for arm64 and x64 unpacked" || { note "FAIL koffi native modules missing"; fail=1; }

codesign -dv --verbose=2 "$APP" > "$R/codesign.txt" 2>&1
codesign --verify --deep --strict "$APP" >> "$R/codesign.txt" 2>&1 && note "ok   code signature valid ($(grep -m1 '^Signature=' "$R/codesign.txt" || grep -m1 'Authority=' "$R/codesign.txt"))" || { note "FAIL code signature invalid"; fail=1; }
spctl --assess --type execute -vv "$APP" > "$R/gatekeeper.txt" 2>&1; note "gatekeeper: $(tail -1 "$R/gatekeeper.txt") (expected to reject until signed with a Developer ID and notarized)"
npx --no-install @electron/fuses read --app "$APP" > "$R/fuses.txt" 2>&1 && note "fuses: $(grep -c Disabled "$R/fuses.txt") disabled / $(grep -c Enabled "$R/fuses.txt") enabled"
du -sh "$APP" | tee -a "$R/summary.txt"

xattr -cr "$APP"
"$BIN" --self-test="$R/selftest-native.json" > "$R/selftest-native.log" 2>&1
st=$?; note "self-test ($(uname -m)): exit $st"; [ $st -eq 0 ] || fail=1
if [ "$(uname -m)" = "arm64" ]; then
  arch -x86_64 /usr/bin/true 2>/dev/null || softwareupdate --install-rosetta --agree-to-license > "$R/rosetta.txt" 2>&1
  arch -x86_64 "$BIN" --self-test="$R/selftest-x86_64.json" > "$R/selftest-x86_64.log" 2>&1
  st=$?; note "self-test (x86_64 under Rosetta): exit $st"; [ $st -eq 0 ] || fail=1
fi

# first launch, as a customer would
rm -rf "$HOME/Library/Application Support/Driftsky"
open "$APP"
sleep 15
pgrep -fl "Driftsky.app" > "$R/processes.txt" && note "ok   app running after launch ($(wc -l < "$R/processes.txt") processes)" || { note "FAIL app not running after launch"; fail=1; }
/usr/sbin/screencapture -x "$R/first-launch.png" || true
ls -la "$HOME/Library/Application Support/Driftsky" > "$R/userdata.txt" 2>&1
osascript -e 'tell application "System Events" to get name of every process whose background only is false' > "$R/foreground-apps.txt" 2>&1 || true
pkill -f "Driftsky.app/Contents/MacOS" || true
sleep 2
pgrep -fl "Driftsky.app" > /dev/null && { note "FAIL app still running after quit"; fail=1; } || note "ok   quits cleanly"

note "package verification: $([ $fail -eq 0 ] && echo PASSED || echo FAILED)"
exit $fail

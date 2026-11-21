// electron-builder afterSign hook: when no Developer ID signed the app (local or CI test builds),
// sign it ad hoc. Apple silicon refuses to run code without a valid signature, and flipping the
// Electron fuses invalidated the original one. Release builds are signed with the Developer ID
// (and notarized) by electron-builder itself, so this does nothing for them.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'ignore' });
    return; // already validly signed
  } catch {
    /* unsigned: sign ad hoc below */
  }
  const entitlements = path.join(__dirname, 'entitlements.mac.plist');
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--options', 'runtime', '--entitlements', entitlements, app], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • signed ad hoc (test build: no Developer ID configured)');
};

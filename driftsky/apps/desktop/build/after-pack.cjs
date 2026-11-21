// electron-builder afterPack hook: harden the Electron binary with fuses before signing.
// - no running as plain Node (ELECTRON_RUN_AS_NODE), no NODE_OPTIONS, no --inspect
// - load app code only from the asar archive, and check its integrity
// On macOS the binary is re-signed ad hoc afterwards so unsigned builds still launch on Apple
// silicon; a Developer ID signature replaces that during signing.
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const name = packager.appInfo.productFilename;
  const target =
    electronPlatformName === 'darwin' || electronPlatformName === 'mas'
      ? path.join(appOutDir, `${name}.app`)
      : electronPlatformName === 'win32'
        ? path.join(appOutDir, `${name}.exe`)
        : path.join(appOutDir, packager.executableName);
  await flipFuses(target, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log(`  • fuses applied  ${path.basename(target)}`);
};

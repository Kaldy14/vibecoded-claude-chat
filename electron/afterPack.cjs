/**
 * electron-builder afterPack hook.
 * Installs production node_modules into the app-server extraResource
 * after packaging (since electron-builder strips node_modules from extraResources).
 */
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

module.exports = async function afterPack(context) {
  const appServerDir = path.join(
    context.appOutDir,
    context.packager.appInfo.productFilename + ".app",
    "Contents",
    "Resources",
    "app-server"
  );

  // On Linux/Windows, the path is different
  const isLinux = context.electronPlatformName === "linux";
  const isWin = context.electronPlatformName === "win32";
  let targetDir = appServerDir;
  if (isLinux) {
    targetDir = path.join(context.appOutDir, "resources", "app-server");
  } else if (isWin) {
    targetDir = path.join(context.appOutDir, "resources", "app-server");
  }

  if (!fs.existsSync(targetDir)) {
    console.log(`[afterPack] app-server dir not found at ${targetDir}, skipping`);
    return;
  }

  console.log(`[afterPack] Installing production deps in ${targetDir}...`);
  execFileSync("npm", ["ci", "--omit=dev"], {
    cwd: targetDir,
    stdio: "inherit",
  });

  console.log("[afterPack] Production dependencies installed successfully.");
};

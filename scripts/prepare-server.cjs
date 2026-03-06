/**
 * Stages server files into build-server/ for electron-builder extraResources.
 * Production node_modules are installed by electron/afterPack.cjs.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dest = path.join(root, "build-server");

// Clean
if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true });
}
fs.mkdirSync(dest, { recursive: true });

// Copy server/
fs.cpSync(path.join(root, "server"), path.join(dest, "server"), {
  recursive: true,
});

// Copy dist/ (Vite build output)
fs.cpSync(path.join(root, "dist"), path.join(dest, "dist"), {
  recursive: true,
});

// Copy package.json and package-lock.json (needed for npm ci in afterPack)
fs.copyFileSync(
  path.join(root, "package.json"),
  path.join(dest, "package.json")
);
fs.copyFileSync(
  path.join(root, "package-lock.json"),
  path.join(dest, "package-lock.json")
);

console.log("Server bundle staged in build-server/");

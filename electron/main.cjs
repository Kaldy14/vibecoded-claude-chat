const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const http = require("http");

const IS_DEV = process.env.ELECTRON_DEV === "1";
const PORT = 3775;
const VITE_PORT = 3774;
let serverProcess = null;
let mainWindow = null;

// macOS GUI apps don't inherit shell PATH — fix that
function fixPath() {
  if (process.platform !== "darwin") return;
  try {
    const shellPath = execFileSync("/bin/zsh", ["-ilc", "echo -n $PATH"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {
    // Fallback: add common bin directories
    const home = process.env.HOME || "";
    const extra = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      `${home}/.nvm/versions/node/v22/bin`,
      `${home}/.npm-global/bin`,
    ].join(":");
    process.env.PATH = `${extra}:${process.env.PATH}`;
  }
}

function getBasePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app-server");
  }
  return path.join(__dirname, "..");
}

function findNode() {
  try {
    return execFileSync("which", ["node"], { encoding: "utf-8" }).trim();
  } catch {}
  const candidates = [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"]);
      return c;
    } catch {}
  }
  return null;
}

function waitForServer(port, timeoutSec = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = timeoutSec * 2; // 500ms intervals
    const check = () => {
      attempts++;
      const req = http.get(`http://localhost:${port}`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (attempts >= maxAttempts) {
          reject(new Error(`Server on port ${port} not ready after ${timeoutSec} seconds`));
        } else {
          setTimeout(check, 500);
        }
      });
      req.end();
    };
    setTimeout(check, 500);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const basePath = getBasePath();
    const serverScript = path.join(basePath, "server", "index.js");
    const nodeBin = findNode();

    if (!nodeBin) {
      reject(new Error("Node.js not found. Please install Node.js 22+."));
      return;
    }

    serverProcess = spawn(nodeBin, [serverScript], {
      cwd: basePath,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "production",
        ELECTRON: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stdout.on("data", (data) => {
      console.log(`[server] ${data.toString().trim()}`);
    });

    serverProcess.stderr.on("data", (data) => {
      console.error(`[server] ${data.toString().trim()}`);
    });

    serverProcess.on("error", (err) => {
      reject(new Error(`Failed to start server: ${err.message}`));
    });

    serverProcess.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.error(`[server] exited with code ${code}`);
      }
      serverProcess = null;
    });

    waitForServer(PORT).then(resolve, reject);
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#09090b",
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const url = IS_DEV
    ? `http://localhost:${VITE_PORT}`
    : `http://localhost:${PORT}`;
  mainWindow.loadURL(url);

  if (IS_DEV) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function killServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

function checkClaude() {
  try {
    execFileSync("claude", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  fixPath();

  // Set dock icon in dev mode
  if (IS_DEV && process.platform === "darwin") {
    const iconPath = path.join(__dirname, "..", "build", "icon.png");
    app.dock.setIcon(iconPath);
  }

  if (!checkClaude()) {
    dialog.showErrorBox(
      "Claude CLI Not Found",
      "Claude Code CLI is required but was not found in your PATH.\n\n" +
        "Install it with:\n  npm install -g @anthropic-ai/claude-code\n\n" +
        "Then restart this app."
    );
    app.quit();
    return;
  }

  try {
    if (IS_DEV) {
      // In dev mode, npm run dev handles both Vite + Express.
      // Vite can take a while on first start (dependency optimization).
      await waitForServer(VITE_PORT, 60);
    } else {
      await startServer();
    }
    createWindow();
  } catch (err) {
    dialog.showErrorBox("Startup Error", err.message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  killServer();
  app.quit();
});

app.on("before-quit", () => {
  killServer();
});

app.on("activate", () => {
  if (mainWindow === null && serverProcess) {
    createWindow();
  }
});

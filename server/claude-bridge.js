import { spawn, execFileSync } from "child_process";
import { EventEmitter } from "events";
import { existsSync } from "fs";

/** Resolve the full path to a working claude binary once at startup */
let claudeBin = null;

// Candidates in priority order — prefer the real binary over wrappers
const home = process.env.HOME || "";
const candidates = [
  `${home}/.local/bin/claude`,
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
];
try {
  const whichResult = execFileSync("which", ["claude"], { encoding: "utf-8" }).trim();
  if (whichResult && !candidates.includes(whichResult)) {
    candidates.push(whichResult);
  }
} catch {}

// Just check existence — don't run --version as broken node_modules can interfere
for (const c of candidates) {
  if (existsSync(c)) {
    claudeBin = c;
    break;
  }
}

if (!claudeBin) {
  console.error("[claude-bridge] ERROR: could not find claude binary!");
  claudeBin = "claude";
}
console.log(`[claude-bridge] using claude binary: ${claudeBin}`);

/**
 * Manages Claude Code interactions per thread.
 * Each message spawns `claude -p --output-format stream-json "prompt"`.
 * Follow-up messages use `--resume <sessionId> --continue`.
 */
export class ClaudeBridge extends EventEmitter {
  constructor(threadId, cwd) {
    super();
    this.threadId = threadId;
    this.cwd = cwd;
    this.hasSession = false; // tracks if we've had at least one conversation
    this.process = null;
    this.buffer = "";
    this.running = false;
  }

  start(prompt, options = {}) {
    if (this.running) {
      // Kill the current process so we can start a new one
      console.log(`[bridge:${this.threadId.slice(0,8)}] killing running process for new message`);
      if (this.process && !this.process.killed) {
        this.process.kill("SIGTERM");
      }
      this.process = null;
      this.buffer = "";
    }
    this.running = true;

    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
    ];

    if (this.hasSession) {
      // Resume using the thread ID as session ID
      args.push("--resume", this.threadId);
    } else {
      // First message: set a known session ID = threadId
      args.push("--session-id", this.threadId);
    }

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    // The prompt goes as the last argument
    args.push(prompt);

    console.log(`[bridge:${this.threadId.slice(0,8)}] hasSession: ${this.hasSession}`);
    console.log(`[bridge:${this.threadId.slice(0,8)}] spawning: claude ${args.join(" ").substring(0, 200)}...`);
    console.log(`[bridge:${this.threadId.slice(0,8)}] cwd: ${this.cwd}`);

    this.process = spawn(claudeBin, args, {
      cwd: this.cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.on("spawn", () => {
      console.log(`[bridge:${this.threadId.slice(0,8)}] process spawned pid=${this.process.pid}`);
      // Close stdin — we pass prompt as arg, not via stdin
      this.process.stdin.end();
    });

    this.process.stdout.on("data", (data) => {
      this.buffer += data.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          // Mark session as established once we get a response
          if (msg.session_id && !this.hasSession) {
            this.hasSession = true;
            console.log(`[bridge:${this.threadId.slice(0,8)}] session established: ${msg.session_id}`);
          }
          this.hasProducedOutput = true;
          this.emit("message", msg);
        } catch {
          // partial JSON, ignore
        }
      }
    });

    this.process.stderr.on("data", (data) => {
      console.log(`[bridge:${this.threadId.slice(0,8)}] stderr: ${data.toString().trim()}`);
      this.emit("stderr", data.toString());
    });

    this.hasProducedOutput = false;

    this.process.on("close", (code) => {
      // Flush remaining buffer
      if (this.buffer.trim()) {
        try {
          const msg = JSON.parse(this.buffer);
          if (msg.session_id && !this.hasSession) {
            this.hasSession = true;
          }
          this.hasProducedOutput = true;
          this.emit("message", msg);
        } catch {}
      }
      this.buffer = "";
      this.running = false;
      this.process = null;

      // If process exited with no output at all, emit an error so the UI knows
      if (!this.hasProducedOutput && code !== 0) {
        console.error(`[bridge:${this.threadId.slice(0,8)}] process exited with code ${code} and no output`);
        this.emit("error", new Error(`Claude process exited with code ${code} without producing output. This may indicate rate limiting or an authentication issue.`));
      }

      this.emit("close", code);
    });

    this.process.on("error", (err) => {
      this.running = false;
      this.process = null;
      this.emit("error", err);
    });
  }

  /** Send a follow-up message — spawns a new claude process with --resume */
  send(prompt, options = {}) {
    this.start(prompt, options);
  }

  abort() {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGINT");
    }
  }

  kill() {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
    }
  }
}

/** Registry of active bridges keyed by threadId */
const activeBridges = new Map();

export function getBridge(threadId) {
  return activeBridges.get(threadId);
}

export function createBridge(threadId, cwd) {
  const existing = activeBridges.get(threadId);
  if (existing) {
    existing.kill();
  }
  const bridge = new ClaudeBridge(threadId, cwd);
  activeBridges.set(threadId, bridge);
  return bridge;
}

export function killBridge(threadId) {
  const bridge = activeBridges.get(threadId);
  if (bridge) {
    bridge.kill();
    activeBridges.delete(threadId);
  }
}

export function listActiveBridges() {
  return Array.from(activeBridges.keys());
}

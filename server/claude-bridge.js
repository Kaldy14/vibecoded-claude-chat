import { spawn } from "child_process";
import { EventEmitter } from "events";

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

    console.log(`[bridge:${this.threadId.slice(0,8)}] sessionId: ${this.sessionId || 'NONE (new session)'}`);
    console.log(`[bridge:${this.threadId.slice(0,8)}] spawning: claude ${args.join(" ").substring(0, 200)}...`);
    console.log(`[bridge:${this.threadId.slice(0,8)}] cwd: ${this.cwd}`);

    this.process = spawn("claude", args, {
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

    this.process.on("close", (code) => {
      // Flush remaining buffer
      if (this.buffer.trim()) {
        try {
          const msg = JSON.parse(this.buffer);
          if (msg.session_id && !this.hasSession) {
            this.hasSession = true;
          }
          this.emit("message", msg);
        } catch {}
      }
      this.buffer = "";
      this.running = false;
      this.process = null;
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

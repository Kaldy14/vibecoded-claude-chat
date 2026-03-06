import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import db from "./db.js";

/** Normalize project path: strip leading @, expand ~ */
function normalizePath(p) {
  if (!p) return p;
  // Strip leading @ (used as shorthand prefix in some UIs)
  if (p.startsWith("@")) p = p.slice(1);
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}
import {
  createBridge,
  getBridge,
  killBridge,
  listActiveBridges,
} from "./claude-bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

// Serve built frontend in production
const distPath = join(__dirname, "..", "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
}

// --- REST API ---

// Projects
app.get("/api/projects", (req, res) => {
  const projects = db.prepare("SELECT * FROM projects ORDER BY name").all();
  res.json(projects);
});

app.post("/api/projects", (req, res) => {
  const { name, path: rawPath } = req.body;
  const path = normalizePath(rawPath?.trim());
  if (!path || !existsSync(path)) {
    return res.status(400).json({ error: `Directory not found: ${path}` });
  }
  const id = uuid();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    id,
    name,
    path
  );
  res.json({ id, name, path });
});

app.delete("/api/projects/:id", (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Threads
app.get("/api/projects/:projectId/threads", (req, res) => {
  const threads = db
    .prepare(
      "SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC"
    )
    .all(req.params.projectId);
  res.json(threads);
});

app.post("/api/projects/:projectId/threads", (req, res) => {
  const id = uuid();
  const title = req.body.title || "New thread";
  db.prepare(
    "INSERT INTO threads (id, project_id, title) VALUES (?, ?, ?)"
  ).run(id, req.params.projectId, title);
  res.json({ id, project_id: req.params.projectId, title });
});

app.patch("/api/threads/:id", (req, res) => {
  const { title } = req.body;
  if (title) {
    db.prepare(
      "UPDATE threads SET title = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(title, req.params.id);
  }
  res.json({ ok: true });
});

app.delete("/api/threads/:id", (req, res) => {
  killBridge(req.params.id);
  db.prepare("DELETE FROM threads WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Messages
app.get("/api/threads/:threadId/messages", (req, res) => {
  const messages = db
    .prepare(
      "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC"
    )
    .all(req.params.threadId);
  res.json(
    messages.map((m) => {
      // Parse content: if it's a JSON array (tool_use blocks), parse it
      let content = m.content;
      try {
        const parsed = JSON.parse(m.content);
        if (Array.isArray(parsed)) content = parsed;
      } catch {
        // plain text, keep as-is
      }
      return {
        ...m,
        content,
        metadata: m.metadata ? JSON.parse(m.metadata) : null,
      };
    })
  );
});

// Active sessions
app.get("/api/sessions", (req, res) => {
  res.json(listActiveBridges());
});

app.post("/api/threads/:threadId/abort", (req, res) => {
  const bridge = getBridge(req.params.threadId);
  if (bridge) {
    bridge.abort();
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "No active session" });
  }
});

// --- WebSocket ---

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// Map<threadId, Set<WebSocket>> for broadcasting
const threadSubscribers = new Map();

// Map<threadId, string> for accumulating streaming assistant text
const threadStreamingText = new Map();

function broadcast(threadId, data) {
  const subs = threadSubscribers.get(threadId);
  if (!subs) return;
  const payload = JSON.stringify(data);
  for (const ws of subs) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

wss.on("connection", (ws) => {
  const subscriptions = new Set();

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "subscribe": {
        const { threadId } = msg;
        if (!threadSubscribers.has(threadId)) {
          threadSubscribers.set(threadId, new Set());
        }
        threadSubscribers.get(threadId).add(ws);
        subscriptions.add(threadId);

        // Send current status — check if process is actually running, not just bridge exists
        const bridge = getBridge(threadId);
        ws.send(
          JSON.stringify({
            type: "status",
            threadId,
            active: !!(bridge && bridge.running),
          })
        );
        break;
      }

      case "unsubscribe": {
        const { threadId } = msg;
        const subs = threadSubscribers.get(threadId);
        if (subs) subs.delete(ws);
        subscriptions.delete(threadId);
        break;
      }

      case "send_message": {
        const { threadId, content, options } = msg;

        // Get the thread and its project
        const thread = db
          .prepare(
            `SELECT t.*, p.path as project_path
             FROM threads t JOIN projects p ON t.project_id = p.id
             WHERE t.id = ?`
          )
          .get(threadId);

        if (!thread) {
          ws.send(
            JSON.stringify({ type: "error", message: "Thread not found" })
          );
          return;
        }

        // Expand ~ in project path (handles legacy DB entries)
        thread.project_path = normalizePath(thread.project_path);

        // Save user message
        const userMsgId = uuid();
        db.prepare(
          "INSERT INTO messages (id, thread_id, role, content) VALUES (?, ?, 'user', ?)"
        ).run(userMsgId, threadId, content);

        broadcast(threadId, {
          type: "user_message",
          threadId,
          message: {
            id: userMsgId,
            role: "user",
            content,
          },
        });

        // Auto-generate title from first prompt if still default
        if (thread.title === "New thread") {
          const newTitle = content
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60)
            .replace(/\s\S*$/, (m) => (m.length < 10 ? "" : m)) // trim to word boundary unless very short
            || content.slice(0, 60);
          const finalTitle = newTitle.length < content.trim().length
            ? newTitle + "..."
            : newTitle;
          db.prepare(
            "UPDATE threads SET title = ?, updated_at = datetime('now') WHERE id = ?"
          ).run(finalTitle, threadId);
          broadcast(threadId, {
            type: "thread_updated",
            threadId,
            title: finalTitle,
          });
        }

        // Get or create bridge
        let bridge = getBridge(threadId);
        if (!bridge) {
          bridge = createBridge(threadId, thread.project_path);

          bridge.on("message", (claudeMsg) => {
            // Save assistant messages with tool_use blocks to DB
            // These contain the actual diff data (file_path, old_string, new_string)
            if (claudeMsg.type === "assistant" && claudeMsg.message?.content) {
              const parts = claudeMsg.message.content;
              const hasTools = parts.some((p) => p.type === "tool_use");

              if (hasTools) {
                // Save tool turn with full content array (preserves diff data)
                const assistantMsgId = uuid();
                db.prepare(
                  "INSERT INTO messages (id, thread_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)"
                ).run(
                  assistantMsgId,
                  threadId,
                  JSON.stringify(parts),
                  JSON.stringify(claudeMsg)
                );
              } else {
                // Text-only turn: accumulate for result handler
                const chunks = parts
                  .filter((c) => c.type === "text")
                  .map((c) => c.text)
                  .join("");
                if (chunks) {
                  threadStreamingText.set(
                    threadId,
                    (threadStreamingText.get(threadId) || "") + chunks
                  );
                }
              }
            }

            // Save tool_result (user type) — attach results to previous tool messages
            if (claudeMsg.type === "user" && claudeMsg.message?.content) {
              const toolResults = claudeMsg.message.content.filter(
                (p) => p.type === "tool_result"
              );
              for (const tr of toolResults) {
                const toolUseId = tr.tool_use_id;
                const resultContent =
                  typeof tr.content === "string"
                    ? tr.content
                    : Array.isArray(tr.content)
                    ? tr.content.map((c) => c.text || "").join("")
                    : JSON.stringify(tr.content);
                // Update the stored message that contains this tool_use
                const rows = db
                  .prepare(
                    "SELECT id, content FROM messages WHERE thread_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 10"
                  )
                  .all(threadId);
                for (const row of rows) {
                  try {
                    const parsed = JSON.parse(row.content);
                    if (!Array.isArray(parsed)) continue;
                    const match = parsed.find(
                      (c) => c.type === "tool_use" && c.id === toolUseId
                    );
                    if (match) {
                      match.result = resultContent;
                      db.prepare(
                        "UPDATE messages SET content = ? WHERE id = ?"
                      ).run(JSON.stringify(parsed), row.id);
                      break;
                    }
                  } catch {
                    // not JSON array, skip
                  }
                }
              }
            }

            // Result — final text + cost. Save remaining streaming text.
            if (claudeMsg.type === "result") {
              const accumulated = threadStreamingText.get(threadId) || "";
              const msgContent =
                claudeMsg.result || accumulated || "";
              if (msgContent) {
                const assistantMsgId = uuid();
                db.prepare(
                  "INSERT INTO messages (id, thread_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)"
                ).run(
                  assistantMsgId,
                  threadId,
                  msgContent,
                  JSON.stringify(claudeMsg)
                );
              }
              db.prepare(
                "UPDATE threads SET updated_at = datetime('now') WHERE id = ?"
              ).run(threadId);
              threadStreamingText.delete(threadId);
            }

            broadcast(threadId, {
              type: "claude_message",
              threadId,
              data: claudeMsg,
            });
          });

          bridge.on("stderr", (text) => {
            broadcast(threadId, {
              type: "claude_stderr",
              threadId,
              text,
            });
          });

          bridge.on("close", (code) => {
            broadcast(threadId, {
              type: "session_ended",
              threadId,
              exitCode: code,
            });
            // DON'T kill the bridge — keep it alive so sessionId is preserved
            // for follow-up messages with --resume. The bridge already sets
            // this.running = false on close.
            threadStreamingText.delete(threadId);
          });

          bridge.on("error", (err) => {
            broadcast(threadId, {
              type: "error",
              threadId,
              message: err.message,
            });
          });

        }

        // Send the message (spawns claude process)
        bridge.send(content, options);

        broadcast(threadId, {
          type: "status",
          threadId,
          active: true,
        });
        break;
      }

      case "abort": {
        const bridge = getBridge(msg.threadId);
        if (bridge) bridge.abort();
        break;
      }
    }
  });

  ws.on("close", () => {
    for (const threadId of subscriptions) {
      const subs = threadSubscribers.get(threadId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) threadSubscribers.delete(threadId);
      }
    }
  });
});

// SPA fallback — serve index.html for non-API routes in production
if (existsSync(distPath)) {
  app.get("/{*splat}", (req, res) => {
    res.sendFile(join(distPath, "index.html"));
  });
}

const PORT = process.env.PORT || 3775;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`claude-ui server running on http://localhost:${PORT}`);
});

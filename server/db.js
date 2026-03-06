import { DatabaseSync } from "node:sqlite";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

const dataDir = join(homedir(), ".claude-ui");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, "state.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New thread',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Wrapper to match better-sqlite3 API used in server/index.js
const wrapper = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    return {
      run(...params) { return stmt.run(...params); },
      get(...params) { return stmt.get(...params); },
      all(...params) { return stmt.all(...params); },
    };
  },
  exec(sql) { return db.exec(sql); },
};

export default wrapper;

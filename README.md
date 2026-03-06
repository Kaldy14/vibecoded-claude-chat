# vibecoded-claude-chat

A web UI for chatting with Claude Code. Built with React, Vite, Tailwind CSS, and an Express/WebSocket backend that spawns `claude` CLI processes.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Setup

```bash
npm install
```

## Running

```bash
npm run dev
```

This starts both the backend (Express + WebSocket on port 3775) and the frontend (Vite dev server on port 3774) concurrently.

Open [http://localhost:3774](http://localhost:3774) in your browser.

## How it works

1. Create a **project** by pointing it at a local directory.
2. Open a **thread** within that project to start a conversation.
3. Messages are sent to the Claude Code CLI via a server-side bridge process, and responses stream back over WebSocket.

## Stack

- **Frontend:** React 19, Tailwind CSS 4, Vite
- **Backend:** Express 5, WebSocket (`ws`), better-sqlite3
- **AI:** Claude Code CLI (spawned as a subprocess per thread)

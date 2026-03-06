import { useEffect, useRef, useState, useCallback } from "react";
import { useWebSocket, sendMessage, abortThread } from "../hooks/useWebSocket.js";
import MessageList from "./MessageList.jsx";
import InputBar from "./InputBar.jsx";

export default function ChatPanel({ threadId, projectId, threadTitle, projectPath }) {
  const [messages, setMessages] = useState([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [title, setTitle] = useState(threadTitle || "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [loading, setLoading] = useState(false);
  const titleInputRef = useRef(null);

  // Sync title prop
  useEffect(() => {
    setTitle(threadTitle || "");
  }, [threadTitle]);

  // Focus title input when editing
  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  // Fetch messages on threadId change
  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      setStreamingContent("");
      setIsStreaming(false);
      setIsActive(false);
      return;
    }

    setLoading(true);
    setMessages([]);
    setStreamingContent("");
    setIsStreaming(false);
    setIsActive(false);

    fetch(`/api/threads/${threadId}/messages`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setMessages(Array.isArray(data) ? data : data.messages || []);
      })
      .catch((err) => {
        console.error("Failed to load messages:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [threadId]);

  // Track session cost and context usage from result messages
  const [sessionCost, setSessionCost] = useState(null);
  const [contextUsage, setContextUsage] = useState(null); // { input_tokens, cache_read, cache_creation }

  // WebSocket message handler
  const handleWsMessage = useCallback((msg) => {
    switch (msg.type) {
      case "claude_message": {
        const d = msg.data || {};

        if (d.type === "assistant" && d.message?.content) {
          const parts = d.message.content;
          const hasTools = parts.some((p) => p.type === "tool_use");

          if (hasTools) {
            setStreamingContent((prev) => {
              if (prev) {
                setMessages((msgs) => [
                  ...msgs,
                  {
                    id: `msg-${Date.now()}-text`,
                    role: "assistant",
                    content: prev,
                  },
                ]);
              }
              return "";
            });
            setIsStreaming(false);

            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}`,
                role: "assistant",
                content: parts,
                metadata: d,
              },
            ]);
          } else {
            const text = parts
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("");
            if (text) {
              setStreamingContent((prev) => prev + text);
              setIsStreaming(true);
            }
          }
        }

        if (d.type === "user" && d.message?.content) {
          const toolResults = d.message.content.filter((p) => p.type === "tool_result");
          for (const tr of toolResults) {
            const toolUseId = tr.tool_use_id;
            const resultContent = typeof tr.content === "string" ? tr.content
              : Array.isArray(tr.content) ? tr.content.map((c) => c.text || "").join("")
              : JSON.stringify(tr.content);

            setMessages((prev) =>
              prev.map((m) => {
                if (!Array.isArray(m.content)) return m;
                const hasMatchingTool = m.content.some(
                  (c) => c.type === "tool_use" && c.id === toolUseId
                );
                if (!hasMatchingTool) return m;
                const newContent = m.content.map((c) =>
                  c.type === "tool_use" && c.id === toolUseId
                    ? { ...c, result: resultContent }
                    : c
                );
                return { ...m, content: newContent };
              })
            );
          }
        }

        if (d.type === "result") {
          setIsStreaming(false);
          setIsActive(false);

          if (d.total_cost_usd) {
            setSessionCost((prev) => (prev || 0) + d.total_cost_usd);
          }

          if (d.usage) {
            setContextUsage({
              input_tokens: d.usage.input_tokens || 0,
              cache_read: d.usage.cache_read_input_tokens || 0,
              cache_creation: d.usage.cache_creation_input_tokens || 0,
            });
          }

          setStreamingContent((prev) => {
            const finalText = prev || (typeof d.result === "string" ? d.result : "");
            if (finalText) {
              setMessages((msgs) => [
                ...msgs,
                {
                  id: `msg-${Date.now()}`,
                  role: "assistant",
                  content: finalText,
                  metadata: {
                    total_cost_usd: d.total_cost_usd,
                    duration_ms: d.duration_ms,
                    num_turns: d.num_turns,
                    usage: d.usage,
                  },
                },
              ]);
            }
            return "";
          });
        }

        break;
      }

      case "message_complete":
      case "session_ended": {
        setStreamingContent((prev) => {
          if (prev) {
            setMessages((msgs) => [
              ...msgs,
              {
                id: `msg-${Date.now()}-final`,
                role: "assistant",
                content: prev,
              },
            ]);
          }
          return "";
        });
        setIsStreaming(false);
        setIsActive(false);
        break;
      }

      case "status": {
        const active = msg.active === true || msg.status === "running" || msg.status === "active";
        setIsActive(active);
        if (!active) setIsStreaming(false);
        break;
      }

      case "message_saved": {
        setMessages((prev) => {
          const exists = prev.find((m) => m.id === msg.message?.id);
          if (exists) {
            return prev.map((m) => (m.id === msg.message.id ? msg.message : m));
          }
          return [...prev, msg.message];
        });
        break;
      }

      case "error": {
        console.error("Thread error:", msg.error);
        setIsStreaming(false);
        setIsActive(false);
        break;
      }

      default:
        break;
    }
  }, []);

  useWebSocket(threadId, handleWsMessage);

  const handleSend = useCallback(
    (content, options) => {
      if (!threadId || !content.trim()) return;

      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content,
          metadata: {},
        },
      ]);
      setIsActive(true);
      setStreamingContent("");

      sendMessage(threadId, content, { projectPath, ...options });
    },
    [threadId, projectPath]
  );

  const handleAbort = useCallback(() => {
    if (threadId) {
      abortThread(threadId);
      setIsStreaming(false);
      setIsActive(false);
    }
  }, [threadId]);

  const handleCompact = useCallback(() => {
    if (!threadId || isActive) return;
    setIsActive(true);
    setStreamingContent("");
    sendMessage(threadId, "/compact", { projectPath });
  }, [threadId, isActive, projectPath]);

  const handleTitleSubmit = () => {
    setEditingTitle(false);
    // TODO: persist title via API if needed
  };

  // isThinking: session is active but no content has arrived yet
  const isThinking = isActive && !streamingContent && !isStreaming;

  if (!threadId) {
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-600 text-sm">
        Select a thread to start chatting
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Top bar — extra top padding for macOS Electron title bar */}
      <div className="flex items-center gap-3 border-b border-zinc-800/60 px-4 pt-10 pb-3 shrink-0" style={{ WebkitAppRegion: 'no-drag' }}>
        <div className="flex flex-col min-w-0 flex-1">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="bg-transparent text-zinc-50 font-semibold text-sm outline-none border-b border-zinc-500 w-full max-w-xs"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTitleSubmit();
                if (e.key === "Escape") {
                  setTitle(threadTitle || "");
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <button
              className="text-zinc-50 font-semibold text-sm truncate text-left hover:text-white transition-colors max-w-xs"
              onClick={() => setEditingTitle(true)}
              title="Click to rename"
            >
              {title || "Untitled Thread"}
            </button>
          )}
          {projectPath && (
            <span className="text-[11px] text-zinc-600 font-mono truncate mt-0.5">
              {projectPath}
            </span>
          )}
        </div>

        {/* Cost + Status */}
        <div className="flex items-center gap-3 shrink-0">
          {sessionCost !== null && (
            <span className="text-[11px] text-zinc-500 font-mono">
              ${sessionCost.toFixed(4)}
            </span>
          )}

          {isActive ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400/80">Active</span>
              <button
                onClick={handleAbort}
                className="ml-2 text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-0.5 rounded border border-red-500/30 hover:border-red-400/40"
              >
                Stop
              </button>
            </>
          ) : (
            <span className="w-2 h-2 rounded-full bg-zinc-700" />
          )}
        </div>
      </div>

      {/* Context usage bar */}
      {contextUsage && <ContextBar usage={contextUsage} onCompact={handleCompact} isActive={isActive} />}

      {/* Message area */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-3 p-6">
            <div className="h-3 w-48 bg-zinc-800 rounded animate-pulse" />
            <div className="h-3 w-64 bg-zinc-800 rounded animate-pulse" />
            <div className="h-3 w-32 bg-zinc-800 rounded animate-pulse" />
          </div>
        ) : (
          <MessageList
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            isThinking={isThinking}
            isSessionActive={isActive}
          />
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 py-3 bg-zinc-950 border-t border-zinc-800/60">
        <InputBar
          onSend={handleSend}
          onAbort={handleAbort}
          isActive={isActive}
          disabled={false}
          threadId={threadId}
        />
      </div>
    </div>
  );
}

const MAX_CONTEXT_TOKENS = 200_000;
const BAR_SEGMENTS = 20;
const CTX_WARNING = 60;
const CTX_COMPACT_SUGGESTION = 75;
const CTX_CRITICAL = 90;

function ContextBar({ usage, onCompact, isActive }) {
  const total = usage.input_tokens;
  const pct = Math.min((total / MAX_CONTEXT_TOKENS) * 100, 100);
  const roundedPct = Math.round(pct);
  const filled = Math.round((pct / 100) * BAR_SEGMENTS);
  const empty = BAR_SEGMENTS - filled;

  // OMC-style thresholds: green → yellow (COMPRESS?) → red (CRITICAL)
  let filledColor = 'text-emerald-500';
  let labelColor = 'text-emerald-500';
  let suffix = '';

  if (roundedPct >= CTX_CRITICAL) {
    filledColor = 'text-red-500';
    labelColor = 'text-red-500';
    suffix = ' CRITICAL';
  } else if (roundedPct >= CTX_COMPACT_SUGGESTION) {
    filledColor = 'text-yellow-500';
    labelColor = 'text-yellow-500';
    suffix = ' COMPRESS?';
  } else if (roundedPct >= CTX_WARNING) {
    filledColor = 'text-yellow-500';
    labelColor = 'text-yellow-500';
  }

  const showWarningBanner = roundedPct >= 80;
  const isCritical = roundedPct >= 90;

  return (
    <div className="shrink-0">
      {/* OMC-style bar: ctx:[████░░░░░░]67% */}
      <div className="flex items-center gap-2 px-4 py-1">
        <span className="text-[11px] font-mono text-zinc-500">ctx:</span>
        <span className="text-[11px] font-mono tracking-tight">
          <span className="text-zinc-600">[</span>
          <span className={filledColor}>{'█'.repeat(filled)}</span>
          <span className="text-zinc-800">{'░'.repeat(empty)}</span>
          <span className="text-zinc-600">]</span>
        </span>
        <span className={`text-[11px] font-mono tabular-nums ${labelColor}`}>
          {roundedPct}%{suffix}
        </span>
        <span className="text-[10px] font-mono text-zinc-700 tabular-nums">
          {(total / 1000).toFixed(0)}k/{MAX_CONTEXT_TOKENS / 1000}k
        </span>

        {/* Compact button — shown when context is getting high */}
        {!isActive && roundedPct >= CTX_COMPACT_SUGGESTION && (
          <button
            onClick={onCompact}
            className={`ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
              isCritical
                ? 'text-red-400 border-red-800/60 bg-red-950/40 hover:bg-red-900/50 hover:text-red-300'
                : 'text-yellow-500 border-yellow-800/50 bg-yellow-950/30 hover:bg-yellow-900/40 hover:text-yellow-400'
            }`}
            title="Compact conversation to free context"
          >
            /compact
          </button>
        )}
      </div>

      {/* Warning banner like OMC: [!] ctx 85% >= 80% threshold - run /compact */}
      {showWarningBanner && (
        <div className={`px-4 py-0.5 text-[10px] font-mono ${isCritical ? 'text-red-500' : 'text-yellow-600'}`}>
          [{isCritical ? '!!' : '!'}] ctx {roundedPct}% {'>'}= 80% threshold — {isActive ? 'waiting...' : 'run /compact'}
        </div>
      )}
    </div>
  );
}

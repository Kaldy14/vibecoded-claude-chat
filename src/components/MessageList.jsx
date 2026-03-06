import { useEffect, useRef, useState, useMemo, Component } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DiffView from "./DiffView.jsx";

// Prevents react-markdown crashes from killing the whole chat
class SafeMarkdownBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prevProps) {
    if (prevProps.content !== this.props.content && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <pre className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
          {this.props.content}
        </pre>
      );
    }
    return this.props.children;
  }
}

// --- Tool colors ---
const TOOL_COLORS = {
  Edit: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400" },
  Write: { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400" },
  Read: { bg: "bg-zinc-500/10", border: "border-zinc-500/30", text: "text-zinc-400" },
  Bash: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400" },
  Glob: { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-400" },
  Grep: { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400" },
  Agent: { bg: "bg-[#e89b47]/10", border: "border-[#e89b47]/30", text: "text-[#e89b47]" },
};
const DEFAULT_TOOL = { bg: "bg-[#e89b47]/10", border: "border-[#e89b47]/30", text: "text-[#e89b47]" };

function getToolStyle(name) {
  return TOOL_COLORS[name] || DEFAULT_TOOL;
}

function ChevronIcon({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className={`flex-shrink-0 text-zinc-500 transition-transform duration-150 ${open ? "rotate-90" : ""}`}>
      <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// --- Claude Avatar (reusable) ---
function ClaudeAvatar() {
  return (
    <div className="flex-shrink-0 w-6 h-6 rounded-md bg-[#e89b47]/15 flex items-center justify-center mt-0.5">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#e89b47]" />
      </svg>
    </div>
  );
}

// --- Thinking Indicator ---
function ThinkingIndicator() {
  return (
    <>
      <style>{`
        @keyframes thinking-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      <div className="message-row">
        <div className="flex items-start gap-3 max-w-4xl">
          <ClaudeAvatar />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="text-xs font-medium text-[#e89b47]/70 mb-1">Claude</div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">Thinking...</span>
              <div
                className="h-1.5 w-48 rounded-full"
                style={{
                  background: 'linear-gradient(90deg, rgba(232,155,71,0.05), rgba(232,155,71,0.18), rgba(232,155,71,0.05))',
                  backgroundSize: '200% 100%',
                  animation: 'thinking-shimmer 1.5s ease-in-out infinite',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Elapsed Time (live counter for working agents) ---
function ElapsedTime({ startTime }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return <span className="tabular-nums">{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}</span>;
}

// --- Subagent working spinner ---
function SubagentSpinner() {
  return (
    <>
      <style>{`
        @keyframes subagent-orbit {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <span className="relative inline-flex items-center justify-center w-4 h-4 flex-shrink-0">
        <span className="absolute w-3.5 h-3.5 rounded-full border border-[#e89b47]/30" />
        <span
          className="absolute w-3.5 h-3.5 rounded-full border-t border-[#e89b47]"
          style={{ animation: 'subagent-orbit 1s linear infinite' }}
        />
        <span className="w-1 h-1 rounded-full bg-[#e89b47]" />
      </span>
    </>
  );
}

// --- Parse token/cost info from agent result text ---
function parseAgentMetrics(resultText) {
  if (!resultText || typeof resultText !== 'string') return null;
  const metrics = {};

  // Try to find token counts (various patterns Claude Code might output)
  const tokenMatch = resultText.match(/(\d[\d,]+)\s*tokens?\s*(used|consumed|total)/i)
    || resultText.match(/(input|output)\s*tokens?[:\s]*(\d[\d,]+)/i);
  if (tokenMatch) {
    metrics.tokens = tokenMatch[0];
  }

  // Cost patterns
  const costMatch = resultText.match(/\$[\d.]+/);
  if (costMatch) {
    metrics.cost = costMatch[0];
  }

  // Duration patterns
  const durationMatch = resultText.match(/(\d+\.?\d*)\s*s(econds?)?/i);
  if (durationMatch) {
    metrics.duration = durationMatch[0];
  }

  return Object.keys(metrics).length > 0 ? metrics : null;
}

// --- Detect subagent-like tools ---
function isSubagentTool(name) {
  return name === "Agent" || name === "Task" || name === "TaskCreate"
    || name === "TaskGet" || name === "TeamCreate" || name === "SendMessage"
    || name.startsWith("dispatch") || name.startsWith("subagent");
}

// --- Tool Block ---
function ToolBlock({ tool, isSessionActive }) {
  const name = tool.name || "Tool";
  const input = tool.input || {};
  const hasDiff = (name === "Edit") && input.file_path && (input.old_string !== undefined || input.new_string !== undefined);
  const hasWriteContent = (name === "Write") && input.file_path && input.content !== undefined;
  const isAgent = isSubagentTool(name);
  const shouldAutoExpand = hasDiff || hasWriteContent || (isAgent && !tool.result);
  const [open, setOpen] = useState(shouldAutoExpand);
  const result = tool.result;
  const style = getToolStyle(name);
  const [spawnTime] = useState(() => Date.now());

  const summary = (() => {
    if (isAgent) {
      // For agents, show the prompt/task as summary
      const prompt = input.prompt || input.task || input.description || input.message;
      if (prompt) {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        return text.length > 100 ? text.slice(0, 100) + "..." : text;
      }
      if (input.subagent_type) return input.subagent_type;
    }
    if (input.file_path || input.path) return input.file_path || input.path;
    if (input.command) {
      const cmd = input.command;
      return cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd;
    }
    if (input.pattern) return input.pattern;
    if (input.query) return input.query;
    return null;
  })();
  const hasBashCmd = (name === "Bash") && input.command;
  const hasResult = result !== undefined && result !== null;
  const isWorking = isAgent && !hasResult && isSessionActive;
  const isGenericInput = !hasDiff && !hasWriteContent && !hasBashCmd && !isAgent && Object.keys(input).length > 0;
  const agentMetrics = useMemo(() => hasResult ? parseAgentMetrics(result) : null, [hasResult, result]);

  // Auto-expand agents when they start working
  useEffect(() => {
    if (isAgent && !hasResult && isSessionActive) setOpen(true);
  }, [isAgent, hasResult, isSessionActive]);

  return (
    <div className={`tool-block rounded-lg border ${isWorking ? 'border-[#e89b47]/40 bg-[#e89b47]/[0.06]' : `${style.border} ${style.bg}`} overflow-hidden transition-colors duration-300`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronIcon open={open} />

        {/* Agent spinner or tool name */}
        {isWorking ? (
          <SubagentSpinner />
        ) : null}
        <span className={`text-xs font-semibold font-mono ${isAgent ? 'text-[#e89b47]' : style.text}`}>{name}</span>

        {/* Subagent type badge */}
        {isAgent && input.subagent_type && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e89b47]/10 text-[#e89b47]/80 font-mono">
            {input.subagent_type}
          </span>
        )}

        {/* Model badge */}
        {isAgent && input.model && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">
            {input.model}
          </span>
        )}

        {summary && (
          <span className="truncate text-xs text-zinc-500 font-mono">{summary}</span>
        )}

        {/* Right side: status */}
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          {isWorking && (
            <>
              <span className="text-[10px] text-[#e89b47]/70 font-mono">
                <ElapsedTime startTime={spawnTime} />
              </span>
              <span className="text-[10px] text-[#e89b47]/60 uppercase tracking-wider">working</span>
            </>
          )}
          {hasResult && !open && !isAgent && (
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">done</span>
          )}
          {hasResult && isAgent && (
            <span className="flex items-center gap-2">
              {agentMetrics?.cost && (
                <span className="text-[10px] text-zinc-500 font-mono">{agentMetrics.cost}</span>
              )}
              {agentMetrics?.tokens && (
                <span className="text-[10px] text-zinc-500 font-mono">{agentMetrics.tokens}</span>
              )}
              <span className="text-[10px] text-emerald-500/70 uppercase tracking-wider">done</span>
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-700/30 bg-zinc-950/30">
          {/* Agent task description */}
          {isAgent && (input.prompt || input.task || input.description) && (
            <div className="p-2">
              <div className="text-[10px] text-zinc-600 mb-1 px-1 uppercase tracking-wider font-medium">Task</div>
              <div className="text-xs text-zinc-300 bg-zinc-950/50 rounded p-2 border border-zinc-700/30 leading-relaxed">
                {(input.prompt || input.task || input.description).length > 500
                  ? (input.prompt || input.task || input.description).slice(0, 500) + "..."
                  : (input.prompt || input.task || input.description)}
              </div>
            </div>
          )}

          {/* Agent working state */}
          {isWorking && (
            <div className="px-3 py-2 flex items-center gap-2">
              <SubagentSpinner />
              <span className="text-xs text-[#e89b47]/60">Subagent is working...</span>
              <span className="text-[10px] text-zinc-600 font-mono ml-auto">
                <ElapsedTime startTime={spawnTime} />
              </span>
            </div>
          )}

          {hasDiff && (
            <div className="p-2">
              <DiffView
                filePath={input.file_path}
                oldContent={input.old_string}
                newContent={input.new_string}
              />
            </div>
          )}

          {hasWriteContent && (
            <div className="p-2">
              <div className="text-[10px] text-zinc-600 mb-1 px-1 uppercase tracking-wider font-medium">New file</div>
              <pre className="whitespace-pre-wrap break-all text-xs text-zinc-300 font-mono bg-zinc-950/50 rounded p-2 max-h-60 overflow-y-auto border border-zinc-700/30">
                {input.content.length > 3000 ? input.content.slice(0, 3000) + "\n... (truncated)" : input.content}
              </pre>
            </div>
          )}

          {hasBashCmd && (
            <div className="p-2">
              <div className="flex items-center gap-1.5 mb-1 px-1">
                <span className="text-orange-400/60 text-xs">$</span>
                <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Command</span>
              </div>
              <pre className="whitespace-pre-wrap break-all text-xs text-zinc-300 font-mono bg-zinc-950/50 rounded p-2 max-h-40 overflow-y-auto border border-zinc-700/30">
                {input.command}
              </pre>
            </div>
          )}

          {isGenericInput && (
            <div className="p-2">
              <div className="text-[10px] text-zinc-600 mb-1 px-1 uppercase tracking-wider font-medium">Input</div>
              <pre className="whitespace-pre-wrap break-all text-xs text-zinc-400 font-mono bg-zinc-950/50 rounded p-2 max-h-48 overflow-y-auto border border-zinc-700/30">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {hasResult && (
            <div className={`p-2 ${(hasDiff || hasWriteContent || hasBashCmd || isGenericInput || isAgent) ? "pt-0" : ""}`}>
              <div className="text-[10px] text-zinc-600 mb-1 px-1 uppercase tracking-wider font-medium">Output</div>
              <pre className="whitespace-pre-wrap break-all text-xs text-zinc-400 font-mono bg-zinc-950/50 rounded p-2 max-h-60 overflow-y-auto border border-zinc-700/30">
                {typeof result === "string"
                  ? (result.length > 5000 ? result.slice(0, 5000) + "\n... (truncated)" : result)
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}

          {/* Agent completion metrics */}
          {hasResult && isAgent && agentMetrics && (
            <div className="px-3 py-1.5 border-t border-zinc-700/20 flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
              {agentMetrics.tokens && <span>{agentMetrics.tokens}</span>}
              {agentMetrics.cost && <span>{agentMetrics.cost}</span>}
              {agentMetrics.duration && <span>{agentMetrics.duration}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Markdown components ---
const mdComponents = {
  pre({ children }) {
    return <div className="md-pre">{children}</div>;
  },
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const lang = match ? match[1] : null;
    const isInline = !className;

    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[0.85em] font-mono border border-zinc-700/50" {...props}>
          {children}
        </code>
      );
    }

    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900 overflow-hidden my-2">
        {lang && (
          <div className="flex items-center px-3 py-1.5 bg-zinc-800/50 border-b border-zinc-700/50">
            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">{lang}</span>
          </div>
        )}
        <pre className="p-3 overflow-x-auto">
          <code className="text-xs text-zinc-200 font-mono leading-relaxed" {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  },
  p({ children }) {
    return <p className="text-sm text-zinc-200 leading-relaxed mb-2 last:mb-0">{children}</p>;
  },
  ul({ children }) {
    return <ul className="list-disc list-outside ml-4 mb-2 space-y-1 text-sm text-zinc-200">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal list-outside ml-4 mb-2 space-y-1 text-sm text-zinc-200">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-sm text-zinc-200 leading-relaxed">{children}</li>;
  },
  h1({ children }) {
    return <h1 className="text-base font-semibold text-zinc-100 mb-2 mt-3">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-sm font-semibold text-zinc-100 mb-1.5 mt-2.5">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-medium text-zinc-200 mb-1 mt-2">{children}</h3>;
  },
  blockquote({ children }) {
    return <blockquote className="border-l-2 border-zinc-600 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>;
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-2">
        <table className="min-w-full text-xs text-zinc-300 border border-zinc-700/50 rounded">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="px-3 py-1.5 text-left bg-zinc-800/50 border-b border-zinc-700/50 font-medium text-zinc-200">{children}</th>;
  },
  td({ children }) {
    return <td className="px-3 py-1.5 border-b border-zinc-800/50">{children}</td>;
  },
  hr() {
    return <hr className="border-zinc-700/50 my-3" />;
  },
  a({ href, children }) {
    return <a href={href} className="text-[#e89b47] hover:text-[#d4882e] underline underline-offset-2" target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};

function SafeMarkdown({ children }) {
  return (
    <SafeMarkdownBoundary content={children}>
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {children}
      </Markdown>
    </SafeMarkdownBoundary>
  );
}

// --- Message Components ---

function UserMessage({ message }) {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
      ? message.content.map((c) => c.text || "").join("")
      : "";

  return (
    <div className="message-row user-message">
      <div className="flex items-start gap-3 max-w-4xl">
        <div className="flex-shrink-0 w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center mt-0.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" className="text-zinc-400" />
            <path d="M4 21v-1a6 6 0 0112 0v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-zinc-400" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-zinc-500 mb-1">You</div>
          <div className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">{text}</div>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ message, streaming, isStreaming, isSessionActive }) {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
      ? message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text || "")
          .join("")
      : "";

  const tools =
    Array.isArray(message.content)
      ? message.content.filter((c) => c.type === "tool_use")
      : [];
  const metaTools = message.metadata?.tools || [];
  const allTools = [...tools, ...metaTools];

  const displayText = streaming ? streaming : text;

  return (
    <div className="message-row assistant-message">
      <div className="flex items-start gap-3 max-w-4xl">
        <ClaudeAvatar />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-xs font-medium text-[#e89b47]/70 mb-1">Claude</div>

          {allTools.map((tool, i) => (
            <ToolBlock key={tool.id || i} tool={tool} isSessionActive={isSessionActive} />
          ))}

          {displayText && (
            <div className="prose-container">
              <SafeMarkdown>{displayText}</SafeMarkdown>
              {isStreaming && (
                <span className="streaming-indicator">
                  <span className="streaming-dot" />
                  <span className="streaming-dot" style={{ animationDelay: "0.15s" }} />
                  <span className="streaming-dot" style={{ animationDelay: "0.3s" }} />
                </span>
              )}
            </div>
          )}

          {/* Cost/token footer */}
          {!isStreaming && message.metadata && (message.metadata.total_cost_usd || message.metadata.duration_ms) && (
            <div className="flex items-center gap-3 mt-1 text-[10px] text-zinc-600 font-mono">
              {message.metadata.total_cost_usd && (
                <span>${message.metadata.total_cost_usd.toFixed(4)}</span>
              )}
              {message.metadata.duration_ms && (
                <span>{(message.metadata.duration_ms / 1000).toFixed(1)}s</span>
              )}
              {message.metadata.num_turns && (
                <span>{message.metadata.num_turns} turns</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SystemMessage({ message, isSessionActive }) {
  const tools =
    message.metadata?.tools ||
    (Array.isArray(message.content)
      ? message.content.filter((c) => c.type === "tool_use")
      : []);

  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
      ? message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text || "")
          .join("")
      : "";

  if (!tools.length && !text) return null;

  return (
    <div className="message-row system-message">
      <div className="max-w-4xl ml-9 space-y-1.5">
        {tools.map((tool, i) => (
          <ToolBlock key={tool.id || i} tool={tool} isSessionActive={isSessionActive} />
        ))}
        {text && !tools.length && (
          <p className="text-xs text-zinc-500 font-mono">{text}</p>
        )}
      </div>
    </div>
  );
}

// --- Main List ---

export default function MessageList({ messages = [], streamingContent = "", isStreaming = false, isThinking = false, isSessionActive = false }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, isThinking]);

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <div className="message-list">
      {messages.length === 0 && !isStreaming && !isThinking && (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-zinc-600">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-zinc-700">
            <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-sm">Send a message to start</span>
        </div>
      )}

      {messages.map((msg, idx) => {
        const isLastAssistant = idx === lastAssistantIdx;

        if (msg.role === "user") {
          return <UserMessage key={msg.id || idx} message={msg} />;
        }
        if (msg.role === "assistant") {
          return (
            <AssistantMessage
              key={msg.id || idx}
              message={msg}
              streaming={isLastAssistant && isStreaming ? streamingContent : undefined}
              isStreaming={isLastAssistant && isStreaming}
              isSessionActive={isSessionActive}
            />
          );
        }
        return <SystemMessage key={msg.id || idx} message={msg} isSessionActive={isSessionActive} />;
      })}

      {/* Streaming content with no prior assistant message */}
      {isStreaming && lastAssistantIdx === -1 && streamingContent && (
        <div className="message-row assistant-message">
          <div className="flex items-start gap-3 max-w-4xl">
            <ClaudeAvatar />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[#e89b47]/70 mb-1">Claude</div>
              <div className="prose-container">
                <SafeMarkdown>{streamingContent}</SafeMarkdown>
                <span className="inline-block w-1.5 h-4 bg-[#e89b47] ml-0.5 animate-pulse align-middle rounded-sm" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Thinking indicator — shown when active but no content yet */}
      {isThinking && <ThinkingIndicator />}

      <div ref={bottomRef} />
    </div>
  );
}

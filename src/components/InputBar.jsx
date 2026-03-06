import { useState, useRef, useEffect } from 'react';

const MODELS = ['opus', 'sonnet', 'haiku'];
const MODES = ['Chat', 'Plan'];
const PERMISSIONS = [
  { label: 'Full access', value: true },
  { label: 'Approve all', value: false },
];

const OMC_AGENTS = [
  { command: '/autopilot', description: 'Full autonomous execution' },
  { command: '/ralph', description: 'Self-referential loop until complete' },
  { command: '/team N', description: 'Coordinated team agents' },
  { command: '/ultrawork', description: 'Parallel execution' },
  { command: '/analyze', description: 'Deep analysis' },
  { command: '/tdd', description: 'Test-driven development' },
];

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export default function InputBar({ onSend, onAbort, isActive, disabled }) {
  const [text, setText] = useState('');
  const [model, setModel] = useState(() => readLS('claude-ui:model', 'opus'));
  const [mode, setMode] = useState(() => readLS('claude-ui:mode', 'Chat'));
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(
    () => readLS('claude-ui:permissions', true)
  );
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const textareaRef = useRef(null);
  const modelRef = useRef(null);
  const modeRef = useRef(null);
  const permRef = useRef(null);
  const agentRef = useRef(null);

  // Persist state to localStorage on change
  useEffect(() => { writeLS('claude-ui:model', model); }, [model]);
  useEffect(() => { writeLS('claude-ui:mode', mode); }, [mode]);
  useEffect(() => { writeLS('claude-ui:permissions', dangerouslySkipPermissions); }, [dangerouslySkipPermissions]);

  // Auto-expand textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
    const maxHeight = lineHeight * 10 + 16;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
  }, [text]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e) {
      if (modelRef.current && !modelRef.current.contains(e.target)) setModelOpen(false);
      if (modeRef.current && !modeRef.current.contains(e.target)) setModeOpen(false);
      if (permRef.current && !permRef.current.contains(e.target)) setPermOpen(false);
      if (agentRef.current && !agentRef.current.contains(e.target)) setAgentOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const content = text.trim();
    if (!content || disabled) return;
    onSend?.(content, { model, mode, dangerouslySkipPermissions });
    setText('');
  }

  function handleAgentSelect(command) {
    setText((prev) => {
      const trimmed = prev.trimStart();
      return command + (trimmed ? ' ' + trimmed : ' ');
    });
    setAgentOpen(false);
    textareaRef.current?.focus();
  }

  const permLabel = dangerouslySkipPermissions ? 'Full access' : 'Approve all';
  const canSend = text.trim().length > 0 && !disabled;

  return (
    <div className="input-container rounded-xl bg-zinc-900/80 border border-zinc-800/60 p-3 flex flex-col gap-2">
      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Ask for follow-up changes or attach images"
        rows={1}
        className="w-full resize-none bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none leading-5 py-1 px-1"
        style={{ maxHeight: '200px', overflowY: 'auto' }}
      />

      {/* Options row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Model selector */}
        <div ref={modelRef} className="relative">
          <button
            onClick={() => { setModelOpen((o) => !o); setModeOpen(false); setPermOpen(false); setAgentOpen(false); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-300 bg-zinc-800 border border-zinc-700/60 hover:bg-zinc-700/70 hover:text-zinc-100 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#e89b47] flex-shrink-0" />
            {model}
            <ChevronDown />
          </button>
          {modelOpen && (
            <div className="dropdown-menu absolute bottom-full mb-1 left-0 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1 z-50 min-w-[100px]">
              {MODELS.map((m) => (
                <button
                  key={m}
                  onClick={() => { setModel(m); setModelOpen(false); }}
                  className={[
                    'w-full text-left px-3 py-1.5 text-xs rounded-md transition-colors',
                    m === model
                      ? 'text-[#e89b47] bg-[#e89b47]/10'
                      : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
                  ].join(' ')}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mode selector */}
        <div ref={modeRef} className="relative">
          <button
            onClick={() => { setModeOpen((o) => !o); setModelOpen(false); setPermOpen(false); setAgentOpen(false); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-300 bg-zinc-800 border border-zinc-700/60 hover:bg-zinc-700/70 hover:text-zinc-100 transition-colors"
          >
            {mode}
            <ChevronDown />
          </button>
          {modeOpen && (
            <div className="dropdown-menu absolute bottom-full mb-1 left-0 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1 z-50 min-w-[90px]">
              {MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setModeOpen(false); }}
                  className={[
                    'w-full text-left px-3 py-1.5 text-xs rounded-md transition-colors',
                    m === mode
                      ? 'text-[#e89b47] bg-[#e89b47]/10'
                      : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
                  ].join(' ')}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Permissions selector */}
        <div ref={permRef} className="relative">
          <button
            onClick={() => { setPermOpen((o) => !o); setModelOpen(false); setModeOpen(false); setAgentOpen(false); }}
            className={[
              'flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-colors',
              dangerouslySkipPermissions
                ? 'text-red-400 bg-red-950/60 border-red-800/60 hover:bg-red-900/60 hover:text-red-300'
                : 'text-zinc-300 bg-zinc-800 border-zinc-700/60 hover:bg-zinc-700/70 hover:text-zinc-100',
            ].join(' ')}
          >
            {permLabel}
            <ChevronDown />
          </button>
          {permOpen && (
            <div className="dropdown-menu absolute bottom-full mb-1 left-0 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1 z-50 min-w-[110px]">
              {PERMISSIONS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setDangerouslySkipPermissions(p.value); setPermOpen(false); }}
                  className={[
                    'w-full text-left px-3 py-1.5 text-xs rounded-md transition-colors',
                    p.value === dangerouslySkipPermissions
                      ? 'text-[#e89b47] bg-[#e89b47]/10'
                      : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
                  ].join(' ')}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* OMC Agents */}
        <div ref={agentRef} className="relative">
          <button
            onClick={() => { setAgentOpen((o) => !o); setModelOpen(false); setModeOpen(false); setPermOpen(false); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-300 bg-zinc-800 border border-zinc-700/60 hover:bg-zinc-700/70 hover:text-zinc-100 transition-colors"
          >
            <span className="text-zinc-500">/</span>
            OMC
            <ChevronDown />
          </button>
          {agentOpen && (
            <div className="dropdown-menu absolute bottom-full mb-1 left-0 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1 z-50 min-w-[220px]">
              {OMC_AGENTS.map((a) => (
                <button
                  key={a.command}
                  onClick={() => handleAgentSelect(a.command)}
                  className="w-full text-left px-3 py-2 flex items-baseline gap-2 rounded-md hover:bg-[#e89b47]/10 transition-colors group"
                >
                  <span className="text-xs text-[#e89b47] font-mono flex-shrink-0">{a.command}</span>
                  <span className="text-xs text-zinc-500 group-hover:text-zinc-400 truncate">{a.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Stop button */}
        {isActive && (
          <button
            onClick={onAbort}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium text-red-300 bg-red-950 border border-red-800 hover:bg-red-900 hover:text-red-200 transition-colors"
          >
            <StopIcon />
            Stop
          </button>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={[
            'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors',
            canSend
              ? 'bg-[#e89b47] text-zinc-950 hover:bg-[#d4882e]'
              : 'bg-zinc-800/60 text-zinc-600 cursor-not-allowed',
          ].join(' ')}
        >
          <SendIcon />
          Send
        </button>
      </div>
    </div>
  );
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="flex-shrink-0 text-zinc-500">
      <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1 6h10M6 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <rect x="2" y="2" width="7" height="7" rx="1" fill="currentColor" />
    </svg>
  );
}

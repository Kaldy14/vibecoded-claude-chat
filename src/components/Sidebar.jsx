import { useState } from 'react';

function relativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function StatusIndicator({ status }) {
  if (status === 'working') {
    return (
      <span className="flex-shrink-0 relative flex items-center justify-center w-4 h-4" title="Working...">
        <span className="absolute w-2.5 h-2.5 rounded-full bg-emerald-400/20 animate-ping" />
        <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-400" />
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[#e89b47]" title="New response" />
    );
  }
  return null;
}

export default function Sidebar({
  projects = [],
  threads = {},
  activeThreadId,
  activeProjectId,
  onSelectThread,
  onCreateThread,
  onCreateProject,
  onDeleteThread,
  onDeleteProject,
  activeSessions = new Set(),
  threadNotifications = new Set(),
}) {
  const [expanded, setExpanded] = useState(() => {
    const map = {};
    projects.forEach((p) => { map[p.id] = true; });
    return map;
  });
  const [hoveredThread, setHoveredThread] = useState(null);
  const [hoveredProject, setHoveredProject] = useState(null);

  function toggleProject(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="flex flex-col h-full w-64 bg-zinc-950 border-r border-zinc-800/60 select-none">
      {/* Header — extra top padding for macOS Electron traffic lights */}
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-zinc-800/60" style={{ WebkitAppRegion: 'no-drag' }}>
        <span className="w-6 h-6 rounded-sm bg-[#e89b47] flex items-center justify-center flex-shrink-0">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="white" strokeWidth="1.5" />
            <path d="M4 6h4M6 4v4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <span className="text-sm font-semibold text-zinc-50 tracking-tight">Claude UI</span>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-2">
        {projects.map((project) => {
          const projectThreads = (threads[project.id] || []).slice().sort(
            (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
          );
          const isOpen = expanded[project.id] !== false;

          return (
            <div key={project.id}>
              {/* Project row */}
              <div
                className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-zinc-800/70 cursor-pointer transition-colors"
                onMouseEnter={() => setHoveredProject(project.id)}
                onMouseLeave={() => setHoveredProject(null)}
              >
                {/* Chevron */}
                <button
                  onClick={() => toggleProject(project.id)}
                  className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="currentColor"
                    className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                  >
                    <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                </button>

                {/* Folder icon */}
                <span className="text-zinc-500 flex-shrink-0">
                  <FolderIcon />
                </span>

                {/* Project name */}
                <span
                  className="flex-1 text-[13px] font-medium text-zinc-200 truncate"
                  onClick={() => toggleProject(project.id)}
                >
                  {project.name}
                </span>

                {/* Actions: + and delete */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); onCreateThread && onCreateThread(project.id); }}
                    className="p-1 rounded-md text-zinc-400 hover:text-[#e89b47] hover:bg-zinc-700/60 transition-colors"
                    title="New thread"
                    aria-label="New thread"
                  >
                    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                      <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteProject && onDeleteProject(project.id); }}
                    className="p-1 rounded-md text-zinc-500 hover:text-red-400 hover:bg-zinc-700/60 transition-colors"
                    title="Delete project"
                    aria-label="Delete project"
                  >
                    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                      <path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Thread list */}
              {isOpen && (
                <div className="ml-4">
                  {projectThreads.length === 0 && (
                    <div className="px-3 py-1.5 text-xs text-zinc-600 italic">No threads yet</div>
                  )}
                  {projectThreads.map((thread) => {
                    const isActive = thread.id === activeThreadId;
                    const hasSession = activeSessions.has(thread.id);
                    const hasNotification = threadNotifications.has(thread.id);
                    const status = hasSession ? 'working' : hasNotification ? 'done' : 'idle';

                    return (
                      <div
                        key={thread.id}
                        className={[
                          'sidebar-thread group relative flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm',
                          isActive
                            ? 'bg-zinc-800/80 border-l-2 border-[#e89b47] text-zinc-50'
                            : hasNotification
                              ? 'border-l-2 border-[#e89b47]/50 text-zinc-200 bg-[#e89b47]/[0.04] hover:bg-zinc-800/70'
                              : 'border-l-2 border-transparent text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200',
                        ].join(' ')}
                        onClick={() => onSelectThread && onSelectThread(thread.id, project.id)}
                        onMouseEnter={() => setHoveredThread(thread.id)}
                        onMouseLeave={() => setHoveredThread(null)}
                      >
                        {/* Status indicator */}
                        <StatusIndicator status={status} />

                        {/* Thread title */}
                        <span className={`flex-1 truncate leading-tight ${hasNotification ? 'font-medium' : ''}`}>
                          {thread.title || 'Untitled'}
                        </span>

                        {/* Relative time (always present for stable layout) */}
                        <span className={`flex-shrink-0 text-xs text-zinc-600 ${hoveredThread === thread.id ? 'invisible' : ''}`}>
                          {relativeTime(thread.updated_at)}
                        </span>

                        {/* Delete button overlaid on hover */}
                        {hoveredThread === thread.id && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteThread && onDeleteThread(thread.id);
                            }}
                            className="absolute right-2 flex-shrink-0 p-1 rounded-md text-zinc-500 hover:text-red-400 hover:bg-zinc-700/60 transition-colors"
                            title="Delete thread"
                            aria-label="Delete thread"
                          >
                            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                              <path d="M2 2l7 7M9 2l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-zinc-800/60">
        <button
          onClick={onCreateProject}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-zinc-500 hover:text-zinc-300 border border-dashed border-zinc-700/60 hover:border-zinc-600 hover:bg-zinc-800/50 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add project
        </button>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import AddProjectModal from './components/AddProjectModal.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';

async function apiFetch(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const headers = rest.method && rest.method !== 'GET'
    ? { 'Content-Type': 'application/json', ...extraHeaders }
    : { ...extraHeaders };
  const res = await fetch(path, { headers, ...rest });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

function readHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return { projectId: null, threadId: null };
  const [projectId, threadId] = hash.split('/');
  return { projectId: projectId || null, threadId: threadId || null };
}

function writeHash(projectId, threadId) {
  if (projectId && threadId) {
    window.location.hash = `${projectId}/${threadId}`;
  } else {
    window.location.hash = '';
  }
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [threads, setThreads] = useState({});
  const initial = readHash();
  const [activeProjectId, setActiveProjectId] = useState(initial.projectId);
  const [activeThreadId, setActiveThreadId] = useState(initial.threadId);
  const [activeSessions, setActiveSessions] = useState(new Set());
  const [showAddProject, setShowAddProject] = useState(false);

  useEffect(() => {
    function onHashChange() {
      const { projectId, threadId } = readHash();
      setActiveProjectId(projectId);
      setActiveThreadId(threadId);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await apiFetch('/api/projects');
      console.log('[claude-ui] projects loaded:', data.length, data);
      setProjects(data);
      const entries = await Promise.all(
        data.map(async (p) => {
          try {
            const t = await apiFetch(`/api/projects/${p.id}/threads`);
            return [p.id, t];
          } catch {
            return [p.id, []];
          }
        })
      );
      setThreads(Object.fromEntries(entries));
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }, []);

  const refreshThreads = useCallback(async (projectId) => {
    try {
      const t = await apiFetch(`/api/projects/${projectId}/threads`);
      setThreads((prev) => ({ ...prev, [projectId]: t }));
    } catch (err) {
      console.error('Failed to load threads:', err);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useWebSocket('*', useCallback((msg) => {
    if (!msg.threadId) return;
    if (msg.type === 'status') {
      const active = msg.active === true;
      setActiveSessions((prev) => {
        if (active && prev.has(msg.threadId)) return prev;
        if (!active && !prev.has(msg.threadId)) return prev;
        const next = new Set(prev);
        if (active) next.add(msg.threadId);
        else next.delete(msg.threadId);
        return next;
      });
    } else if (msg.type === 'claude_message') {
      setActiveSessions((prev) => {
        if (prev.has(msg.threadId)) return prev;
        const next = new Set(prev);
        next.add(msg.threadId);
        return next;
      });
    } else if (msg.type === 'session_ended' || msg.type === 'error') {
      setActiveSessions((prev) => {
        if (!prev.has(msg.threadId)) return prev;
        const next = new Set(prev);
        next.delete(msg.threadId);
        return next;
      });
    }
  }, []));

  const openAddProject = useCallback(() => setShowAddProject(true), []);
  const closeAddProject = useCallback(() => setShowAddProject(false), []);

  const onCreateProject = useCallback(async ({ name, path }) => {
    try {
      await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, path }),
      });
      setShowAddProject(false);
      await refreshProjects();
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  }, [refreshProjects]);

  const onCreateThread = useCallback(async (projectId) => {
    try {
      const thread = await apiFetch(`/api/projects/${projectId}/threads`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refreshThreads(projectId);
      setActiveProjectId(projectId);
      setActiveThreadId(thread.id);
      writeHash(projectId, thread.id);
    } catch (err) {
      console.error('Failed to create thread:', err);
    }
  }, [refreshThreads]);

  const onSelectThread = useCallback((threadId, projectId) => {
    setActiveThreadId(threadId);
    setActiveProjectId(projectId);
    writeHash(projectId, threadId);
  }, []);

  const onDeleteThread = useCallback(async (threadId) => {
    const projectId = Object.keys(threads).find((pid) =>
      (threads[pid] || []).some((t) => t.id === threadId)
    );
    try {
      await apiFetch(`/api/threads/${threadId}`, { method: 'DELETE' });
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setActiveProjectId(null);
        writeHash(null, null);
      }
      if (projectId) await refreshThreads(projectId);
    } catch (err) {
      console.error('Failed to delete thread:', err);
    }
  }, [threads, activeThreadId, refreshThreads]);

  const onDeleteProject = useCallback(async (projectId) => {
    const project = projects.find((p) => p.id === projectId);
    const confirmed = window.confirm(`Delete project "${project?.name ?? projectId}"?`);
    if (!confirmed) return;
    try {
      await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
        setActiveThreadId(null);
        writeHash(null, null);
      }
      await refreshProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  }, [projects, activeProjectId, refreshProjects]);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <AddProjectModal open={showAddProject} onClose={closeAddProject} onSubmit={onCreateProject} />
      <Sidebar
        projects={projects}
        threads={threads}
        activeThreadId={activeThreadId}
        activeProjectId={activeProjectId}
        activeSessions={activeSessions}
        onSelectThread={onSelectThread}
        onCreateThread={onCreateThread}
        onCreateProject={openAddProject}
        onDeleteThread={onDeleteThread}
        onDeleteProject={onDeleteProject}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {activeThreadId ? (
          <ErrorBoundary key={activeThreadId}>
            <ChatPanel
              threadId={activeThreadId}
              projectId={activeProjectId}
              threadTitle={
                activeProjectId && threads[activeProjectId]
                  ? threads[activeProjectId].find((t) => t.id === activeThreadId)?.title
                  : undefined
              }
              projectPath={
                projects.find((p) => p.id === activeProjectId)?.path
              }
            />
          </ErrorBoundary>
        ) : (
          <EmptyState onCreateProject={openAddProject} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreateProject }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center select-none">
      <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800/60 flex items-center justify-center text-zinc-500">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div className="text-center mt-4">
        <p className="text-sm font-medium text-zinc-300">Start a conversation</p>
        <p className="text-xs text-zinc-600 mt-1">Select a thread or create a new project to begin</p>
      </div>
      <p className="mt-4 text-[11px] font-mono text-zinc-700">⌘K to search</p>
      <button
        onClick={onCreateProject}
        className="mt-5 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg px-5 py-2.5 text-sm transition-colors"
      >
        Add project
      </button>
    </div>
  );
}

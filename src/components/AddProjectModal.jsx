import { useState, useEffect, useRef } from 'react';

export default function AddProjectModal({ open, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const nameRef = useRef(null);
  const backdropRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName('');
      setPath('');
      setError('');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    if (!trimmedName) {
      setError('Project name is required');
      nameRef.current?.focus();
      return;
    }
    if (!trimmedPath) {
      setError('Project path is required');
      return;
    }
    onSubmit({ name: trimmedName, path: trimmedPath });
  }

  function handleBackdropClick(e) {
    if (e.target === backdropRef.current) onClose();
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
    >
      <div className="w-full max-w-md mx-4 bg-zinc-950 border border-zinc-800/60 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
          <h2 className="text-sm font-semibold text-zinc-50">Add Project</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="project-name" className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
              Name
            </label>
            <input
              ref={nameRef}
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="My Project"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-[#e89b47]/50 focus:ring-1 focus:ring-[#e89b47]/20 transition-colors"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="project-path" className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
              Path
            </label>
            <input
              id="project-path"
              type="text"
              value={path}
              onChange={(e) => { setPath(e.target.value); setError(''); }}
              placeholder="/Users/you/projects/my-project"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-[#e89b47]/50 focus:ring-1 focus:ring-[#e89b47]/20 transition-colors font-mono text-xs"
              autoComplete="off"
            />
            <p className="text-xs text-zinc-600">Absolute path to the project directory</p>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg text-sm font-semibold text-zinc-950 bg-[#e89b47] hover:bg-[#d4882e] transition-colors"
            >
              Add Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

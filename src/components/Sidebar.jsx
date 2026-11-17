import React, { useEffect, useState } from 'react';
import {
  FolderOpen,
  MessageSquare,
  Plus,
  GitFork,
  Trash2,
  ChevronLeft,
  CornerDownLeft,
  HardDrive,
  Home,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import FileTree from './FileTree.jsx';

function FolderPicker({ onClose }) {
  const setRoot = useStore((s) => s.setRoot);
  const root = useStore((s) => s.root);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(root);

  const load = async (p) => {
    try {
      setData(await api.browseDirs(p));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (p) => {
    try {
      await setRoot(p);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[70vh] w-[640px] flex-col overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs text-text">Open folder as workspace</span>
          <button type="button" onClick={onClose} className="text-xs text-text-faint hover:text-text">
            esc
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            disabled={!data?.parent}
            onClick={() => load(data.parent)}
            className="rounded border border-border px-1.5 py-1 text-text-dim disabled:opacity-30 hover:text-text"
            title="Parent folder"
          >
            <ChevronLeft size={13} />
          </button>
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(e.currentTarget.value)}
            className="flex-1 rounded border border-border bg-bg px-2 py-1 text-xs text-text focus-accent"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => load(manual)}
            className="rounded border border-border px-2 py-1 text-xs text-text-dim hover:text-text"
          >
            Go
          </button>
          <button
            type="button"
            onClick={() => choose(data?.path || manual)}
            className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-[#191919] hover:bg-accent/90"
          >
            Use this folder
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-border px-3 py-1.5 text-2xs text-text-faint">
          <Home size={11} />
          <button type="button" className="hover:text-text" onClick={() => load(data?.home)}>
            {data?.home}
          </button>
          <span className="mx-1">•</span>
          <HardDrive size={11} />
          {(data?.drives || []).map((d) => (
            <button key={d} type="button" className="px-1 hover:text-text" onClick={() => load(d)}>
              {d}
            </button>
          ))}
        </div>

        {error && <div className="border-b border-border px-3 py-1.5 text-2xs text-err">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          <div className="px-2 py-1 text-2xs text-text-faint">{data?.path}</div>
          {(data?.dirs || []).map((d) => (
            <div key={d.path} className="group flex items-center">
              <button
                type="button"
                onDoubleClick={() => load(d.path)}
                onClick={() => load(d.path)}
                className="flex flex-1 items-center gap-2 rounded px-2 py-1 text-left text-xs text-text-dim hover:bg-bg-high hover:text-text"
              >
                <FolderOpen size={12} className="text-accent/70" />
                {d.name}
              </button>
              <button
                type="button"
                onClick={() => choose(d.path)}
                className="mr-2 hidden rounded border border-border px-1.5 py-0.5 text-2xs text-text-dim group-hover:block hover:text-accent"
              >
                open
              </button>
            </div>
          ))}
          {data && data.dirs.length === 0 && (
            <div className="px-2 py-2 text-2xs text-text-faint">No subfolders.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const root = useStore((s) => s.root);
  const sessions = useStore((s) => s.sessions);
  const sessionId = useStore((s) => s.sessionId);
  const resumeSession = useStore((s) => s.resumeSession);
  const forkSession = useStore((s) => s.forkSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const newSession = useStore((s) => s.newSession);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const [picker, setPicker] = useState(false);
  const [tab, setTab] = useState('files');

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions, root]);

  const shortRoot = root ? root.split(/[\\/]/).filter(Boolean).slice(-2).join('/') : '';

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-bg-raised">
      <button
        type="button"
        onClick={() => setPicker(true)}
        title={root}
        className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-left hover:bg-bg-high"
      >
        <FolderOpen size={14} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-text">{shortRoot || 'No folder'}</div>
          <div className="truncate text-2xs text-text-faint">{root}</div>
        </div>
      </button>

      <div className="flex border-b border-border">
        {[
          ['files', 'Files'],
          ['sessions', 'Sessions'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 border-b-2 px-2 py-1.5 text-2xs uppercase tracking-wider transition-colors ${
              tab === key
                ? 'border-accent text-text'
                : 'border-transparent text-text-faint hover:text-text-dim'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'files' ? (
        <FileTree />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-2xs uppercase tracking-wider text-text-faint">History</span>
            <button
              type="button"
              onClick={newSession}
              title="Start fresh session"
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-text-dim hover:border-accent hover:text-accent"
            >
              <Plus size={11} /> New
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`group mb-0.5 rounded px-2 py-1.5 ${
                  sessionId === s.id ? 'bg-bg-high ring-1 ring-accent/40' : 'hover:bg-bg-high'
                }`}
              >
                <button
                  type="button"
                  onClick={() => resumeSession(s.id)}
                  className="flex w-full items-start gap-1.5 text-left"
                >
                  <MessageSquare size={11} className="mt-0.5 shrink-0 text-text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-text-dim">{s.title}</span>
                    <span className="block truncate text-2xs text-text-faint">
                      {new Date(s.updatedAt).toLocaleString()} • {s.messageCount} msgs
                      {s.forkedFrom ? ' • fork' : ''}
                    </span>
                  </span>
                </button>
                <div className="mt-1 hidden gap-1 group-hover:flex">
                  <button
                    type="button"
                    onClick={() => resumeSession(s.id)}
                    className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-text-faint hover:text-accent"
                  >
                    <CornerDownLeft size={10} /> Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => forkSession(s.id)}
                    className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-text-faint hover:text-accent"
                  >
                    <GitFork size={10} /> Fork
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSession(s.id)}
                    className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-text-faint hover:text-err"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
            {!sessions.length && (
              <div className="px-2 py-3 text-2xs text-text-faint">
                No saved sessions yet. They are written as .jsonl under
                <code className="ml-1 text-text-dim">.vishsi/sessions/</code>
              </div>
            )}
          </div>
        </div>
      )}

      {picker && <FolderPicker onClose={() => setPicker(false)} />}
    </aside>
  );
}

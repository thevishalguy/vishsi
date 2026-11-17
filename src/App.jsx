import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Zap, ZapOff, BookOpen, Cpu } from 'lucide-react';
import { useStore } from './lib/store.js';
import Sidebar from './components/Sidebar.jsx';
import ChatPane from './components/ChatPane.jsx';
import WorkspacePane from './components/WorkspacePane.jsx';

function Splitter({ onDrag }) {
  const dragging = useRef(false);

  useEffect(() => {
    const move = (e) => dragging.current && onDrag(e.clientX);
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onDrag]);

  return (
    <div
      onMouseDown={() => {
        dragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent"
    />
  );
}

export default function App() {
  const connect = useStore((s) => s.connect);
  const connected = useStore((s) => s.connected);
  const status = useStore((s) => s.status);
  const settings = useStore((s) => s.settings);
  const [chatWidth, setChatWidth] = useState(0.45);

  useEffect(() => {
    connect();
  }, [connect]);

  const onDrag = useCallback((clientX) => {
    const sidebar = 260;
    const usable = window.innerWidth - sidebar;
    const ratio = (clientX - sidebar) / usable;
    setChatWidth(Math.min(0.75, Math.max(0.25, ratio)));
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-bg text-text">
      {/* title bar */}
      <header className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-bg-raised px-3">
        <span className="flex items-center gap-1.5 text-xs font-medium tracking-tight text-text">
          <span className="h-2 w-2 rounded-sm bg-accent" />
          VishSi
        </span>

        <span className="flex items-center gap-1 text-2xs text-text-faint">
          {connected ? (
            <>
              <Zap size={10} className="text-ok" /> connected
            </>
          ) : (
            <>
              <ZapOff size={10} className="text-err" /> reconnecting…
            </>
          )}
        </span>

        <span className="flex items-center gap-1 text-2xs text-text-faint" title="Active model">
          <Cpu size={10} /> {settings.model || '—'}
        </span>

        {status?.memory && (
          <span
            className="flex items-center gap-1 text-2xs text-ok"
            title="Project memory loaded into the system prompt"
          >
            <BookOpen size={10} /> {status.memory}
          </span>
        )}

        {status && !status.hasApiKey && (
          <span className="text-2xs text-err">no API key — paste one in api_key.txt</span>
        )}
        {status && status.pty && !status.pty.available && (
          <span className="text-2xs text-warn">terminal starts on first use</span>
        )}

        <span className="ml-auto truncate text-2xs text-text-faint" title={status?.root}>
          {status?.root}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1">
          <div style={{ width: `${chatWidth * 100}%` }} className="flex min-w-0">
            <ChatPane />
          </div>
          <Splitter onDrag={onDrag} />
          <div style={{ width: `${(1 - chatWidth) * 100}%` }} className="flex min-w-0">
            <WorkspacePane />
          </div>
        </div>
      </div>
    </div>
  );
}

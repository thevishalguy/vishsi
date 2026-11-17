import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Plus, X, RotateCw } from 'lucide-react';
import { useStore } from '../lib/store.js';

const THEME = {
  background: '#191919',
  foreground: '#E8E6E3',
  cursor: '#D97757',
  cursorAccent: '#191919',
  selectionBackground: 'rgba(217,119,87,0.3)',
  black: '#191919',
  red: '#D96C6C',
  green: '#7FB069',
  yellow: '#E0B252',
  blue: '#6C9BD9',
  magenta: '#B98ACB',
  cyan: '#6FB6B6',
  white: '#E8E6E3',
  brightBlack: '#6B6B6B',
  brightRed: '#E88686',
  brightGreen: '#97C77F',
  brightYellow: '#EDC76A',
  brightBlue: '#86B0E8',
  brightMagenta: '#CBA0DC',
  brightCyan: '#86CCCC',
  brightWhite: '#FFFFFF',
};

function TerminalInstance({ id, active }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const send = useStore((s) => s.send);
  const onPty = useStore((s) => s.onPty);
  const root = useStore((s) => s.root);
  const [error, setError] = useState('');

  useEffect(() => {
    // Creation is deferred by a tick so React StrictMode's mount/unmount/mount
    // cycle never leaves a half-initialised xterm viewport behind (it schedules
    // an internal timer on open() that throws once the terminal is disposed).
    let cleanup = () => {};
    let cancelled = false;
    const startTimer = setTimeout(() => {
      if (cancelled || !hostRef.current) return;
      cleanup = startTerminal();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      cleanup();
    };

    function startTerminal() {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono','Fira Code',Consolas,monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      theme: THEME,
      scrollback: 4000,
      allowProposedApi: true,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    // xterm throws from its viewport if fit() runs while the host has no
    // measurable size (hidden tab, first paint) or after dispose.
    const safeFit = () => {
      const el = hostRef.current;
      if (disposed || !el) return;
      if (el.clientWidth < 20 || el.clientHeight < 20) return;
      try {
        fit.fit();
      } catch {
        /* ignore transient measurement errors */
      }
    };
    requestAnimationFrame(safeFit);

    term.onData((data) => send({ type: 'pty.input', id, data }));
    term.onResize(({ cols, rows }) => send({ type: 'pty.resize', id, cols, rows }));

    const unsub = onPty((msg) => {
      if (msg.id !== id) return;
      if (msg.type === 'pty.data') term.write(msg.data);
      else if (msg.type === 'pty.ready') {
        if (msg.replay) term.write(msg.replay);
        setError('');
      } else if (msg.type === 'pty.exit') {
        term.write(`\r\n\x1b[38;5;245m[process exited with code ${msg.code}]\x1b[0m\r\n`);
      } else if (msg.type === 'pty.error') {
        setError(msg.error);
        term.write(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`);
      }
    });

    send({
      type: 'pty.create',
      id,
      cols: term.cols,
      rows: term.rows,
    });

    const ro = new ResizeObserver(() => requestAnimationFrame(safeFit));
    ro.observe(hostRef.current);

    return () => {
      disposed = true;
      ro.disconnect();
      unsub();
      try {
        term.dispose();
      } catch {
        /* ignore */
      }
    };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const el = hostRef.current;
      if (!el || el.clientWidth < 20 || el.clientHeight < 20) return;
      try {
        fitRef.current?.fit();
        termRef.current?.focus();
      } catch {
        /* ignore */
      }
    }, 60);
    return () => clearTimeout(t);
  }, [active, root]);

  return (
    <div className={`relative h-full w-full ${active ? '' : 'hidden'}`}>
      {error && (
        <div className="absolute inset-x-0 top-0 z-10 border-b border-err/40 bg-err/10 px-3 py-1.5 text-2xs text-err">
          {error}
        </div>
      )}
      <div ref={hostRef} className="xterm-host" />
    </div>
  );
}

export default function TerminalTab({ visible }) {
  const [terms, setTerms] = useState([{ id: 'term_1', label: 'shell 1' }]);
  const [activeId, setActiveId] = useState('term_1');
  const send = useStore((s) => s.send);
  const status = useStore((s) => s.status);
  const counter = useRef(1);

  const addTerm = () => {
    counter.current += 1;
    const id = `term_${counter.current}`;
    setTerms((t) => [...t, { id, label: `shell ${counter.current}` }]);
    setActiveId(id);
  };

  const closeTerm = (id) => {
    send({ type: 'pty.kill', id });
    setTerms((t) => {
      const next = t.filter((x) => x.id !== id);
      if (!next.length) {
        counter.current += 1;
        const fresh = `term_${counter.current}`;
        setActiveId(fresh);
        return [{ id: fresh, label: `shell ${counter.current}` }];
      }
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  };

  const restart = (id) => {
    send({ type: 'pty.kill', id });
    setTerms((t) => t.filter((x) => x.id !== id));
    setTimeout(() => {
      counter.current += 1;
      const fresh = `term_${counter.current}`;
      setTerms((t) => [...t, { id: fresh, label: `shell ${counter.current}` }]);
      setActiveId(fresh);
    }, 120);
  };

  return (
    <div className={`flex h-full min-h-0 flex-col ${visible ? '' : 'hidden'}`}>
      <div className="flex items-center gap-1 border-b border-border bg-bg-raised px-2 py-1">
        {terms.map((t) => (
          <div
            key={t.id}
            className={`group flex items-center gap-1 rounded px-2 py-0.5 text-2xs ${
              activeId === t.id ? 'bg-bg-high text-text' : 'text-text-faint hover:text-text-dim'
            }`}
          >
            <button type="button" onClick={() => setActiveId(t.id)}>
              {t.label}
            </button>
            <button
              type="button"
              onClick={() => closeTerm(t.id)}
              className="hidden text-text-faint hover:text-err group-hover:block"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addTerm}
          title="New shell"
          className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text"
        >
          <Plus size={12} />
        </button>
        <button
          type="button"
          onClick={() => restart(activeId)}
          title="Restart this shell in the current workspace root"
          className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text"
        >
          <RotateCw size={11} />
        </button>
        <span className="ml-auto truncate text-2xs text-text-faint">
          {status?.defaultShell || ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 bg-bg">
        {terms.map((t) => (
          <TerminalInstance key={t.id} id={t.id} active={visible && activeId === t.id} />
        ))}
      </div>
    </div>
  );
}

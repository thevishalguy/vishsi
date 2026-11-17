import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Monitor,
  Smartphone,
  Camera,
  TerminalSquare,
  ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';

export default function BrowserTab({ visible }) {
  const browser = useStore((s) => s.browser);
  const setBrowserUrl = useStore((s) => s.setBrowserUrl);
  const setViewport = useStore((s) => s.setViewport);
  const refreshConsole = useStore((s) => s.refreshBrowserConsole);
  const [input, setInput] = useState(browser.url);
  const [showConsole, setShowConsole] = useState(false);
  const [shot, setShot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const historyRef = useRef({ stack: [browser.url], index: 0 });
  const iframeRef = useRef(null);

  useEffect(() => {
    setInput(browser.url);
    const h = historyRef.current;
    if (h.stack[h.index] !== browser.url) {
      h.stack = [...h.stack.slice(0, h.index + 1), browser.url];
      h.index = h.stack.length - 1;
    }
  }, [browser.url]);

  useEffect(() => {
    if (!visible) return;
    refreshConsole();
    const t = setInterval(refreshConsole, 4000);
    return () => clearInterval(t);
  }, [visible, refreshConsole]);

  const go = (url) => {
    let next = (url || '').trim();
    if (!next) return;
    if (!/^https?:\/\//i.test(next)) next = `http://${next}`;
    setShot(null);
    setNote('');
    setBrowserUrl(next);
  };

  const back = () => {
    const h = historyRef.current;
    if (h.index > 0) {
      h.index -= 1;
      setBrowserUrl(h.stack[h.index]);
    }
  };

  const forward = () => {
    const h = historyRef.current;
    if (h.index < h.stack.length - 1) {
      h.index += 1;
      setBrowserUrl(h.stack[h.index]);
    }
  };

  const reload = () => setBrowserUrl(browser.url);

  const capture = async () => {
    setBusy(true);
    setNote('');
    try {
      await api.navigate(browser.url, false);
      const res = await api.screenshot(false);
      setShot(res.dataUrl);
      await refreshConsole();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  const width = browser.viewport === 'mobile' ? 390 : '100%';
  const errors = (browser.consoleEntries || []).filter((e) =>
    ['error', 'pageerror', 'warning'].includes(e.type)
  );

  return (
    <div className={`flex h-full min-h-0 flex-col ${visible ? '' : 'hidden'}`}>
      <div className="flex items-center gap-1 border-b border-border bg-bg-raised px-2 py-1">
        <button
          type="button"
          onClick={back}
          className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text"
          title="Back"
        >
          <ArrowLeft size={12} />
        </button>
        <button
          type="button"
          onClick={forward}
          className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text"
          title="Forward"
        >
          <ArrowRight size={12} />
        </button>
        <button
          type="button"
          onClick={reload}
          className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text"
          title="Reload"
        >
          <RotateCw size={11} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go(e.currentTarget.value)}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-0.5 text-2xs text-text-dim focus-accent"
          placeholder="http://localhost:3000"
        />
        <div className="flex overflow-hidden rounded border border-border">
          <button
            type="button"
            onClick={() => setViewport('desktop')}
            className={`px-1.5 py-0.5 ${browser.viewport === 'desktop' ? 'bg-bg-high text-accent' : 'text-text-faint'}`}
            title="Desktop viewport"
          >
            <Monitor size={11} />
          </button>
          <button
            type="button"
            onClick={() => setViewport('mobile')}
            className={`px-1.5 py-0.5 ${browser.viewport === 'mobile' ? 'bg-bg-high text-accent' : 'text-text-faint'}`}
            title="Mobile viewport (390px)"
          >
            <Smartphone size={11} />
          </button>
        </div>
        <button
          type="button"
          onClick={capture}
          disabled={busy}
          className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text disabled:opacity-40"
          title="Headless screenshot (works for pages that block iframes)"
        >
          <Camera size={12} />
        </button>
        <button
          type="button"
          onClick={() => setShowConsole((v) => !v)}
          className={`rounded p-1 hover:bg-bg-high ${
            errors.length ? 'text-err' : 'text-text-faint hover:text-text'
          }`}
          title="Console log from the headless browser"
        >
          <TerminalSquare size={12} />
          {errors.length > 0 && <span className="ml-0.5 text-2xs">{errors.length}</span>}
        </button>
        <a
          href={browser.url}
          target="_blank"
          rel="noreferrer"
          className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text"
          title="Open in a real browser tab"
        >
          <ExternalLink size={11} />
        </a>
      </div>

      {note && <div className="border-b border-border px-3 py-1 text-2xs text-err">{note}</div>}

      <div className="min-h-0 flex-1 overflow-auto bg-[#0f0f0f]">
        <div className="mx-auto h-full bg-white" style={{ width, maxWidth: '100%' }}>
          {shot ? (
            <img src={shot} alt="headless screenshot" className="w-full" />
          ) : (
            <iframe
              ref={iframeRef}
              key={browser.iframeKey}
              src={browser.url}
              title="preview"
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          )}
        </div>
      </div>

      {showConsole && (
        <div className="h-40 shrink-0 overflow-y-auto border-t border-border bg-bg px-2 py-1">
          <div className="mb-1 text-2xs uppercase tracking-wider text-text-faint">
            headless console ({browser.consoleEntries.length})
          </div>
          {browser.consoleEntries.map((e, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap text-2xs ${
                e.type === 'error' || e.type === 'pageerror'
                  ? 'text-err'
                  : e.type === 'warning'
                    ? 'text-warn'
                    : 'text-text-dim'
              }`}
            >
              [{e.type}] {e.text}
            </div>
          ))}
          {!browser.consoleEntries.length && (
            <div className="text-2xs text-text-faint">
              Nothing yet. The console is captured by the headless browser — hit the camera button
              or have the agent run browser_navigate.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

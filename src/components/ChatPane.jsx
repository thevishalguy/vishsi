import React, { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Info, AlertTriangle, Sparkles } from 'lucide-react';
import { useStore } from '../lib/store.js';
import ToolCard from './ToolCard.jsx';
import ApprovalBar from './ApprovalBar.jsx';
import PromptInput from './PromptInput.jsx';

function Markdownish({ text }) {
  // Lightweight renderer: fenced code blocks + inline code + paragraphs.
  const parts = String(text || '').split(/```/);
  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const nl = part.indexOf('\n');
          const lang = nl > -1 ? part.slice(0, nl).trim() : '';
          const code = nl > -1 ? part.slice(nl + 1) : part;
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded border border-border bg-bg px-2.5 py-2 text-2xs text-text-dim"
            >
              {lang && <div className="mb-1 text-2xs text-text-faint">{lang}</div>}
              {code.replace(/\n$/, '')}
            </pre>
          );
        }
        return (
          <div key={i} className="whitespace-pre-wrap text-xs leading-relaxed text-text-dim">
            {part.split(/(`[^`]+`)/).map((seg, j) =>
              seg.startsWith('`') && seg.endsWith('`') && seg.length > 2 ? (
                <code key={j} className="rounded bg-bg px-1 py-0.5 text-accent">
                  {seg.slice(1, -1)}
                </code>
              ) : (
                <span key={j}>{seg}</span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReasoningBlock({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-border/70 bg-bg">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-2xs text-text-faint hover:bg-bg-high"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={11} className="text-accent/70" />
        Reasoning ({text.length} chars)
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-border/70 px-2.5 py-2 text-2xs italic text-text-faint">
          {text}
        </pre>
      )}
    </div>
  );
}

function Item({ item }) {
  if (item.kind === 'user') {
    return (
      <div className="my-2 flex gap-2.5">
        <div className="mt-0.5 h-5 w-5 shrink-0 rounded bg-accent/15 text-center text-2xs leading-5 text-accent">
          you
        </div>
        <div className="min-w-0 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-text">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === 'assistant') {
    return (
      <div className="my-2 flex gap-2.5">
        <Sparkles size={13} className="mt-1 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <ReasoningBlock text={item.reasoning} />
          <Markdownish text={item.text} />
        </div>
      </div>
    );
  }
  if (item.kind === 'tool') return <ToolCard item={item} />;
  if (item.kind === 'system') {
    const Icon = item.tone === 'error' ? AlertTriangle : Info;
    const color =
      item.tone === 'error' ? 'text-err' : item.tone === 'warn' ? 'text-warn' : 'text-text-faint';
    return (
      <div className={`my-1.5 flex gap-2 rounded border border-border/70 bg-bg px-2.5 py-1.5 ${color}`}>
        <Icon size={12} className="mt-0.5 shrink-0" />
        <pre className="min-w-0 flex-1 whitespace-pre-wrap text-2xs">{item.text}</pre>
      </div>
    );
  }
  return null;
}

export default function ChatPane() {
  const items = useStore((s) => s.items);
  const streaming = useStore((s) => s.streaming);
  const busy = useStore((s) => s.busy);
  const settings = useStore((s) => s.settings);
  const status = useStore((s) => s.status);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [items, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-bg">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {!items.length && !streaming && (
          <div className="mx-auto mt-10 max-w-lg text-center">
            <div className="mb-2 text-sm text-text">VishSi</div>
            <p className="text-2xs leading-relaxed text-text-faint">
              Local agentic workspace. VishSi reads and edits files in the open folder, runs shell
              commands, and browses URLs — with your approval in Ask mode.
              <br />
              <br />
              Mode: <span className="text-accent">{settings.mode}</span> · Model:{' '}
              <span className="text-accent">{settings.model || '—'}</span>
              <br />
              {status && !status.hasApiKey && (
                <span className="text-err">
                  No API key loaded. Paste one into api_key.txt and reload.
                </span>
              )}
              {status?.memory && (
                <span className="text-ok">Project memory loaded from {status.memory}</span>
              )}
              <br />
              <br />
              Try: <code className="text-text-dim">/help</code>,{' '}
              <code className="text-text-dim">/status</code>, or “list the files here and summarize
              the project”.
            </p>
          </div>
        )}

        {items.map((item) => (
          <Item key={item.id} item={item} />
        ))}

        {streaming && (streaming.text || streaming.thinking) && (
          <div className="my-2 flex gap-2.5">
            <Sparkles size={13} className="mt-1 shrink-0 animate-pulse-soft text-accent" />
            <div className="min-w-0 flex-1">
              {streaming.thinking && (
                <pre className="mb-1 max-h-32 overflow-hidden whitespace-pre-wrap text-2xs italic text-text-faint">
                  {streaming.thinking.slice(-1200)}
                </pre>
              )}
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-text-dim">
                {streaming.text}
                <span className="caret-blink" />
              </div>
            </div>
          </div>
        )}

        {busy && !streaming?.text && !streaming?.thinking && (
          <div className="my-2 flex items-center gap-2 text-2xs text-text-faint">
            <span className="animate-pulse-soft">working…</span>
          </div>
        )}
      </div>

      <ApprovalBar />
      <PromptInput />
    </section>
  );
}

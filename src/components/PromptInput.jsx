import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Square, FileText, SlashSquare } from 'lucide-react';
import { useStore } from '../lib/store.js';

const SLASH_COMMANDS = [
  { cmd: '/clear', help: 'Clear the conversation and start a fresh session' },
  { cmd: '/compact', help: 'Summarize older turns to free context' },
  { cmd: '/model', help: 'Show or set the model — /model <id>' },
  { cmd: '/status', help: 'Show workspace, provider, PTY and browser status' },
  { cmd: '/help', help: 'List the slash commands' },
];

export default function PromptInput() {
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(null); // { kind:'file'|'slash', items, index, token }
  const taRef = useRef(null);

  const busy = useStore((s) => s.busy);
  const fileList = useStore((s) => s.fileList);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const abort = useStore((s) => s.abort);
  const compact = useStore((s) => s.compact);
  const clearChat = useStore((s) => s.clearChat);
  const pushItem = useStore((s) => s.pushItem);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const status = useStore((s) => s.status);
  const root = useStore((s) => s.root);
  const usage = useStore((s) => s.usage);

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  useEffect(autoGrow, [text]);

  const caretToken = (value, caret) => {
    const upto = value.slice(0, caret);
    const atMatch = /@([^\s@]*)$/.exec(upto);
    if (atMatch) return { kind: 'file', token: atMatch[1], start: caret - atMatch[1].length - 1 };
    const slashMatch = /^\/(\w*)$/.exec(upto.trim());
    if (slashMatch && upto.trim() === upto.trimStart()) {
      return { kind: 'slash', token: slashMatch[1], start: 0 };
    }
    return null;
  };

  const updateMenu = (value, caret) => {
    const tok = caretToken(value, caret);
    if (!tok) return setMenu(null);
    if (tok.kind === 'file') {
      const needle = tok.token.toLowerCase();
      const items = fileList
        .filter((f) => f.toLowerCase().includes(needle))
        .slice(0, 8);
      setMenu(items.length ? { ...tok, items, index: 0 } : null);
    } else {
      const items = SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(tok.token));
      setMenu(items.length ? { ...tok, items, index: 0 } : null);
    }
  };

  const applyCompletion = (choice) => {
    const el = taRef.current;
    const caret = el.selectionStart;
    if (menu.kind === 'file') {
      const before = text.slice(0, menu.start);
      const after = text.slice(caret);
      const next = `${before}@${choice} ${after}`;
      setText(next);
      requestAnimationFrame(() => {
        const pos = (before + '@' + choice + ' ').length;
        el.setSelectionRange(pos, pos);
        el.focus();
      });
    } else {
      setText(`${choice} `);
      requestAnimationFrame(() => el.focus());
    }
    setMenu(null);
  };

  const runSlash = (raw) => {
    const [cmd, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd) {
      case '/clear':
        clearChat();
        return true;
      case '/compact':
        compact();
        return true;
      case '/model':
        if (arg) {
          setSettings({ model: arg });
          pushItem({ kind: 'system', tone: 'info', text: `Model set to ${arg}` });
        } else {
          pushItem({
            kind: 'system',
            tone: 'info',
            text: `Model: ${settings.model}\nProvider: ${settings.provider}\nBase URL: ${settings.baseUrl}\n\nAvailable presets:\n${(status?.models || [])
              .map((m) => `  ${m.id}  — ${m.label}`)
              .join('\n')}`,
          });
        }
        return true;
      case '/status':
        pushItem({
          kind: 'system',
          tone: 'info',
          text: [
            `workspace : ${root}`,
            `provider  : ${settings.provider} @ ${settings.baseUrl}`,
            `model     : ${settings.model}`,
            `mode      : ${settings.mode}`,
            `api key   : ${status?.hasApiKey ? `loaded from ${status.apiKeySource}` : 'MISSING — paste one in api_key.txt'}`,
            `key file  : ${status?.keyFile || ''}`,
            `endpoint  : ${status?.endpointFile || ''}`,
            `memory    : ${status?.memory || 'no VISHSI.md / CLAUDE.md found'}`,
            `pty       : ${status?.pty?.available ? 'ready' : `unavailable — ${status?.pty?.error || 'not started'}`}`,
            `browser   : ${status?.browser?.executable || 'none (fetch fallback)'}`,
            `context   : ~${usage.tokens} tokens (${usage.percent}% of ${usage.budget})`,
            `node      : ${status?.nodeVersion}`,
          ].join('\n'),
        });
        return true;
      case '/help':
        pushItem({
          kind: 'system',
          tone: 'info',
          text: SLASH_COMMANDS.map((c) => `${c.cmd.padEnd(10)} ${c.help}`).join('\n'),
        });
        return true;
      default:
        return false;
    }
  };

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    if (value.startsWith('/')) {
      if (runSlash(value)) {
        setText('');
        return;
      }
    }
    sendPrompt(value);
    setText('');
    setMenu(null);
  };

  const onKeyDown = (e) => {
    if (menu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenu({ ...menu, index: (menu.index + 1) % menu.items.length });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenu({ ...menu, index: (menu.index - 1 + menu.items.length) % menu.items.length });
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        const choice = menu.items[menu.index];
        const label = menu.kind === 'file' ? choice : choice.cmd;
        // Enter on an already-complete slash command runs it instead of
        // completing it again.
        if (e.key === 'Enter' && menu.kind === 'slash' && text.trim() === label) {
          e.preventDefault();
          setMenu(null);
          submit();
          return;
        }
        e.preventDefault();
        applyCompletion(label);
        return;
      }
      if (e.key === 'Escape') {
        setMenu(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const modes = useMemo(
    () => [
      ['plan', 'Plan', 'Read-only. Investigates and writes a plan.'],
      ['ask', 'Ask', 'Asks permission before edits and commands.'],
      ['auto', 'Auto', 'Edits and runs commands without asking.'],
    ],
    []
  );

  return (
    <div className="border-t border-border bg-bg-raised">
      {/* mode + model row */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <div className="flex overflow-hidden rounded border border-border">
          {modes.map(([key, label, help]) => (
            <button
              key={key}
              type="button"
              title={help}
              onClick={() => setSettings({ mode: key })}
              className={`px-2 py-0.5 text-2xs transition-colors ${
                settings.mode === key
                  ? 'bg-accent text-[#191919]'
                  : 'text-text-faint hover:bg-bg-high hover:text-text-dim'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={settings.model}
          onChange={(e) => {
            const preset = (status?.models || []).find((m) => m.id === e.target.value);
            setSettings(
              preset
                ? { model: preset.id, provider: preset.provider, baseUrl: preset.baseUrl }
                : { model: e.target.value }
            );
          }}
          className="max-w-[260px] truncate rounded border border-border bg-bg px-1.5 py-0.5 text-2xs text-text-dim hover:text-text"
        >
          {!(status?.models || []).some((m) => m.id === settings.model) && settings.model && (
            <option value={settings.model}>{settings.model} (custom)</option>
          )}
          {(status?.models || []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <div className="h-1 w-24 overflow-hidden rounded-full bg-bg">
            <div
              className={`h-full ${usage.percent > 80 ? 'bg-err' : usage.percent > 55 ? 'bg-warn' : 'bg-accent'}`}
              style={{ width: `${Math.min(100, usage.percent)}%` }}
            />
          </div>
          <span className="text-2xs text-text-faint" title="Estimated context usage">
            {usage.percent}% · ~{usage.tokens.toLocaleString()} tok
          </span>
          <button
            type="button"
            onClick={compact}
            className="rounded border border-border px-1.5 py-0.5 text-2xs text-text-faint hover:border-accent hover:text-accent"
            title="Summarize older turns (/compact)"
          >
            compact
          </button>
        </div>
      </div>

      {/* completion menu */}
      {menu && (
        <div className="max-h-48 overflow-y-auto border-b border-border bg-bg">
          {menu.items.map((it, i) => {
            const label = menu.kind === 'file' ? it : it.cmd;
            const help = menu.kind === 'file' ? '' : it.help;
            const Icon = menu.kind === 'file' ? FileText : SlashSquare;
            return (
              <button
                key={label}
                type="button"
                onMouseEnter={() => setMenu({ ...menu, index: i })}
                onClick={() => applyCompletion(menu.kind === 'file' ? it : it.cmd)}
                className={`flex w-full items-center gap-2 px-3 py-1 text-left text-2xs ${
                  i === menu.index ? 'bg-bg-high text-text' : 'text-text-dim'
                }`}
              >
                <Icon size={11} className="shrink-0 text-accent" />
                <span className="truncate">{label}</span>
                {help && <span className="ml-auto truncate text-text-faint">{help}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2">
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          placeholder="Ask anything. @ for files, / for commands. Enter sends, Shift+Enter newline."
          onChange={(e) => {
            setText(e.target.value);
            updateMenu(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => updateMenu(text, e.currentTarget.selectionStart)}
          className="max-h-[220px] min-h-[36px] flex-1 resize-none rounded-md border border-border bg-bg px-3 py-2 text-xs text-text placeholder:text-text-faint focus-accent"
          spellCheck={false}
        />
        {busy ? (
          <button
            type="button"
            onClick={abort}
            title="Stop"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-dim hover:border-err hover:text-err"
          >
            <Square size={13} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            title="Send (Enter)"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-[#191919] disabled:opacity-30 hover:bg-accent/90"
          >
            <ArrowUp size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

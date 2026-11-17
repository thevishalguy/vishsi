import React, { useState } from 'react';
import {
  FileText,
  FolderTree,
  FilePlus,
  FileDiff,
  TerminalSquare,
  Globe,
  Search,
  MousePointerSquareDashed,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Loader2,
  Undo2,
} from 'lucide-react';
import { DiffText } from './DiffView.jsx';
import { useStore } from '../lib/store.js';

const ICONS = {
  read_file: FileText,
  list_directory: FolderTree,
  write_file: FilePlus,
  edit_file: FileDiff,
  execute_command: TerminalSquare,
  browser_navigate: Globe,
  browser_inspect: MousePointerSquareDashed,
  search_files: Search,
};

export default function ToolCard({ item }) {
  const [open, setOpen] = useState(false);
  const revertSnapshot = useStore((s) => s.revertSnapshot);
  const showDiff = useStore((s) => s.showDiff);
  const Icon = ICONS[item.name] || TerminalSquare;

  const statusDot = {
    running: <Loader2 size={12} className="animate-spin text-accent" />,
    done: <Check size={12} className="text-ok" />,
    error: <X size={12} className="text-err" />,
    denied: <X size={12} className="text-warn" />,
  }[item.status] || null;

  const commandOutput = (item.output || []).map((o) => o.text).join('');

  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-border bg-bg-raised">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-bg-high"
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0 text-text-faint" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-text-faint" />
        )}
        <Icon size={13} className="shrink-0 text-accent" />
        <span className="shrink-0 text-xs text-text">{item.title}</span>
        <span className="min-w-0 flex-1 truncate text-2xs text-text-faint">{item.subtitle}</span>
        {item.meta?.exitCode !== undefined && item.meta.exitCode !== null && (
          <span
            className={`shrink-0 text-2xs ${item.meta.exitCode === 0 ? 'text-ok' : 'text-err'}`}
          >
            exit {item.meta.exitCode}
          </span>
        )}
        {statusDot}
      </button>

      {(open || item.status === 'running') && (
        <div className="border-t border-border px-2.5 py-2">
          {item.name === 'execute_command' && (
            <pre className="mb-2 overflow-x-auto rounded border border-border bg-bg px-2 py-1 text-2xs text-accent">
              $ {item.input?.command}
            </pre>
          )}

          {commandOutput && (
            <pre className="mb-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg px-2 py-1 text-2xs text-text-dim">
              {commandOutput.slice(-8000)}
            </pre>
          )}

          {item.diff && <DiffText patch={item.diff} />}

          {item.snapshotId && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => showDiff(item.path, item.snapshotId)}
                className="rounded border border-border px-2 py-0.5 text-2xs text-text-dim hover:border-accent hover:text-accent"
              >
                Open diff
              </button>
              <button
                type="button"
                onClick={() => revertSnapshot(item.snapshotId)}
                className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-2xs text-text-dim hover:border-err hover:text-err"
              >
                <Undo2 size={10} /> Revert
              </button>
            </div>
          )}

          {open && item.result && !item.diff && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg px-2 py-1 text-2xs text-text-dim">
              {item.result.slice(0, 8000)}
              {item.result.length > 8000 ? '\n… truncated' : ''}
            </pre>
          )}

          {open && !item.result && item.status === 'running' && (
            <div className="text-2xs text-text-faint">running…</div>
          )}
        </div>
      )}
    </div>
  );
}

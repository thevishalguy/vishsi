import React from 'react';

/** Colorize a unified-diff string (what the tools return). */
export function DiffText({ patch, maxLines = 400 }) {
  if (!patch) return null;
  const lines = patch.split('\n').slice(0, maxLines);
  return (
    <pre className="overflow-x-auto rounded border border-border bg-bg p-2 text-2xs leading-relaxed">
      {lines.map((line, i) => {
        let cls = 'text-text-dim';
        if (line.startsWith('+++') || line.startsWith('---')) cls = 'text-text-faint';
        else if (line.startsWith('@@')) cls = 'text-accent';
        else if (line.startsWith('+')) cls = 'bg-ok/10 text-ok';
        else if (line.startsWith('-')) cls = 'bg-err/10 text-err';
        return (
          <div key={i} className={`whitespace-pre px-1 ${cls}`}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

/** Structured row diff (from /api/snapshot/diff) with line numbers. */
export function DiffRows({ rows, stats }) {
  if (!rows) return null;
  return (
    <div className="h-full overflow-auto bg-bg font-mono text-xs">
      {stats && (
        <div className="sticky top-0 flex gap-3 border-b border-border bg-bg-raised px-3 py-1 text-2xs">
          <span className="text-ok">+{stats.added}</span>
          <span className="text-err">-{stats.removed}</span>
        </div>
      )}
      {rows.map((row, i) => {
        if (row.type === 'gap') {
          return (
            <div key={i} className="px-3 py-0.5 text-center text-2xs text-text-faint">
              ⋯
            </div>
          );
        }
        const bg =
          row.type === 'add' ? 'bg-ok/10' : row.type === 'del' ? 'bg-err/10' : '';
        const fg =
          row.type === 'add' ? 'text-ok' : row.type === 'del' ? 'text-err' : 'text-text-dim';
        const sign = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';
        return (
          <div key={i} className={`flex ${bg}`}>
            <span className="w-10 shrink-0 select-none border-r border-border/60 px-1 text-right text-2xs text-text-faint">
              {row.oldNo ?? ''}
            </span>
            <span className="w-10 shrink-0 select-none border-r border-border/60 px-1 text-right text-2xs text-text-faint">
              {row.newNo ?? ''}
            </span>
            <span className={`whitespace-pre px-2 ${fg}`}>
              {sign}
              {row.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

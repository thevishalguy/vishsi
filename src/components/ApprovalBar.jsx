import React from 'react';
import { ShieldAlert, Check, CheckCheck, X } from 'lucide-react';
import { useStore } from '../lib/store.js';

export default function ApprovalBar() {
  const approvals = useStore((s) => s.approvals);
  const approve = useStore((s) => s.approve);
  if (!approvals.length) return null;

  return (
    <div className="border-t border-accent/40 bg-accent/5">
      {approvals.map((a) => (
        <div key={a.requestId} className="px-3 py-2">
          <div className="mb-1.5 flex items-start gap-2">
            <ShieldAlert size={14} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-text">
                Permission needed · <span className="text-accent">{a.title}</span>
              </div>
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg px-2 py-1 text-2xs text-text-dim">
                {a.name === 'execute_command'
                  ? `$ ${a.input?.command}`
                  : JSON.stringify(a.input, null, 2).slice(0, 1200)}
              </pre>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pl-6">
            <button
              type="button"
              onClick={() => approve(a.requestId, 'once')}
              className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-2xs font-medium text-[#191919] hover:bg-accent/90"
            >
              <Check size={11} /> Allow Once
            </button>
            <button
              type="button"
              onClick={() => approve(a.requestId, 'session')}
              className="flex items-center gap-1 rounded border border-accent/60 px-2.5 py-1 text-2xs text-accent hover:bg-accent/10"
              title={`Allow ${a.key} for the rest of this session`}
            >
              <CheckCheck size={11} /> Allow for Session
            </button>
            <button
              type="button"
              onClick={() => approve(a.requestId, 'deny')}
              className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-2xs text-text-dim hover:border-err hover:text-err"
            >
              <X size={11} /> Deny
            </button>
            <span className="self-center text-2xs text-text-faint">rule: {a.key}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

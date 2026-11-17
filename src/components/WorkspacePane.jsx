import React from 'react';
import { TerminalSquare, FileCode2, Globe } from 'lucide-react';
import { useStore } from '../lib/store.js';
import TerminalTab from './TerminalTab.jsx';
import EditorTab from './EditorTab.jsx';
import BrowserTab from './BrowserTab.jsx';

const TABS = [
  ['terminal', 'Terminal', TerminalSquare],
  ['editor', 'Code & Diff', FileCode2],
  ['browser', 'Preview', Globe],
];

export default function WorkspacePane() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const diffView = useStore((s) => s.diffView);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-bg">
      <div className="flex items-center border-b border-border bg-bg-raised">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-2xs transition-colors ${
              activeTab === key
                ? 'border-accent text-text'
                : 'border-transparent text-text-faint hover:text-text-dim'
            }`}
          >
            <Icon size={12} className={activeTab === key ? 'text-accent' : ''} />
            {label}
            {key === 'editor' && diffView && (
              <span className="ml-1 rounded bg-accent/20 px-1 text-2xs text-accent">diff</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        <TerminalTab visible={activeTab === 'terminal'} />
        <EditorTab visible={activeTab === 'editor'} />
        <BrowserTab visible={activeTab === 'browser'} />
      </div>
    </section>
  );
}

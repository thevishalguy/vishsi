import React, { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, indentOnInput, foldGutter, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { Save, Undo2, Check, FileDiff, FileCode2 } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { DiffRows } from './DiffView.jsx';

function languageFor(path = '') {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: true });
    case 'ts':
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'py':
      return python();
    case 'html':
    case 'htm':
      return html();
    case 'css':
    case 'scss':
      return css();
    case 'json':
      return json();
    case 'md':
    case 'markdown':
      return markdown();
    default:
      return [];
  }
}

export default function EditorTab({ visible }) {
  const openFile = useStore((s) => s.openFile);
  const diffView = useStore((s) => s.diffView);
  const setEditorContent = useStore((s) => s.setEditorContent);
  const saveOpenFile = useStore((s) => s.saveOpenFile);
  const revertSnapshot = useStore((s) => s.revertSnapshot);
  const acceptDiff = useStore((s) => s.acceptDiff);
  const [mode, setMode] = useState('code'); // 'code' | 'diff'
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const pathRef = useRef(null);

  useEffect(() => {
    if (diffView) setMode('diff');
  }, [diffView]);

  useEffect(() => {
    if (!hostRef.current || !openFile || openFile.binary) return;
    const samePath = pathRef.current === openFile.path;

    if (viewRef.current && samePath) {
      const current = viewRef.current.state.doc.toString();
      if (current !== openFile.content) {
        viewRef.current.dispatch({
          changes: { from: 0, to: current.length, insert: openFile.content },
        });
      }
      return;
    }

    viewRef.current?.destroy();
    const state = EditorState.create({
      doc: openFile.content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        foldGutter(),
        history(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        autocompletion(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => {
              saveOpenFile();
              return true;
            },
          },
        ]),
        EditorView.lineWrapping,
        EditorView.theme({ '&': { height: '100%' } }, { dark: true }),
        languageFor(openFile.path),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setEditorContent(u.state.doc.toString());
        }),
      ],
    });
    viewRef.current = new EditorView({ state, parent: hostRef.current });
    pathRef.current = openFile.path;

    return () => {
      /* view is torn down on the next file open */
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile?.path, openFile?.content === undefined]);

  useEffect(
    () => () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    },
    []
  );

  // keep the editor doc in sync when the store content changes externally
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !openFile || openFile.dirty) return;
    const current = view.state.doc.toString();
    if (current !== openFile.content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: openFile.content } });
    }
  }, [openFile?.content, openFile?.dirty, openFile]);

  return (
    <div className={`flex h-full min-h-0 flex-col ${visible ? '' : 'hidden'}`}>
      <div className="flex items-center gap-2 border-b border-border bg-bg-raised px-2 py-1">
        <FileCode2 size={12} className="text-accent" />
        <span className="truncate text-2xs text-text-dim">
          {openFile ? openFile.path : 'No file open'}
        </span>
        {openFile?.dirty && <span className="text-2xs text-warn">● unsaved</span>}
        {openFile?.truncated && <span className="text-2xs text-warn">truncated view</span>}

        {diffView && (
          <div className="flex overflow-hidden rounded border border-border">
            <button
              type="button"
              onClick={() => setMode('code')}
              className={`px-2 py-0.5 text-2xs ${mode === 'code' ? 'bg-bg-high text-text' : 'text-text-faint'}`}
            >
              Code
            </button>
            <button
              type="button"
              onClick={() => setMode('diff')}
              className={`flex items-center gap-1 px-2 py-0.5 text-2xs ${
                mode === 'diff' ? 'bg-bg-high text-text' : 'text-text-faint'
              }`}
            >
              <FileDiff size={10} /> Diff
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {diffView && (
            <>
              <button
                type="button"
                onClick={acceptDiff}
                className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-2xs text-text-dim hover:border-ok hover:text-ok"
                title="Keep the agent's change and dismiss the diff"
              >
                <Check size={10} /> Accept
              </button>
              <button
                type="button"
                onClick={() => revertSnapshot(diffView.snapshotId)}
                className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-2xs text-text-dim hover:border-err hover:text-err"
                title="Restore the snapshot taken before the agent's edit"
              >
                <Undo2 size={10} /> Revert
              </button>
            </>
          )}
          <button
            type="button"
            onClick={saveOpenFile}
            disabled={!openFile || openFile.binary}
            className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-2xs text-text-dim disabled:opacity-30 hover:border-accent hover:text-accent"
            title="Save (Ctrl+S)"
          >
            <Save size={10} /> Save
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-bg">
        {!openFile && (
          <div className="flex h-full items-center justify-center text-2xs text-text-faint">
            Pick a file in the explorer, or let the agent open one.
          </div>
        )}
        {openFile?.binary && (
          <div className="flex h-full items-center justify-center text-2xs text-text-faint">
            Binary file — not shown.
          </div>
        )}
        {openFile && !openFile.binary && mode === 'diff' && diffView && (
          <DiffRows rows={diffView.rows} stats={diffView.stats} />
        )}
        <div
          ref={hostRef}
          className={`h-full ${openFile && !openFile.binary && !(mode === 'diff' && diffView) ? '' : 'hidden'}`}
        />
      </div>
    </div>
  );
}

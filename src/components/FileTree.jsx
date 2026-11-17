import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  FilePlus2,
  FolderPlus,
  Pencil,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';

function Node({ entry, depth, onContext }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const openPath = useStore((s) => s.openPath);
  const openFile = useStore((s) => s.openFile);
  const treeVersion = useStore((s) => s.treeVersion);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.list(entry.path);
      setChildren(res.entries);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [entry.path]);

  useEffect(() => {
    if (open) load();
  }, [open, load, treeVersion]);

  const isActive = openFile && openFile.path === entry.path;

  if (entry.type === 'dir') {
    return (
      <div>
        <button
          type="button"
          onClick={() => !entry.ignored && setOpen((v) => !v)}
          onContextMenu={(e) => onContext(e, entry)}
          className={`group flex w-full items-center gap-1 rounded px-1 py-[3px] text-left hover:bg-bg-high ${
            entry.ignored ? 'opacity-40' : ''
          }`}
          style={{ paddingLeft: depth * 12 + 4 }}
          title={entry.ignored ? `${entry.name} (not expanded)` : entry.path}
        >
          {entry.ignored ? (
            <span className="w-3.5" />
          ) : open ? (
            <ChevronDown size={13} className="shrink-0 text-text-faint" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-text-faint" />
          )}
          {open ? (
            <FolderOpen size={13} className="shrink-0 text-accent" />
          ) : (
            <Folder size={13} className="shrink-0 text-accent/70" />
          )}
          <span className="truncate text-xs text-text-dim group-hover:text-text">{entry.name}</span>
        </button>
        {open && (
          <div>
            {loading && !children && (
              <div style={{ paddingLeft: depth * 12 + 24 }} className="py-1 text-2xs text-text-faint">
                loading…
              </div>
            )}
            {children &&
              children.map((child) => (
                <Node key={child.path} entry={child} depth={depth + 1} onContext={onContext} />
              ))}
            {children && children.length === 0 && (
              <div style={{ paddingLeft: depth * 12 + 24 }} className="py-1 text-2xs text-text-faint">
                empty
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openPath(entry.path)}
      onContextMenu={(e) => onContext(e, entry)}
      className={`group flex w-full items-center gap-1 rounded px-1 py-[3px] text-left hover:bg-bg-high ${
        isActive ? 'bg-bg-high' : ''
      }`}
      style={{ paddingLeft: depth * 12 + 21 }}
      title={entry.path}
    >
      <FileIcon size={12} className={`shrink-0 ${isActive ? 'text-accent' : 'text-text-faint'}`} />
      <span
        className={`truncate text-xs ${isActive ? 'text-text' : 'text-text-dim group-hover:text-text'}`}
      >
        {entry.name}
      </span>
    </button>
  );
}

export default function FileTree() {
  const root = useStore((s) => s.root);
  const treeVersion = useStore((s) => s.treeVersion);
  const bumpTree = useStore((s) => s.bumpTree);
  const loadFileList = useStore((s) => s.loadFileList);
  const [entries, setEntries] = useState([]);
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .list('.')
      .then((res) => {
        if (!cancelled) {
          setEntries(res.entries);
          setError('');
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [root, treeVersion]);

  useEffect(() => {
    loadFileList();
  }, [root, loadFileList]);

  const onContext = (e, entry) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const act = async (action) => {
    const entry = menu?.entry;
    setMenu(null);
    try {
      if (action === 'newFile' || action === 'newFolder') {
        const baseDir =
          entry && entry.type === 'dir'
            ? entry.path
            : entry
              ? entry.path.split('/').slice(0, -1).join('/')
              : '.';
        const name = window.prompt(`New ${action === 'newFile' ? 'file' : 'folder'} name:`);
        if (!name) return;
        const target = baseDir && baseDir !== '.' ? `${baseDir}/${name}` : name;
        await api.create(target, action === 'newFile' ? 'file' : 'dir');
      } else if (action === 'rename') {
        const name = window.prompt('New name:', entry.name);
        if (!name || name === entry.name) return;
        const parent = entry.path.split('/').slice(0, -1).join('/');
        await api.rename(entry.path, parent ? `${parent}/${name}` : name);
      } else if (action === 'delete') {
        if (!window.confirm(`Delete ${entry.path}? This cannot be undone.`)) return;
        await api.remove(entry.path);
      }
      bumpTree();
      loadFileList();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onClick={() => menu && setMenu(null)}>
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-2xs uppercase tracking-wider text-text-faint">Explorer</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="New file in root"
            onClick={() => {
              setMenu({ entry: null });
              setTimeout(() => act('newFile'), 0);
            }}
            className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text"
          >
            <FilePlus2 size={13} />
          </button>
          <button
            type="button"
            title="New folder in root"
            onClick={() => {
              setMenu({ entry: null });
              setTimeout(() => act('newFolder'), 0);
            }}
            className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text"
          >
            <FolderPlus size={13} />
          </button>
          <button
            type="button"
            title="Refresh"
            onClick={() => {
              bumpTree();
              loadFileList();
            }}
            className="rounded p-1 text-text-faint hover:bg-bg-high hover:text-text"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {error && <div className="px-2 pb-1 text-2xs text-err">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {entries.map((entry) => (
          <Node key={entry.path} entry={entry} depth={0} onContext={onContext} />
        ))}
        {!entries.length && !error && (
          <div className="px-2 py-3 text-2xs text-text-faint">No files in this folder.</div>
        )}
      </div>

      {menu && menu.x !== undefined && (
        <div
          className="fixed z-50 w-40 overflow-hidden rounded-md border border-border bg-bg-raised py-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem icon={FilePlus2} label="New file" onClick={() => act('newFile')} />
          <MenuItem icon={FolderPlus} label="New folder" onClick={() => act('newFolder')} />
          <MenuItem icon={Pencil} label="Rename" onClick={() => act('rename')} />
          <MenuItem icon={Trash2} label="Delete" danger onClick={() => act('delete')} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-bg-high ${
        danger ? 'text-err' : 'text-text-dim'
      }`}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

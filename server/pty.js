import { IS_WINDOWS } from './config.js';
import { getRoot } from './workspace.js';

let ptyModule = null;
let ptyLoadError = null;

/** Lazy load so the server still boots if the native module is missing. */
async function loadPty() {
  if (ptyModule || ptyLoadError) return ptyModule;
  try {
    ptyModule = await import('@lydell/node-pty');
  } catch (err) {
    ptyLoadError = err;
    ptyModule = null;
  }
  return ptyModule;
}

export function ptyStatus() {
  return {
    available: Boolean(ptyModule),
    error: ptyLoadError ? String(ptyLoadError.message || ptyLoadError) : null,
  };
}

export function defaultShell() {
  if (IS_WINDOWS) {
    return process.env.COMSPEC && process.env.COMSPEC.toLowerCase().includes('cmd')
      ? 'powershell.exe'
      : 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export function shellArgs(shell) {
  const s = shell.toLowerCase();
  if (s.includes('powershell')) return ['-NoLogo', '-NoProfile'];
  if (s.includes('pwsh')) return ['-NoLogo', '-NoProfile'];
  return [];
}

/**
 * Terminal registry. Each entry: { id, proc, shell, cwd, buffer, listeners }
 * `buffer` keeps a bounded scrollback so a reconnecting client (or the agent)
 * can read recent output.
 */
const terminals = new Map();
const MAX_BUFFER = 200_000; // chars

export async function createTerminal({
  id,
  shell = defaultShell(),
  cols = 100,
  rows = 28,
  cwd = getRoot(),
  onData,
  onExit,
}) {
  const mod = await loadPty();
  if (!mod) {
    throw new Error(
      `PTY backend unavailable: ${ptyLoadError ? ptyLoadError.message : 'unknown error'}`
    );
  }
  const proc = mod.spawn(shell, shellArgs(shell), {
    name: 'xterm-color',
    cols,
    rows,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
    useConpty: IS_WINDOWS ? true : undefined,
  });
  const entry = {
    id,
    proc,
    shell,
    cwd,
    buffer: '',
    listeners: new Set(),
    exited: false,
    exitCode: null,
  };
  if (onData) entry.listeners.add(onData);
  proc.onData((data) => {
    entry.buffer = (entry.buffer + data).slice(-MAX_BUFFER);
    for (const fn of entry.listeners) {
      try {
        fn(data);
      } catch {
        /* ignore listener errors */
      }
    }
  });
  proc.onExit(({ exitCode }) => {
    entry.exited = true;
    entry.exitCode = exitCode;
    if (onExit) onExit(exitCode);
  });
  terminals.set(id, entry);
  return entry;
}

export function getTerminal(id) {
  return terminals.get(id) || null;
}

export function listTerminals() {
  return [...terminals.values()].map((t) => ({
    id: t.id,
    shell: t.shell,
    cwd: t.cwd,
    exited: t.exited,
    exitCode: t.exitCode,
  }));
}

export function writeTerminal(id, data) {
  const t = terminals.get(id);
  if (!t || t.exited) return false;
  t.proc.write(data);
  return true;
}

export function resizeTerminal(id, cols, rows) {
  const t = terminals.get(id);
  if (!t || t.exited) return false;
  try {
    t.proc.resize(Math.max(2, cols | 0), Math.max(2, rows | 0));
  } catch {
    return false;
  }
  return true;
}

export function killTerminal(id) {
  const t = terminals.get(id);
  if (!t) return false;
  try {
    t.proc.kill();
  } catch {
    /* already gone */
  }
  terminals.delete(id);
  return true;
}

export function killAllTerminals() {
  for (const id of [...terminals.keys()]) killTerminal(id);
}

export function addTerminalListener(id, fn) {
  const t = terminals.get(id);
  if (!t) return () => {};
  t.listeners.add(fn);
  return () => t.listeners.delete(fn);
}

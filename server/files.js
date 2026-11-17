import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getRoot, safeResolve, toRel, IGNORED_DIRS } from './workspace.js';
import { snapshotFile } from './snapshots.js';

const MAX_READ_BYTES = 512 * 1024; // 512 KB guard, keeps memory low
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar', '.exe', '.dll', '.so',
  '.dylib', '.node', '.mp3', '.mp4', '.mov', '.wav', '.woff', '.woff2',
  '.ttf', '.otf', '.class', '.jar', '.pyc', '.wasm', '.sqlite', '.db',
]);

export function isProbablyBinary(p) {
  return BINARY_EXT.has(path.extname(p).toLowerCase());
}

/** One directory level; cheap enough to call on every expand. */
export async function listDirectory(relPath = '.', { includeIgnored = false } = {}) {
  const abs = safeResolve(relPath);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!includeIgnored && entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
      out.push({
        name: entry.name,
        path: toRel(path.join(abs, entry.name)),
        type: 'dir',
        ignored: true,
        size: 0,
      });
      continue;
    }
    if (entry.name === '.vishsi') continue;
    const childAbs = path.join(abs, entry.name);
    let size = 0;
    let mtime = 0;
    try {
      const st = await fsp.stat(childAbs);
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      /* broken symlink etc. */
    }
    out.push({
      name: entry.name,
      path: toRel(childAbs),
      type: entry.isDirectory() ? 'dir' : 'file',
      size,
      mtime,
      binary: entry.isFile() ? isProbablyBinary(entry.name) : false,
    });
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  return { path: toRel(abs), entries: out };
}

export async function readFile(relPath) {
  const abs = safeResolve(relPath);
  const st = await fsp.stat(abs);
  if (st.isDirectory()) throw new Error(`Is a directory: ${relPath}`);
  if (isProbablyBinary(abs)) {
    return {
      path: toRel(abs),
      binary: true,
      size: st.size,
      content: '',
      truncated: false,
    };
  }
  if (st.size > MAX_READ_BYTES) {
    const fh = await fsp.open(abs, 'r');
    try {
      const buf = Buffer.alloc(MAX_READ_BYTES);
      const { bytesRead } = await fh.read(buf, 0, MAX_READ_BYTES, 0);
      return {
        path: toRel(abs),
        binary: false,
        size: st.size,
        content: buf.subarray(0, bytesRead).toString('utf8'),
        truncated: true,
      };
    } finally {
      await fh.close();
    }
  }
  const content = await fsp.readFile(abs, 'utf8');
  return { path: toRel(abs), binary: false, size: st.size, content, truncated: false };
}

export async function writeFile(relPath, content, { snapshot = true } = {}) {
  const abs = safeResolve(relPath);
  let snap = null;
  if (snapshot) snap = await snapshotFile(abs);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf8');
  const st = await fsp.stat(abs);
  return { path: toRel(abs), size: st.size, snapshot: snap };
}

export async function createEntry(relPath, type) {
  const abs = safeResolve(relPath);
  if (fs.existsSync(abs)) throw new Error(`Already exists: ${toRel(abs)}`);
  if (type === 'dir') {
    await fsp.mkdir(abs, { recursive: true });
  } else {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, '', 'utf8');
  }
  return { path: toRel(abs), type };
}

export async function renameEntry(relFrom, relTo) {
  const from = safeResolve(relFrom);
  const to = safeResolve(relTo);
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.rename(from, to);
  return { from: toRel(from), to: toRel(to) };
}

export async function deleteEntry(relPath) {
  const abs = safeResolve(relPath);
  if (abs === getRoot()) throw new Error('Refusing to delete the workspace root');
  await fsp.rm(abs, { recursive: true, force: true });
  return { path: toRel(abs), deleted: true };
}

/**
 * Recursive, bounded file listing used for @file autocomplete and the
 * agent's own search. Skips ignored dirs and stops at `limit`.
 */
export async function walkFiles({ limit = 4000, maxDepth = 8 } = {}) {
  const root = getRoot();
  const results = [];
  async function walk(dir, depth) {
    if (results.length >= limit || depth > maxDepth) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name === '.vishsi') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(abs, depth + 1);
      } else if (entry.isFile()) {
        results.push(toRel(abs));
      }
    }
  }
  await walk(root, 0);
  return results;
}

/**
 * Loads the project memory file from the workspace root, if present.
 * VISHSI.md is preferred; CLAUDE.md and AGENTS.md are also honoured, so an
 * existing project's rules work without being renamed.
 */
export async function readProjectMemory() {
  const root = getRoot();
  for (const name of ['VISHSI.md', 'vishsi.md', 'CLAUDE.md', 'claude.md', 'AGENTS.md']) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs)) {
      try {
        const text = await fsp.readFile(abs, 'utf8');
        return { name, text: text.slice(0, 32000) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

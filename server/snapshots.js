import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getRoot, toRel } from './workspace.js';

function storeDir() {
  return path.join(getRoot(), '.vishsi', 'snapshots');
}

/** Newest snapshot per absolute file path, for quick "revert last change". */
const latest = new Map();

export async function snapshotFile(absPath) {
  let content = '';
  let existed = true;
  try {
    content = await fsp.readFile(absPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      existed = false;
    } else {
      throw err;
    }
  }
  const dir = storeDir();
  await fsp.mkdir(dir, { recursive: true });
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const meta = {
    id,
    file: toRel(absPath),
    abs: absPath,
    existed,
    at: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(dir, `${id}.snapshot`), content, 'utf8');
  await fsp.writeFile(path.join(dir, `${id}.json`), JSON.stringify(meta, null, 2), 'utf8');
  latest.set(absPath, meta);
  return meta;
}

export function latestSnapshotFor(absPath) {
  return latest.get(absPath) || null;
}

export async function readSnapshot(id) {
  const dir = storeDir();
  const metaPath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
  const content = await fsp.readFile(path.join(dir, `${id}.snapshot`), 'utf8');
  return { meta, content };
}

export async function revertSnapshot(id) {
  const snap = await readSnapshot(id);
  if (!snap) throw new Error(`Unknown snapshot: ${id}`);
  const { meta, content } = snap;
  if (!meta.existed) {
    await fsp.rm(meta.abs, { force: true });
    return { ...meta, reverted: 'deleted' };
  }
  await fsp.mkdir(path.dirname(meta.abs), { recursive: true });
  await fsp.writeFile(meta.abs, content, 'utf8');
  return { ...meta, reverted: 'restored' };
}

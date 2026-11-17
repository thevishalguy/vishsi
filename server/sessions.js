import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getRoot } from './workspace.js';

/**
 * Sessions are append-only JSONL files under <workspace>/.vishsi/sessions.
 * Line 0 is a `meta` record; every later line is a `msg` record holding one
 * provider-neutral message. Resume = replay the file. Fork = copy it.
 */

function sessionsDir() {
  return path.join(getRoot(), '.vishsi', 'sessions');
}

function filePath(id) {
  return path.join(sessionsDir(), `${id}.jsonl`);
}

export function newSessionId() {
  return `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(5).toString('hex')}`;
}

export async function createSession({ title = 'New session', model, provider, baseUrl } = {}) {
  await fsp.mkdir(sessionsDir(), { recursive: true });
  const id = newSessionId();
  const meta = {
    kind: 'meta',
    id,
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    root: getRoot(),
    model: model || null,
    provider: provider || null,
    baseUrl: baseUrl || null,
    forkedFrom: null,
  };
  await fsp.writeFile(filePath(id), `${JSON.stringify(meta)}\n`, 'utf8');
  return meta;
}

export async function appendMessage(id, message) {
  const file = filePath(id);
  if (!fs.existsSync(file)) throw new Error(`Unknown session: ${id}`);
  await fsp.appendFile(file, `${JSON.stringify({ kind: 'msg', at: Date.now(), message })}\n`, 'utf8');
}

export async function appendEvent(id, event) {
  const file = filePath(id);
  if (!fs.existsSync(file)) return;
  await fsp.appendFile(file, `${JSON.stringify({ kind: 'event', at: Date.now(), event })}\n`, 'utf8');
}

export async function replaceMessages(id, messages) {
  const file = filePath(id);
  const meta = await getMeta(id);
  if (!meta) throw new Error(`Unknown session: ${id}`);
  const lines = [JSON.stringify({ ...meta, updatedAt: new Date().toISOString() })];
  for (const message of messages) {
    lines.push(JSON.stringify({ kind: 'msg', at: Date.now(), message }));
  }
  await fsp.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
}

async function readLines(id) {
  const file = filePath(id);
  if (!fs.existsSync(file)) return [];
  const text = await fsp.readFile(file, 'utf8');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip a partially written line */
    }
  }
  return out;
}

export async function getMeta(id) {
  const lines = await readLines(id);
  const meta = lines.find((l) => l.kind === 'meta');
  return meta || null;
}

export async function loadSession(id) {
  const lines = await readLines(id);
  const meta = lines.find((l) => l.kind === 'meta') || null;
  const messages = lines.filter((l) => l.kind === 'msg').map((l) => l.message);
  const events = lines.filter((l) => l.kind === 'event').map((l) => l.event);
  return { meta, messages, events };
}

export async function updateMeta(id, patch) {
  const lines = await readLines(id);
  const metaIdx = lines.findIndex((l) => l.kind === 'meta');
  if (metaIdx === -1) throw new Error(`Unknown session: ${id}`);
  lines[metaIdx] = { ...lines[metaIdx], ...patch, updatedAt: new Date().toISOString() };
  await fsp.writeFile(
    filePath(id),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
    'utf8'
  );
  return lines[metaIdx];
}

export async function listSessions() {
  const dir = sessionsDir();
  if (!fs.existsSync(dir)) return [];
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.jsonl'));
  const metas = [];
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, '');
    try {
      const lines = await readLines(id);
      const meta = lines.find((l) => l.kind === 'meta');
      if (!meta) continue;
      metas.push({
        ...meta,
        messageCount: lines.filter((l) => l.kind === 'msg').length,
      });
    } catch {
      /* skip unreadable */
    }
  }
  metas.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return metas;
}

export async function forkSession(id, { upto = null } = {}) {
  const { meta, messages } = await loadSession(id);
  if (!meta) throw new Error(`Unknown session: ${id}`);
  const slice = upto === null ? messages : messages.slice(0, upto);
  const fresh = await createSession({
    title: `${meta.title} (fork)`,
    model: meta.model,
    provider: meta.provider,
    baseUrl: meta.baseUrl,
  });
  await updateMeta(fresh.id, { forkedFrom: id });
  for (const m of slice) await appendMessage(fresh.id, m);
  return await getMeta(fresh.id);
}

export async function deleteSession(id) {
  await fsp.rm(filePath(id), { force: true });
  return { id, deleted: true };
}

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import fsp from 'node:fs/promises';
import express from 'express';
import { WebSocketServer } from 'ws';

import {
  PORT,
  UI_PORT,
  PROJECT_DIR,
  IS_PROD,
  DEFAULTS,
  MODEL_PRESETS,
  getApiKey,
  getApiKeySource,
  KEY_FILE,
  ENDPOINT_FILE,
  IS_WINDOWS,
  HOME_DIR,
} from './config.js';
import { getRoot, setRoot, safeResolve, toRel } from './workspace.js';
import * as filesApi from './files.js';
import * as sessions from './sessions.js';
import { revertSnapshot, readSnapshot, latestSnapshotFor } from './snapshots.js';
import { buildLineDiff } from './diff.js';
import * as ptyApi from './pty.js';
import * as browserApi from './browser.js';
import { AgentRunner } from './agent.js';
import { TOOLS } from './tools.js';

const app = express();
app.use(express.json({ limit: '12mb' }));

/* --------------------------------- status -------------------------------- */

app.get('/api/status', async (req, res) => {
  res.json({
    ok: true,
    root: getRoot(),
    home: HOME_DIR,
    platform: process.platform,
    nodeVersion: process.version,
    isWindows: IS_WINDOWS,
    hasApiKey: Boolean(getApiKey()),
    apiKeySource: getApiKeySource(),
    keyFile: KEY_FILE,
    endpointFile: ENDPOINT_FILE,
    defaults: DEFAULTS,
    models: MODEL_PRESETS,
    pty: ptyApi.ptyStatus(),
    browser: browserApi.browserStatus(),
    tools: TOOLS.map((t) => ({ name: t.name, mutating: t.mutating })),
    memory: await filesApi.readProjectMemory().then((m) => (m ? m.name : null)),
    defaultShell: ptyApi.defaultShell(),
  });
});

/* ------------------------------- workspace ------------------------------- */

app.post('/api/workspace/root', (req, res) => {
  try {
    const root = setRoot(req.body?.path);
    res.json({ root });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Browse any directory on disk, so the user can pick a workspace root. */
app.get('/api/workspace/browse', async (req, res) => {
  try {
    const target = req.query.path ? path.resolve(String(req.query.path)) : getRoot();
    const entries = await fsp.readdir(target, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(target);
    res.json({
      path: target,
      parent: parent === target ? null : parent,
      dirs,
      drives: IS_WINDOWS ? listWindowsDrives() : ['/'],
      home: HOME_DIR,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function listWindowsDrives() {
  const found = [];
  for (let i = 65; i <= 90; i += 1) {
    const letter = `${String.fromCharCode(i)}:\\`;
    try {
      if (fs.existsSync(letter)) found.push(letter);
    } catch {
      /* ignore */
    }
  }
  return found;
}

/* ---------------------------------- files -------------------------------- */

app.get('/api/fs/list', async (req, res) => {
  try {
    res.json(await filesApi.listDirectory(req.query.path || '.'));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/fs/read', async (req, res) => {
  try {
    res.json(await filesApi.readFile(req.query.path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/fs/write', async (req, res) => {
  try {
    const { path: rel, content } = req.body || {};
    const out = await filesApi.writeFile(rel, content ?? '');
    broadcast({ type: 'fs_changed', path: out.path });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/fs/create', async (req, res) => {
  try {
    const out = await filesApi.createEntry(req.body?.path, req.body?.type || 'file');
    broadcast({ type: 'fs_changed', path: out.path });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/fs/rename', async (req, res) => {
  try {
    const out = await filesApi.renameEntry(req.body?.from, req.body?.to);
    broadcast({ type: 'fs_changed', path: out.to });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/fs/delete', async (req, res) => {
  try {
    const out = await filesApi.deleteEntry(req.body?.path);
    broadcast({ type: 'fs_changed', path: out.path });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/fs/all', async (req, res) => {
  try {
    res.json({ files: await filesApi.walkFiles({}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* -------------------------------- snapshots ------------------------------ */

app.get('/api/snapshot/diff', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const snap = await readSnapshot(id);
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    let current = '';
    try {
      current = (await filesApi.readFile(snap.meta.file)).content;
    } catch {
      current = '';
    }
    res.json({
      meta: snap.meta,
      before: snap.content,
      after: current,
      diff: buildLineDiff(snap.content, current),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/snapshot/revert', async (req, res) => {
  try {
    const out = await revertSnapshot(req.body?.id);
    broadcast({ type: 'fs_changed', path: out.file });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/snapshot/latest', (req, res) => {
  try {
    const abs = safeResolve(req.query.path);
    res.json({ snapshot: latestSnapshotFor(abs) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* --------------------------------- sessions ------------------------------ */

app.get('/api/sessions', async (req, res) => {
  try {
    res.json({ sessions: await sessions.listSessions() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    res.json(await sessions.createSession(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  try {
    res.json(await sessions.loadSession(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/fork', async (req, res) => {
  try {
    res.json(await sessions.forkSession(req.params.id, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/title', async (req, res) => {
  try {
    res.json(await sessions.updateMeta(req.params.id, { title: req.body?.title }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    res.json(await sessions.deleteSession(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* --------------------------------- browser ------------------------------- */

app.post('/api/browser/navigate', async (req, res) => {
  try {
    res.json(await browserApi.navigate(req.body?.url, { screenshot: Boolean(req.body?.screenshot) }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/browser/console', (req, res) => {
  res.json({ entries: browserApi.getConsoleLog() });
});

app.post('/api/browser/screenshot', async (req, res) => {
  try {
    res.json(await browserApi.screenshotPage({ fullPage: Boolean(req.body?.fullPage) }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ------------------------- production static serving --------------------- */

const distDir = path.join(PROJECT_DIR, 'dist');
if (IS_PROD && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

/* --------------------------------- server -------------------------------- */

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  const send = (msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const runner = new AgentRunner({ send });
  const ownedTerminals = new Set();

  send({ type: 'ready', root: getRoot(), settings: runner.settings });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      switch (msg.type) {
        /* ------------------------------ terminal ----------------------- */
        case 'pty.create': {
          const id = msg.id || `term_${Date.now()}`;
          if (ptyApi.getTerminal(id)) {
            send({ type: 'pty.ready', id, replay: ptyApi.getTerminal(id).buffer });
            ptyApi.addTerminalListener(id, (data) => send({ type: 'pty.data', id, data }));
            break;
          }
          try {
            const term = await ptyApi.createTerminal({
              id,
              shell: msg.shell || ptyApi.defaultShell(),
              cols: msg.cols || 100,
              rows: msg.rows || 28,
              cwd: getRoot(),
              onData: (data) => send({ type: 'pty.data', id, data }),
              onExit: (code) => send({ type: 'pty.exit', id, code }),
            });
            ownedTerminals.add(id);
            send({ type: 'pty.ready', id, shell: term.shell, cwd: term.cwd, replay: '' });
          } catch (err) {
            send({ type: 'pty.error', id, error: err.message });
          }
          break;
        }
        case 'pty.input':
          ptyApi.writeTerminal(msg.id, msg.data);
          break;
        case 'pty.resize':
          ptyApi.resizeTerminal(msg.id, msg.cols, msg.rows);
          break;
        case 'pty.kill':
          ptyApi.killTerminal(msg.id);
          ownedTerminals.delete(msg.id);
          break;

        /* ------------------------------- agent ------------------------- */
        case 'agent.settings':
          send({ type: 'agent.settings', settings: runner.setSettings(msg.settings || {}) });
          break;
        case 'agent.attach': {
          const { meta, messages } = await runner.attachSession(msg.sessionId);
          send({ type: 'agent.attached', meta, messages, settings: runner.settings });
          break;
        }
        case 'agent.new': {
          runner.sessionId = null;
          runner.messages = [];
          runner.sessionAllow.clear();
          send({ type: 'agent.attached', meta: null, messages: [], settings: runner.settings });
          break;
        }
        case 'agent.send':
          if (msg.settings) runner.setSettings(msg.settings);
          runner.run(String(msg.text || '')).catch((err) =>
            send({ type: 'agent', ev: { kind: 'error', message: err.message } })
          );
          break;
        case 'agent.approve':
          runner.resolveApproval(msg.requestId, msg.decision);
          break;
        case 'agent.abort':
          runner.abort();
          break;
        case 'agent.compact':
          await runner.compact({ keep: msg.keep ?? 4 });
          break;
        case 'agent.clear':
          runner.messages = [];
          runner.sessionId = null;
          runner.sessionAllow.clear();
          send({ type: 'agent', ev: { kind: 'cleared' } });
          break;

        default:
          break;
      }
    } catch (err) {
      send({ type: 'error', error: err.message });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    runner.abort();
    for (const id of ownedTerminals) ptyApi.killTerminal(id);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  VishSi backend`);
  console.log(`  http://127.0.0.1:${PORT}`);
  console.log(`  workspace: ${getRoot()}`);
  console.log(`  node ${process.version} on ${os.platform()}`);
  console.log(
    `  api key: ${getApiKey() ? `loaded from ${getApiKeySource()}` : 'MISSING — paste one in api_key.txt'}`
  );
  console.log(`  endpoint: ${DEFAULTS.baseUrl}  (provider ${DEFAULTS.provider})`);
  console.log(`  model: ${DEFAULTS.model}`);
  console.log(`  browser: ${browserApi.browserStatus().executable || 'none found (fetch fallback)'}`);
  if (!IS_PROD) console.log(`  dev UI:  http://localhost:${UI_PORT}\n`);
});

// `ws` re-emits the HTTP server's errors on the WebSocketServer. Without a
// listener there, an EADDRINUSE would still be thrown as an unhandled 'error'
// event before the friendly message below could be printed.
wss.on('error', () => {});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      [
        '',
        `  VishSi cannot start: port ${PORT} is already in use.`,
        '',
        '  Another VishSi (or something else) is already listening there.',
        '  Either stop it, or give this copy its own port by putting a line',
        '  like this in .env next to package.json:',
        '',
        `      PORT=${PORT + 10}`,
        '',
        '  The UI picks up the same PORT automatically.',
        '  To see what is holding the port, on Windows:',
        '',
        `      Get-NetTCPConnection -LocalPort ${PORT} -State Listen | Select-Object OwningProcess`,
        '',
      ].join('\n')
    );
  } else {
    console.error(`\n  VishSi failed to start: ${err.message}\n`);
  }
  process.exit(1);
});

function shutdown() {
  ptyApi.killAllTerminals();
  browserApi.closeBrowser().finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

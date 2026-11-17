import { create } from 'zustand';
import { api } from './api.js';

let socket = null;
let reconnectTimer = null;
const outbox = []; // frames queued while the socket is still connecting
const ptyListeners = new Set(); // (msg) => void, raw pty.* frames
let idCounter = 0;
const nextId = () => `i${++idCounter}`;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export const useStore = create((set, get) => ({
  /* ------------------------------ connection ----------------------------- */
  connected: false,
  status: null,
  root: '',

  /* -------------------------------- agent -------------------------------- */
  settings: { mode: 'ask', model: '', provider: 'openai', baseUrl: '' },
  items: [], // ordered chat stream
  streaming: null, // { text, thinking }
  busy: false,
  usage: { tokens: 0, percent: 0, budget: 128000 },
  approvals: [], // [{ requestId, name, input, title, subtitle, key }]

  /* ------------------------------- sessions ------------------------------ */
  sessions: [],
  sessionId: null,

  /* ------------------------------ workspace ------------------------------ */
  fileList: [], // flat list for @mentions
  openFile: null, // { path, content, dirty, binary }
  diffView: null, // { path, rows, stats, snapshotId }
  activeTab: 'terminal',

  /* -------------------------------- browser ------------------------------ */
  browser: { url: 'http://localhost:3000', consoleEntries: [], viewport: 'desktop', iframeKey: 0 },

  /* ------------------------------- actions ------------------------------- */
  connect() {
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    socket = new WebSocket(wsUrl());
    socket.onopen = () => {
      set({ connected: true });
      while (outbox.length) socket.send(JSON.stringify(outbox.shift()));
      get().refreshStatus();
      get().refreshSessions();
    };
    socket.onclose = () => {
      set({ connected: false });
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => get().connect(), 1500);
    };
    socket.onerror = () => socket && socket.close();
    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      get().handleMessage(msg);
    };
  },

  send(msg) {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(msg));
      return;
    }
    // Queue until the socket opens, so a component that mounts before the
    // connection is ready (the terminal, typically) is not silently dropped.
    outbox.push(msg);
    if (outbox.length > 200) outbox.shift();
    get().connect();
  },

  onPty(fn) {
    ptyListeners.add(fn);
    return () => ptyListeners.delete(fn);
  },

  handleMessage(msg) {
    if (msg.type && msg.type.startsWith('pty.')) {
      for (const fn of ptyListeners) fn(msg);
      return;
    }
    switch (msg.type) {
      case 'ready':
        set({ root: msg.root, settings: { ...get().settings, ...msg.settings } });
        break;
      case 'fs_changed':
        get().noteFsChange(msg.path);
        break;
      case 'agent.settings':
        set({ settings: { ...get().settings, ...msg.settings } });
        break;
      case 'agent.attached':
        set({
          sessionId: msg.meta ? msg.meta.id : null,
          items: msg.messages ? messagesToItems(msg.messages) : [],
          settings: { ...get().settings, ...(msg.settings || {}) },
          streaming: null,
          approvals: [],
        });
        break;
      case 'agent':
        get().handleAgentEvent(msg.ev);
        break;
      case 'error':
        get().pushItem({ kind: 'system', tone: 'error', text: msg.error });
        break;
      default:
        break;
    }
  },

  handleAgentEvent(ev) {
    const { items } = get();
    switch (ev.kind) {
      case 'turn_start':
        set({ busy: true, streaming: { text: '', thinking: '' } });
        break;

      case 'text_delta':
        set((s) => ({
          streaming: {
            text: (s.streaming?.text || '') + ev.text,
            thinking: s.streaming?.thinking || '',
          },
        }));
        break;

      case 'thinking_delta':
        set((s) => ({
          streaming: {
            text: s.streaming?.text || '',
            thinking: (s.streaming?.thinking || '') + ev.text,
          },
        }));
        break;

      case 'assistant_message': {
        const next = [...items];
        if (ev.text || ev.reasoning) {
          next.push({
            id: nextId(),
            kind: 'assistant',
            text: ev.text || '',
            reasoning: ev.reasoning || '',
          });
        }
        set({ items: next, streaming: { text: '', thinking: '' } });
        break;
      }

      case 'tool_call':
        set({
          items: [
            ...items,
            {
              id: nextId(),
              kind: 'tool',
              callId: ev.id,
              name: ev.name,
              title: ev.title,
              subtitle: ev.subtitle,
              input: ev.input,
              status: 'running',
              output: [],
              result: null,
              diff: null,
              snapshotId: null,
            },
          ],
        });
        break;

      case 'tool_progress': {
        const next = items.map((item) => {
          if (item.kind !== 'tool' || item.callId !== ev.id) return item;
          const copy = { ...item };
          if (ev.type === 'command_output') {
            copy.output = [...copy.output, { stream: ev.stream, text: ev.text }].slice(-200);
          } else if (ev.type === 'file_diff') {
            copy.diff = ev.diff;
            copy.snapshotId = ev.snapshotId;
            copy.path = ev.path;
          } else if (ev.type === 'open_file') {
            copy.path = ev.path;
          } else if (ev.type === 'browser_navigate') {
            get().setBrowserUrl(ev.url, { fromAgent: true });
          }
          return copy;
        });
        set({ items: next });
        if (ev.type === 'file_diff') {
          get().showDiff(ev.path, ev.snapshotId);
          set({ activeTab: 'editor' });
        }
        if (ev.type === 'fs_changed') get().noteFsChange(ev.path);
        break;
      }

      case 'tool_result':
        set({
          items: items.map((item) =>
            item.kind === 'tool' && item.callId === ev.id
              ? {
                  ...item,
                  status: ev.refused ? 'denied' : ev.is_error ? 'error' : 'done',
                  result: ev.text,
                  meta: ev.meta || {},
                }
              : item
          ),
        });
        break;

      case 'approval_request':
        set({
          approvals: [
            ...get().approvals,
            {
              requestId: ev.requestId,
              name: ev.name,
              input: ev.input,
              title: ev.title,
              subtitle: ev.subtitle,
              key: ev.key,
            },
          ],
        });
        break;

      case 'approval_resolved':
        set({ approvals: get().approvals.filter((a) => a.requestId !== ev.requestId) });
        break;

      case 'usage':
        set({ usage: { tokens: ev.tokens, percent: ev.percent, budget: ev.budget } });
        break;

      case 'session_created':
        set({ sessionId: ev.meta.id });
        get().refreshSessions();
        break;

      case 'compacted':
        get().pushItem({
          kind: 'system',
          tone: 'info',
          text: `Context compacted.\n\n${ev.summary}`,
        });
        break;

      case 'system_note':
        get().pushItem({ kind: 'system', tone: 'info', text: ev.text });
        break;

      case 'error':
        get().pushItem({ kind: 'system', tone: 'error', text: ev.message });
        break;

      case 'cleared':
        set({ items: [], sessionId: null, usage: { tokens: 0, percent: 0, budget: 128000 } });
        break;

      case 'aborted':
        get().pushItem({ kind: 'system', tone: 'warn', text: 'Turn aborted.' });
        break;

      case 'turn_end':
      case 'idle':
        set({ busy: false, streaming: null });
        get().refreshSessions();
        break;

      default:
        break;
    }
  },

  pushItem(item) {
    set({ items: [...get().items, { id: nextId(), ...item }] });
  },

  /* ------------------------------ agent verbs ---------------------------- */
  sendPrompt(text) {
    if (!text.trim()) return;
    get().pushItem({ kind: 'user', text });
    get().send({ type: 'agent.send', text, settings: get().settings });
  },

  approve(requestId, decision) {
    get().send({ type: 'agent.approve', requestId, decision });
  },

  abort() {
    get().send({ type: 'agent.abort' });
  },

  compact() {
    get().send({ type: 'agent.compact', keep: 4 });
  },

  clearChat() {
    get().send({ type: 'agent.clear' });
    set({ items: [], sessionId: null, approvals: [], streaming: null });
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    get().send({ type: 'agent.settings', settings });
  },

  /* ------------------------------- sessions ------------------------------ */
  async refreshStatus() {
    try {
      const status = await api.status();
      set({
        status,
        root: status.root,
        settings: {
          ...get().settings,
          model: get().settings.model || status.defaults.model,
          provider: get().settings.provider || status.defaults.provider,
          baseUrl: get().settings.baseUrl || status.defaults.baseUrl,
        },
      });
    } catch {
      /* server not up yet */
    }
  },

  async refreshSessions() {
    try {
      const { sessions } = await api.sessions();
      set({ sessions });
    } catch {
      /* ignore */
    }
  },

  async resumeSession(id) {
    get().send({ type: 'agent.attach', sessionId: id });
    set({ activeTab: get().activeTab });
  },

  async forkSession(id) {
    const meta = await api.forkSession(id, {});
    await get().refreshSessions();
    get().send({ type: 'agent.attach', sessionId: meta.id });
  },

  async deleteSession(id) {
    await api.deleteSession(id);
    if (get().sessionId === id) get().clearChat();
    await get().refreshSessions();
  },

  newSession() {
    get().send({ type: 'agent.new' });
    set({ items: [], sessionId: null, approvals: [], streaming: null });
  },

  /* ------------------------------- workspace ----------------------------- */
  async setRoot(path) {
    const { root } = await api.setRoot(path);
    set({ root, items: get().items });
    await get().refreshSessions();
    await get().loadFileList();
    get().bumpTree();
  },

  treeVersion: 0,
  bumpTree() {
    set({ treeVersion: get().treeVersion + 1 });
  },

  noteFsChange(path) {
    get().bumpTree();
    const open = get().openFile;
    if (open && open.path === path && !open.dirty) get().openPath(path, { silent: true });
  },

  async loadFileList() {
    try {
      const { files } = await api.allFiles();
      set({ fileList: files });
    } catch {
      set({ fileList: [] });
    }
  },

  async openPath(path, { silent = false } = {}) {
    try {
      const file = await api.read(path);
      set({
        openFile: {
          path: file.path,
          content: file.content,
          binary: file.binary,
          truncated: file.truncated,
          dirty: false,
        },
        diffView: null,
        activeTab: silent ? get().activeTab : 'editor',
      });
    } catch (err) {
      get().pushItem({ kind: 'system', tone: 'error', text: `Open failed: ${err.message}` });
    }
  },

  setEditorContent(content) {
    const open = get().openFile;
    if (!open) return;
    set({ openFile: { ...open, content, dirty: true } });
  },

  async saveOpenFile() {
    const open = get().openFile;
    if (!open || open.binary) return;
    await api.write(open.path, open.content);
    set({ openFile: { ...open, dirty: false } });
  },

  async showDiff(path, snapshotId) {
    if (!snapshotId) return;
    try {
      const res = await api.snapshotDiff(snapshotId);
      set({
        diffView: {
          path,
          rows: res.diff.rows,
          stats: res.diff.stats,
          snapshotId,
        },
        openFile: { path, content: res.after, binary: false, dirty: false },
      });
    } catch {
      /* snapshot may be gone */
    }
  },

  async revertSnapshot(snapshotId) {
    await api.revert(snapshotId);
    set({ diffView: null });
    const open = get().openFile;
    if (open) await get().openPath(open.path, { silent: true });
    get().bumpTree();
  },

  acceptDiff() {
    set({ diffView: null });
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  /* -------------------------------- browser ------------------------------ */
  setBrowserUrl(url, { fromAgent = false } = {}) {
    set({
      browser: { ...get().browser, url, iframeKey: get().browser.iframeKey + 1 },
      activeTab: fromAgent ? 'browser' : get().activeTab,
    });
  },

  setViewport(viewport) {
    set({ browser: { ...get().browser, viewport } });
  },

  async refreshBrowserConsole() {
    try {
      const { entries } = await api.browserConsole();
      set({ browser: { ...get().browser, consoleEntries: entries } });
    } catch {
      /* ignore */
    }
  },
}));

/** Rebuild UI items from a persisted session's provider-neutral messages. */
function messagesToItems(messages) {
  const items = [];
  const resultsByCallId = new Map();
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    for (const b of m.content || []) {
      if (b.type === 'tool_result') resultsByCallId.set(b.tool_use_id, b);
    }
  }
  for (const m of messages) {
    if (m.role === 'tool') continue;
    for (const b of m.content || []) {
      if (b.type === 'text' && b.text) {
        items.push({ id: nextId(), kind: m.role === 'user' ? 'user' : 'assistant', text: b.text });
      } else if (b.type === 'tool_use') {
        const res = resultsByCallId.get(b.id);
        items.push({
          id: nextId(),
          kind: 'tool',
          callId: b.id,
          name: b.name,
          title: b.name,
          subtitle:
            b.input?.path || b.input?.command || b.input?.url || b.input?.selector || '',
          input: b.input,
          status: res ? (res.is_error ? 'error' : 'done') : 'done',
          result: res ? res.text : null,
          output: [],
          diff: null,
        });
      }
    }
  }
  return items;
}

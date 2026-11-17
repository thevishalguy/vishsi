const base = '';

async function request(url, options = {}) {
  const res = await fetch(base + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Bad response from ${url}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText}`);
  return json;
}

const post = (url, body) =>
  request(url, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const api = {
  status: () => request('/api/status'),

  setRoot: (p) => post('/api/workspace/root', { path: p }),
  browseDirs: (p) =>
    request(`/api/workspace/browse${p ? `?path=${encodeURIComponent(p)}` : ''}`),

  list: (p) => request(`/api/fs/list?path=${encodeURIComponent(p ?? '.')}`),
  read: (p) => request(`/api/fs/read?path=${encodeURIComponent(p)}`),
  write: (p, content) => post('/api/fs/write', { path: p, content }),
  create: (p, type) => post('/api/fs/create', { path: p, type }),
  rename: (from, to) => post('/api/fs/rename', { from, to }),
  remove: (p) => post('/api/fs/delete', { path: p }),
  allFiles: () => request('/api/fs/all'),

  snapshotDiff: (id) => request(`/api/snapshot/diff?id=${encodeURIComponent(id)}`),
  revert: (id) => post('/api/snapshot/revert', { id }),
  latestSnapshot: (p) => request(`/api/snapshot/latest?path=${encodeURIComponent(p)}`),

  sessions: () => request('/api/sessions'),
  createSession: (body) => post('/api/sessions', body),
  session: (id) => request(`/api/sessions/${id}`),
  forkSession: (id, body) => post(`/api/sessions/${id}/fork`, body),
  renameSession: (id, title) => post(`/api/sessions/${id}/title`, { title }),
  deleteSession: (id) => request(`/api/sessions/${id}`, { method: 'DELETE' }),

  navigate: (url, screenshot = false) => post('/api/browser/navigate', { url, screenshot }),
  browserConsole: () => request('/api/browser/console'),
  screenshot: (fullPage = false) => post('/api/browser/screenshot', { fullPage }),
};

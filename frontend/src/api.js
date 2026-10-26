const BASE = import.meta.env.VITE_API_URL || '';

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function j(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 401) onUnauthorized?.();
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}

export const fileUrl = (url) => BASE + url;

export const api = {
  authStatus: () => j('/api/auth/status'),
  login: (password) => j('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => j('/api/auth/logout', { method: 'POST', body: '{}' }),
  capabilities: () => j('/api/capabilities'),
  models: () => j('/api/models'),
  chats: (q = '', project = '') => j('/api/chats?q=' + encodeURIComponent(q) + (project ? '&project=' + project : '')),
  createChat: (projectId = null) => j('/api/chats', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  getChat: (id) => j(`/api/chats/${id}`),
  renameChat: (id, title) => j(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deleteChat: (id) => j(`/api/chats/${id}`, { method: 'DELETE' }),
  // XHR (not fetch) so large videos can report upload progress and be cancelled
  upload: (file, { onProgress, signal } = {}) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('file', file);
      xhr.open('POST', BASE + '/api/uploads');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
      xhr.onload = () => {
        if (xhr.status === 401) onUnauthorized?.();
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* not json */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error || 'Upload failed.'));
      };
      xhr.onerror = () => reject(new Error('Upload failed. Check that the backend is running.'));
      xhr.onabort = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(fd);
    }),
  getUpload: (id) => j(`/api/uploads/${id}`),
  deleteUpload: (id) => j(`/api/uploads/${id}`, { method: 'DELETE' }),
  memories: () => j('/api/memories'),
  addMemory: (text) => j('/api/memories', { method: 'POST', body: JSON.stringify({ text }) }),
  updateMemory: (id, text) => j(`/api/memories/${id}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
  deleteMemory: (id) => j(`/api/memories/${id}`, { method: 'DELETE' }),
  clearMemories: () => j('/api/memories', { method: 'DELETE' }),
  projects: () => j('/api/projects'),
  createProject: (b) => j('/api/projects', { method: 'POST', body: JSON.stringify(b) }),
  updateProject: (id, b) => j(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteProject: (id) => j(`/api/projects/${id}`, { method: 'DELETE' }),
  projectFiles: (id) => j(`/api/projects/${id}/files`),
  projectFile: async (id, path) => {
    const r = await fetch(`${BASE}/api/projects/${id}/files/content?path=${encodeURIComponent(path)}`);
    if (!r.ok) { let m = 'Could not open the file.'; try { m = (await r.json()).error || m; } catch { /* */ } throw new Error(m); }
    return r.text();
  },
  deleteProjectFile: (id, path) => j(`/api/projects/${id}/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  projectDownloadUrl: (id) => `${BASE}/api/projects/${id}/download`,
  exportUrl: (id, format) => `${BASE}/api/chats/${id}/export?format=${format}`,
};

// Async generator over server-sent events from the backend.
export async function* streamChat(chatId, body, signal) {
  const r = await fetch(`${BASE}/api/chats/${chatId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (r.status === 401) onUnauthorized?.();
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try { msg = (await r.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try { yield JSON.parse(line.slice(5).trim()); } catch { /* skip */ }
      }
    }
  }
}

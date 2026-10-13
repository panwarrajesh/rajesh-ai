const BASE = import.meta.env.VITE_API_URL || '';

async function j(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}

export const fileUrl = (url) => BASE + url;

export const api = {
  models: () => j('/api/models'),
  chats: (q = '') => j('/api/chats?q=' + encodeURIComponent(q)),
  createChat: () => j('/api/chats', { method: 'POST', body: '{}' }),
  getChat: (id) => j(`/api/chats/${id}`),
  renameChat: (id, title) => j(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deleteChat: (id) => j(`/api/chats/${id}`, { method: 'DELETE' }),
  upload: async (file) => {
    const fd = new FormData();
    fd.append('file', file); // browser sets the multipart boundary
    const r = await fetch(BASE + '/api/uploads', { method: 'POST', body: fd });
    if (!r.ok) {
      let msg = 'Upload failed.';
      try { msg = (await r.json()).error || msg; } catch { /* not json */ }
      throw new Error(msg);
    }
    return r.json();
  },
  deleteUpload: (id) => j(`/api/uploads/${id}`, { method: 'DELETE' }),
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

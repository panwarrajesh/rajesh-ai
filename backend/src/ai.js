// Every call to the Python AI service goes through here, so the shared secret is always attached.
export const AI_URL = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

export function aiFetch(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (process.env.INTERNAL_TOKEN) headers['X-Internal-Token'] = process.env.INTERNAL_TOKEN;
  return fetch(`${AI_URL}${path}`, { ...init, headers });
}

// JSON helper that turns the service's { detail } errors into readable Error messages.
export async function aiJson(path, body, signal) {
  const r = await aiFetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  return readJson(r);
}

export async function readJson(r) {
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(typeof e.detail === 'string' ? e.detail : `AI service error (${r.status}).`);
  }
  return r.json();
}

// Cached capability check for image generation
let cached = { at: 0, value: null };
export async function imageStatus() {
  if (Date.now() - cached.at < 30000 && cached.value) return cached.value;
  let value;
  try {
    const r = await aiFetch('/image/status', { signal: AbortSignal.timeout(6000) });
    value = r.ok ? await r.json() : { available: false, can_edit: false, message: 'Image service error.' };
  } catch {
    value = { available: false, can_edit: false, message: 'The AI service is not reachable.' };
  }
  cached = { at: Date.now(), value };
  return value;
}

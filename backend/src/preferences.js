import { Router } from 'express';
import { db } from './db.js';

export const DEFAULTS = {
  assistant_name: 'Rajesh AI',
  user_name: 'राजेश पंवार',
  greeting: 'नमस्ते राजेश पंवार जी! कैसे हो? मैं आपकी Rajesh AI हूँ। बताइए, मैं आपकी क्या मदद कर सकती हूँ?',
};
const LIMITS = { assistant_name: 40, user_name: 60, greeting: 400 };

export function getPrefs() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM preferences').all()) if (r.key in DEFAULTS) out[r.key] = r.value;
  return out;
}

// Only the known keys are accepted. An empty value means "go back to the default".
export function setPrefs(input) {
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof input?.[key] !== 'string') continue;
    const clean = input[key].replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS[key]);
    if (!clean) db.prepare('DELETE FROM preferences WHERE key = ?').run(key);
    else db.prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, clean, Date.now());
  }
  return getPrefs();
}

const router = Router();
router.get('/', (_req, res) => res.json({ ...getPrefs(), defaults: DEFAULTS }));
router.put('/', (req, res) => res.json({ ...setPrefs(req.body), defaults: DEFAULTS }));
router.delete('/', (_req, res) => { db.prepare('DELETE FROM preferences').run(); res.json({ ...getPrefs(), defaults: DEFAULTS }); });
export default router;

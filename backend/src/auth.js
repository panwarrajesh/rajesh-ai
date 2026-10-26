// Single-owner password login with a signed, HTTP-only session cookie. No extra dependencies.
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { limiter } from './ratelimit.js';

const PASSWORD = process.env.APP_PASSWORD || '';
export const authEnabled = Boolean(PASSWORD);
const COOKIE = 'rajesh_session';
const DAYS = 30;

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dir = process.env.DATA_DIR || './data';
  const file = path.join(dir, '.session_secret'); // generated once, so logins survive restarts
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, secret, { mode: 0o600 }); } catch { /* in-memory only */ }
  return secret;
}
const SECRET = authEnabled ? loadSecret() : '';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (exp) => crypto.createHmac('sha256', SECRET).update(String(exp)).digest('base64url');

export function makeToken() {
  const exp = Date.now() + DAYS * 864e5;
  return `${exp}.${sign(exp)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  const good = Buffer.from(sign(Number(exp)));
  const given = Buffer.from(sig);
  return good.length === given.length && crypto.timingSafeEqual(good, given);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const isAuthenticated = (req) => !authEnabled || verifyToken(parseCookies(req.headers.cookie)[COOKIE]);

export function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Please log in.', login: true });
}

const cookie = (req, value, maxAge) =>
  `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}` +
  (req.secure || process.env.COOKIE_SECURE === '1' ? '; Secure' : '');

const router = Router();
router.get('/status', (req, res) => res.json({ authRequired: authEnabled, authenticated: isAuthenticated(req) }));

router.post('/login', limiter('login', 10, 15 * 60 * 1000), (req, res) => {
  if (!authEnabled) return res.json({ ok: true });
  const ok = crypto.timingSafeEqual(sha(req.body?.password ?? ''), sha(PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Wrong password.' });
  res.setHeader('Set-Cookie', cookie(req, makeToken(), DAYS * 86400));
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', cookie(req, '', 0));
  res.json({ ok: true });
});

export default router;

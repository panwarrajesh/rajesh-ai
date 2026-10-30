import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import chats from './chats.js';
import memories from './memories.js';
import projects from './projects.js';
import preferences from './preferences.js';
import voice from './voice.js';
import auth, { authEnabled, requireAuth } from './auth.js';
import { limiter } from './ratelimit.js';
import uploads, { cleanupPending, failInterrupted } from './uploads.js';
import { AI_URL, aiFetch, imageStatus } from './ai.js';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1); // behind nginx / Docker

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// CORS is off unless you list origins; the normal setup is same-origin (Vite proxy or nginx).
const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (origins.length) app.use(cors({ origin: origins, credentials: true }));

// Basic CSRF defence for state-changing requests: a browser Origin must match this host (or an allowed origin).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  try {
    if (new URL(origin).host === req.headers.host || origins.includes(origin)) return next();
  } catch { /* fall through */ }
  res.status(403).json({ error: 'Blocked a cross-site request.' });
});

app.use(express.json({ limit: '2mb' }));
app.use('/api', limiter('api', 600, 60 * 1000));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', auth);
app.use('/api', requireAuth); // everything below needs a login when APP_PASSWORD is set

app.use('/api/chats/:id/stream', limiter('stream', 40, 60 * 1000));
app.post('/api/uploads', limiter('upload', 60, 10 * 60 * 1000));
app.use('/api/transcribe', limiter('stt', 60, 60 * 1000), voice);

app.get('/api/capabilities', async (_req, res) => res.json({ image: await imageStatus(), auth: authEnabled }));

app.get('/api/models', async (_req, res) => {
  try {
    const r = await aiFetch('/models', { signal: AbortSignal.timeout(15000) });
    res.json(await r.json());
  } catch {
    res.json({
      providers: [],
      error: `The AI service isn't running at ${AI_URL}. Start it with: cd ai-service && uvicorn main:app --port 8000`,
    });
  }
});

app.use('/api/chats', chats);
app.use('/api/uploads', uploads);
app.use('/api/memories', memories);
app.use('/api/projects', projects);
app.use('/api/preferences', preferences);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

failInterrupted();
cleanupPending();
setInterval(cleanupPending, 36e5).unref();

const port = Number(process.env.PORT || 5000);
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Rajesh AI backend on http://localhost:${port}`);
  if (!authEnabled) console.warn('WARNING: APP_PASSWORD is not set, so there is no login. Use this on your own computer only.');
  if (authEnabled && String(process.env.APP_PASSWORD).length < 8) console.warn('WARNING: APP_PASSWORD is short. Use at least 8 characters.');
  if (!process.env.INTERNAL_TOKEN) console.warn('Note: INTERNAL_TOKEN is not set, so the AI service accepts calls from anything that can reach it.');
});
server.requestTimeout = 0; // allow slow uploads of large videos

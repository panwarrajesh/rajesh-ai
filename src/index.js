import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import chats from './chats.js';
import uploads, { cleanupPending } from './uploads.js';

const AI_URL = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/models', async (_req, res) => {
  try {
    const r = await fetch(`${AI_URL}/models`, { signal: AbortSignal.timeout(15000) });
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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

cleanupPending();
setInterval(cleanupPending, 36e5).unref();

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`Rajesh AI backend on http://localhost:${port}`));

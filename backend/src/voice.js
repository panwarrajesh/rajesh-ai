import { Router } from 'express';
import multer from 'multer';
import { AI_URL, aiFetch } from './ai.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const EXT = { 'audio/webm': '.webm', 'video/webm': '.webm', 'audio/mp4': '.mp4', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/mpeg': '.mp3' };
const router = Router();

// Fallback for browsers without built-in speech recognition (and for people who prefer not to send audio to Google).
router.post('/',
  (req, res, next) => upload.single('audio')(req, res, (err) => {
    if (!err) return next();
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That recording is too long.' : 'Upload failed.' });
  }),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio received.' });
    const lang = /^[a-z]{2}$/.test(req.body?.lang || '') ? req.body.lang : '';
    try {
      const fd = new FormData();
      const base = String(req.file.mimetype || '').split(';')[0];
      fd.append('file', new Blob([req.file.buffer], { type: base }), 'speech' + (EXT[base] || '.webm'));
      fd.append('lang', lang);
      const r = await aiFetch('/stt', { method: 'POST', body: fd, signal: AbortSignal.timeout(90000) });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return res.status(r.status === 503 ? 503 : 502).json({ error: typeof e.detail === 'string' ? e.detail : 'Speech-to-text failed.' });
      }
      res.json({ text: (await r.json()).text || '' });
    } catch (e) {
      res.status(502).json({ error: e?.cause?.code === 'ECONNREFUSED' ? `The AI service isn't running at ${AI_URL}.` : 'Speech-to-text took too long or failed.' });
    }
  });
export default router;

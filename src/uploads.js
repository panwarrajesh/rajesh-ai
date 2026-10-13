import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const AI_URL = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 25);
export const UPLOAD_DIR = path.resolve(process.env.DATA_DIR || './data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Only these are shown inline by the browser; everything else downloads (prevents HTML/SVG script execution).
const INLINE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.pdf': 'application/pdf',
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });
const router = Router();

const toClient = (a) => ({
  id: a.id, name: a.name, mime: a.mime, size: a.size, kind: a.kind,
  url: `/api/uploads/${a.id}/file`,
  chars: a.text ? a.text.length : 0,
  meta: a.meta ? JSON.parse(a.meta) : {},
});
export { toClient };

export function deleteAttachmentFiles(rows) {
  for (const r of rows) fs.rm(r.path, { force: true }, () => {});
}

// Remove uploads that were never sent (older than 24h).
export function cleanupPending() {
  const old = db.prepare('SELECT path FROM attachments WHERE message_id IS NULL AND created_at < ?').all(Date.now() - 864e5);
  deleteAttachmentFiles(old);
  db.prepare('DELETE FROM attachments WHERE message_id IS NULL AND created_at < ?').run(Date.now() - 864e5);
}

router.post(
  '/',
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is larger than ${MAX_MB} MB.` });
      res.status(400).json({ error: 'Upload failed. Try again.' });
    }),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    // multer reads names as latin1; restore UTF-8 so Hindi file names survive
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200);

    let result;
    try {
      const fd = new FormData();
      fd.append('file', new Blob([req.file.buffer]), name);
      const r = await fetch(`${AI_URL}/extract`, { method: 'POST', body: fd, signal: AbortSignal.timeout(180000) });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return res.status([413, 415, 422].includes(r.status) ? r.status : 502).json({ error: e.detail || 'Could not read this file.' });
      }
      result = await r.json();
    } catch (e) {
      const down = e?.cause?.code === 'ECONNREFUSED';
      return res.status(502).json({
        error: down ? `The AI service isn't running at ${AI_URL}, so files can't be processed.` : 'Reading the file took too long or failed.',
      });
    }

    const id = randomUUID();
    const ext = path.extname(name).toLowerCase().replace(/[^.\w]/g, '');
    const filePath = path.join(UPLOAD_DIR, id + ext);
    fs.writeFileSync(filePath, req.file.buffer);
    const meta = { ...result.meta, warning: result.warning || undefined };
    db.prepare(
      'INSERT INTO attachments (id, name, mime, size, kind, path, text, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(id, name, req.file.mimetype, req.file.size, result.kind, filePath, result.text, JSON.stringify(meta), Date.now());
    res.status(201).json(toClient(db.prepare('SELECT * FROM attachments WHERE id = ?').get(id)));
  }
);

router.get('/:id/file', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a || !fs.existsSync(a.path)) return res.status(404).json({ error: 'File not found' });
  const inline = INLINE[path.extname(a.path).toLowerCase()];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Content-Type', inline || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
  fs.createReadStream(a.path).pipe(res);
});

// discard a pending (not yet sent) upload
router.delete('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND message_id IS NULL').get(req.params.id);
  if (a) {
    deleteAttachmentFiles([a]);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  }
  res.status(204).end();
});

export default router;

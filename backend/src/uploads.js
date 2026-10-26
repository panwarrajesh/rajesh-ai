import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { toSrt, toVtt, toTxt, transcriptText } from './subtitles.js';
import { AI_URL, aiFetch } from './ai.js';

const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 25);
const MEDIA_MAX_MB = Number(process.env.MEDIA_MAX_MB || 500);
const MAX_PROCESS_MS = 3 * 3600 * 1000;
export const UPLOAD_DIR = path.resolve(process.env.DATA_DIR || './data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac']);
const VIDEO = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi']);
const mediaKind = (ext) => (AUDIO.has(ext) ? 'audio' : VIDEO.has(ext) ? 'video' : null);

// Shown inline by the browser; everything else downloads (prevents HTML/SVG script execution).
const INLINE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac',
};

const safeExt = (name) => path.extname(name).toLowerCase().replace(/[^.\w]/g, '').slice(0, 10);
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    req.uploadId = randomUUID();
    cb(null, req.uploadId + safeExt(Buffer.from(file.originalname, 'latin1').toString('utf8')));
  },
});
const upload = multer({ storage, limits: { fileSize: MEDIA_MAX_MB * 1024 * 1024, files: 1 } });
const router = Router();

export const ATT_COLS = 'id, chat_id, message_id, name, mime, size, kind, path, status, error, meta, origin, created_at, length(text) AS chars';

export function toClient(a) {
  const meta = a.meta ? JSON.parse(a.meta) : {};
  const { progress, ...rest } = meta;
  return {
    id: a.id, name: a.name, mime: a.mime, size: a.size, kind: a.kind,
    status: a.status || 'ready', error: a.error || null, generated: a.origin === 'generated',
    url: `/api/uploads/${a.id}/file`,
    thumbUrl: meta.has_thumb ? `/api/uploads/${a.id}/thumb` : null,
    chars: a.chars ?? 0,
    progress: progress || null,
    meta: rest,
  };
}

// Remove an attachment's main file plus derived files (<id>_thumb.jpg, <id>_f0.jpg, ...)
export function deleteAttachmentFiles(rows) {
  for (const r of rows) {
    try {
      for (const f of fs.readdirSync(UPLOAD_DIR)) if (f.startsWith(r.id)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
    } catch { /* ignore */ }
    if (r.path) fs.rmSync(r.path, { force: true });
  }
}

export function cleanupPending() {
  const cutoff = Date.now() - 864e5;
  const old = db.prepare("SELECT id, path FROM attachments WHERE message_id IS NULL AND status != 'processing' AND created_at < ?").all(cutoff);
  deleteAttachmentFiles(old);
  db.prepare("DELETE FROM attachments WHERE message_id IS NULL AND status != 'processing' AND created_at < ?").run(cutoff);
}

export function failInterrupted() {
  db.prepare("UPDATE attachments SET status = 'failed', error = 'Processing was interrupted by a server restart. Please attach the file again.' WHERE status = 'processing'").run();
}

// ---------- background audio/video processing ----------
const running = new Map(); // id -> { ac, jobId }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const setProgress = (id, stage, frac) =>
  db.prepare("UPDATE attachments SET meta = json_set(COALESCE(meta,'{}'), '$.progress.stage', ?, '$.progress.percent', ?) WHERE id = ? AND status = 'processing'")
    .run(stage, Math.round(frac * 100), id);

function saveResult(id, row, r) {
  const frames = r.frames || [];
  if (r.thumbnail) fs.writeFileSync(path.join(UPLOAD_DIR, `${id}_thumb.jpg`), Buffer.from(r.thumbnail, 'base64'));
  frames.forEach((f, i) => fs.writeFileSync(path.join(UPLOAD_DIR, `${id}_f${i}.jpg`), Buffer.from(f.b64, 'base64')));
  const meta = {
    ...r.meta,
    language: r.language,
    warning: (r.warnings || []).join(' ') || undefined,
    frames: frames.map((f) => ({ t: f.t, ocr: f.ocr })),
    has_thumb: Boolean(r.thumbnail),
    segment_count: r.segments.length,
  };
  const text = transcriptText({ name: row.name, kind: r.kind, meta: r.meta, language: r.language, segments: r.segments });
  db.prepare("UPDATE attachments SET status = 'ready', kind = ?, text = ?, data = ?, meta = ?, error = NULL WHERE id = ?")
    .run(r.kind, text, JSON.stringify(r.segments), JSON.stringify(meta), id);
}

async function processMedia(id) {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!row) return;
  const state = { ac: new AbortController(), jobId: null };
  running.set(id, state);
  const { signal } = state.ac;
  try {
    const fd = new FormData();
    fd.append('file', await fs.openAsBlob(row.path), row.name); // streamed from disk
    const r = await aiFetch('/media/jobs', { method: 'POST', body: fd, signal });
    if (!r.ok) throw new Error('The AI service rejected this file.');
    state.jobId = (await r.json()).job_id;
    const started = Date.now();
    for (;;) {
      await sleep(1500);
      if (signal.aborted) return;
      const sr = await aiFetch(`/media/jobs/${state.jobId}`, { signal });
      if (!sr.ok) throw new Error('Lost track of the processing job (did the AI service restart?).');
      const s = await sr.json();
      if (s.status === 'failed') throw new Error(s.error || 'Processing failed.');
      if (s.status === 'cancelled') return;
      if (s.status === 'done') { saveResult(id, row, s.result); break; }
      setProgress(id, s.stage, s.progress);
      if (Date.now() - started > MAX_PROCESS_MS) throw new Error('Processing took too long and was stopped.');
    }
    aiFetch(`/media/jobs/${state.jobId}`, { method: 'DELETE' }).catch(() => {});
  } catch (e) {
    if (signal.aborted) return;
    const msg = e?.cause?.code === 'ECONNREFUSED' ? `The AI service isn't running at ${AI_URL}, so this file can't be processed.` : e.message;
    db.prepare("UPDATE attachments SET status = 'failed', error = ? WHERE id = ?").run(msg, id);
  } finally {
    running.delete(id);
  }
}

// ---------- routes ----------
router.post(
  '/',
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is larger than ${MEDIA_MAX_MB} MB.` });
      res.status(400).json({ error: 'Upload failed. Try again.' });
    }),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const id = req.uploadId;
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200); // keep Hindi names intact
    const discard = () => fs.rmSync(req.file.path, { force: true });
    const ext = safeExt(name);
    const mk = mediaKind(ext);

    if (mk) {
      db.prepare("INSERT INTO attachments (id, name, mime, size, kind, path, status, meta, created_at) VALUES (?,?,?,?,?,?,'processing',?,?)")
        .run(id, name, req.file.mimetype, req.file.size, mk, req.file.path, JSON.stringify({ progress: { stage: 'Queued', percent: 0 } }), Date.now());
      res.status(202).json(toClient(db.prepare(`SELECT ${ATT_COLS} FROM attachments WHERE id = ?`).get(id)));
      processMedia(id);
      return;
    }

    if (req.file.size > MAX_MB * 1024 * 1024) { discard(); return res.status(413).json({ error: `File is larger than ${MAX_MB} MB.` }); }
    let result;
    try {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(req.file.path)]), name);
      const r = await aiFetch('/extract', { method: 'POST', body: fd, signal: AbortSignal.timeout(180000) });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        discard();
        return res.status([413, 415, 422].includes(r.status) ? r.status : 502).json({ error: e.detail || 'Could not read this file.' });
      }
      result = await r.json();
    } catch (e) {
      discard();
      const down = e?.cause?.code === 'ECONNREFUSED';
      return res.status(502).json({
        error: down ? `The AI service isn't running at ${AI_URL}, so files can't be processed.` : 'Reading the file took too long or failed.',
      });
    }
    const meta = { ...result.meta, warning: result.warning || undefined };
    db.prepare('INSERT INTO attachments (id, name, mime, size, kind, path, text, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, name, req.file.mimetype, req.file.size, result.kind, req.file.path, result.text, JSON.stringify(meta), Date.now());
    res.status(201).json(toClient(db.prepare(`SELECT ${ATT_COLS} FROM attachments WHERE id = ?`).get(id)));
  }
);

const find = (id) => db.prepare(`SELECT ${ATT_COLS} FROM attachments WHERE id = ?`).get(id);

router.get('/:id', (req, res) => {
  const a = find(req.params.id);
  if (!a) return res.status(404).json({ error: 'File not found' });
  res.json(toClient(a));
});

router.get('/:id/file', (req, res) => {
  const a = find(req.params.id);
  if (!a || !fs.existsSync(a.path)) return res.status(404).json({ error: 'File not found' });
  const inline = INLINE[path.extname(a.path).toLowerCase()];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Content-Type', inline || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
  res.sendFile(path.resolve(a.path), { dotfiles: 'allow' }, () => {}); // handles Range requests, so video seeking works
});

router.get('/:id/thumb', (req, res) => {
  const a = find(req.params.id);
  const f = a && path.join(UPLOAD_DIR, `${a.id}_thumb.jpg`);
  if (!f || !fs.existsSync(f)) return res.status(404).json({ error: 'No thumbnail' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(f, { dotfiles: 'allow' }, () => {});
});

router.get('/:id/subtitles', (req, res) => {
  const row = db.prepare('SELECT name, data FROM attachments WHERE id = ?').get(req.params.id);
  if (!row?.data) return res.status(404).json({ error: 'No transcript for this file' });
  const segments = JSON.parse(row.data);
  if (!segments.length) return res.status(404).json({ error: 'No speech was found in this file' });
  const fmt = ['srt', 'vtt', 'txt'].includes(req.query.format) ? req.query.format : 'srt';
  const body = fmt === 'srt' ? toSrt(segments) : fmt === 'vtt' ? toVtt(segments) : toTxt(segments);
  const base = row.name.replace(/\.[^.]+$/, '') || 'transcript';
  res.setHeader('Content-Type', `${fmt === 'vtt' ? 'text/vtt' : 'text/plain'}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base + '.' + fmt)}`);
  res.send(body);
});

// discard a pending (not yet sent) upload; also cancels running processing
router.delete('/:id', (req, res) => {
  const a = db.prepare('SELECT id, path FROM attachments WHERE id = ? AND message_id IS NULL').get(req.params.id);
  if (a) {
    const st = running.get(a.id);
    if (st) {
      st.ac.abort();
      if (st.jobId) aiFetch(`/media/jobs/${st.jobId}`, { method: 'DELETE' }).catch(() => {});
    }
    deleteAttachmentFiles([a]);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  }
  res.status(204).end();
});

export default router;

// Creating and editing media: shared by the AI tools and the /slash commands.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db } from './db.js';
import { aiFetch, aiJson, readJson, imageStatus } from './ai.js';
import { UPLOAD_DIR, toClient, ATT_COLS } from './uploads.js';
import { toSrt } from './subtitles.js';

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => randomUUID().slice(0, 6);
const kindOfMime = (m) => (m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'audio' : 'image');

// Files created by the AI start unattached; chats.js links them to the assistant message afterwards.
function register({ id, chatId, name, mime, filePath, meta = {} }) {
  const size = fs.statSync(filePath).size;
  db.prepare("INSERT INTO attachments (id, chat_id, name, mime, size, kind, path, status, meta, origin, created_at) VALUES (?,?,?,?,?,?,?,'ready',?,'generated',?)")
    .run(id, chatId, name, mime, size, kindOfMime(mime), filePath, JSON.stringify(meta), Date.now());
  return toClient(db.prepare(`SELECT ${ATT_COLS} FROM attachments WHERE id = ?`).get(id));
}

function saveBuffer(chatId, buffer, mime, prefix, meta) {
  const id = randomUUID();
  const ext = EXT[mime] || '.png';
  const filePath = path.join(UPLOAD_DIR, id + ext);
  fs.writeFileSync(filePath, buffer);
  return register({ id, chatId, name: `${prefix}-${stamp()}${ext}`, mime, filePath, meta });
}

// ref: a file name (or part of one), or empty / "latest" for the newest matching file in the chat
export function resolveRef(chatId, ref, kinds, { needTranscript = false } = {}) {
  const rows = db.prepare(
    `SELECT * FROM attachments WHERE chat_id = ? AND status = 'ready' AND kind IN (${kinds.map(() => '?').join(',')})` +
    `${needTranscript ? " AND data IS NOT NULL AND data != '[]'" : ''} ORDER BY created_at DESC, rowid DESC`
  ).all(chatId, ...kinds);
  if (!rows.length) {
    throw new Error(needTranscript
      ? 'No video in this chat has a transcript to burn in. Attach the original video again so it can be transcribed (needs faster-whisper).'
      : `There is no ${kinds[0]} in this chat yet. Attach one first.`);
  }
  if (!ref || /^(latest|last|this|it|previous)$/i.test(String(ref).trim())) return rows[0];
  const hit = rows.find((r) => r.name.toLowerCase().includes(String(ref).toLowerCase()));
  if (!hit) throw new Error(`No file matching "${ref}". Available: ${rows.slice(0, 5).map((r) => r.name).join(', ')}`);
  return hit;
}

export function hasKind(chatId, kinds) {
  return Boolean(db.prepare(
    `SELECT 1 FROM attachments WHERE chat_id = ? AND status = 'ready' AND kind IN (${kinds.map(() => '?').join(',')}) LIMIT 1`
  ).get(chatId, ...kinds));
}

const normSize = (s) => (['square', 'landscape', 'portrait'].includes(String(s)) ? String(s) : 'square');

async function requireImage(needEdit) {
  const st = await imageStatus();
  if (!st.available) throw new Error(st.message || 'Image generation is not configured on the AI service.');
  if (needEdit && !st.can_edit) {
    throw new Error('The configured image model can only create new images, not edit them. For simple edits (resize, crop, rotate, filters) use /img.');
  }
}

export async function generateImage(ctx, { prompt, size, negative_prompt }) {
  await requireImage(false);
  const r = await aiJson('/image/generate', { prompt: String(prompt || ''), size: normSize(size), negative_prompt: negative_prompt || '' }, ctx.signal);
  const att = saveBuffer(ctx.chatId, Buffer.from(r.b64, 'base64'), r.mime, 'image');
  return { text: `Image created and shown to the user: ${att.name}`, display: `Created ${att.name}` };
}

export async function editImage(ctx, { image, prompt, strength }) {
  await requireImage(true);
  const row = resolveRef(ctx.chatId, image, ['image']);
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(row.path)]), row.name);
  fd.append('prompt', String(prompt || ''));
  fd.append('strength', String(Number.isFinite(Number(strength)) ? Number(strength) : 0.6));
  const r = await readJson(await aiFetch('/image/edit', { method: 'POST', body: fd, signal: ctx.signal }));
  const att = saveBuffer(ctx.chatId, Buffer.from(r.b64, 'base64'), r.mime, 'edited');
  return { text: `Edited copy of ${row.name} created and shown to the user: ${att.name}`, display: `Edited ${row.name} -> ${att.name}` };
}

export async function transformImage(ctx, { image, operations }) {
  const row = resolveRef(ctx.chatId, image, ['image']);
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(row.path)]), row.name);
  fd.append('ops', JSON.stringify(operations || []));
  const r = await readJson(await aiFetch('/image/transform', { method: 'POST', body: fd, signal: ctx.signal }));
  const att = saveBuffer(ctx.chatId, Buffer.from(r.b64, 'base64'), r.mime, 'edited');
  return { text: `Created ${att.name} (${r.width}x${r.height}) from ${row.name}; it is shown to the user.`, display: `${row.name} -> ${att.name} (${r.width}x${r.height})` };
}

export async function editVideo(ctx, { video, operation, params }) {
  // edited copies carry no transcript, so for subtitles prefer the newest video that has one
  const row = resolveRef(ctx.chatId, video, ['video', 'audio'], { needTranscript: operation === 'burn_subtitles' });
  let srt = '';
  if (operation === 'burn_subtitles') srt = toSrt(JSON.parse(row.data));
  const fd = new FormData();
  fd.append('file', await fs.openAsBlob(row.path), row.name);
  fd.append('op', String(operation));
  fd.append('params', JSON.stringify(params && typeof params === 'object' ? params : {}));
  fd.append('srt', srt);
  const { job_id: jobId } = await readJson(await aiFetch('/media/edit', { method: 'POST', body: fd, signal: ctx.signal }));
  const cancel = () => aiFetch(`/media/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
  const started = Date.now();
  try {
    for (;;) {
      await sleep(1500);
      if (ctx.signal?.aborted) { cancel(); throw new Error('Cancelled'); }
      const s = await readJson(await aiFetch(`/media/jobs/${jobId}`, { signal: ctx.signal }));
      if (s.status === 'failed') throw new Error(s.error || 'The edit failed.');
      if (s.status === 'cancelled') throw new Error('Cancelled');
      if (s.status === 'done') {
        const out = await aiFetch(`/media/jobs/${jobId}/output`, { signal: ctx.signal });
        if (!out.ok) throw new Error('Could not download the edited file.');
        const mime = s.result.mime;
        const id = randomUUID();
        const filePath = path.join(UPLOAD_DIR, id + s.result.ext);
        await pipeline(Readable.fromWeb(out.body), fs.createWriteStream(filePath));
        const base = row.name.replace(/\.[^.]+$/, '');
        const att = register({ id, chatId: ctx.chatId, name: `${base}-${operation}-${stamp()}${s.result.ext}`, mime, filePath });
        cancel(); // frees the temp output on the AI service
        return { text: `Created ${att.name} from ${row.name}; it is shown to the user.`, display: `${operation}: ${row.name} -> ${att.name}` };
      }
      ctx.send?.({ type: 'notice', message: `Editing video: ${s.stage} ${Math.round((s.progress || 0) * 100)}%` });
      if (Date.now() - started > 30 * 60 * 1000) { cancel(); throw new Error('The edit took too long and was stopped.'); }
    }
  } catch (e) {
    if (ctx.signal?.aborted) cancel();
    throw e;
  }
}

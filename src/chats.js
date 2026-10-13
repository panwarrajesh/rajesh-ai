import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { parseSSE } from './sse.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { buildContext } from './context.js';
import { toClient, deleteAttachmentFiles } from './uploads.js';

const AI_URL = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
const MAX_CONTEXT = Number(process.env.MAX_CONTEXT_CHARS || 24000);
const DEFAULT_ATTACH_PROMPT = 'Please explain what is in the attached file(s).';

const router = Router();
const getChat = (id) => db.prepare('SELECT * FROM chats WHERE id = ?').get(id);

function getMessages(chatId) {
  const msgs = db.prepare('SELECT id, role, content, model, created_at FROM messages WHERE chat_id = ? ORDER BY seq').all(chatId);
  const atts = db.prepare('SELECT * FROM attachments WHERE chat_id = ? ORDER BY created_at').all(chatId);
  const by = new Map();
  for (const a of atts) {
    if (!by.has(a.message_id)) by.set(a.message_id, []);
    by.get(a.message_id).push(toClient(a));
  }
  return msgs.map((m) => ({ ...m, attachments: by.get(m.id) || [] }));
}

// ---------- list / search ----------
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    return res.json(db.prepare('SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC').all());
  }
  const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  res.json(
    db.prepare(`
      SELECT id, title, updated_at FROM chats c
      WHERE title LIKE ? ESCAPE '\\'
         OR EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.content LIKE ? ESCAPE '\\')
         OR EXISTS (SELECT 1 FROM attachments a WHERE a.chat_id = c.id AND a.name LIKE ? ESCAPE '\\')
      ORDER BY updated_at DESC`).all(like, like, like)
  );
});

// ---------- CRUD ----------
router.post('/', (req, res) => {
  const now = Date.now();
  const id = randomUUID();
  db.prepare('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, 'New chat', now, now);
  res.status(201).json({ id, title: 'New chat', updated_at: now });
});

router.get('/:id', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  res.json({ ...chat, messages: getMessages(chat.id) });
});

router.patch('/:id', (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'Title cannot be empty' });
  const r = db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Chat not found' });
  res.json({ id: req.params.id, title });
});

router.delete('/:id', (req, res) => {
  deleteAttachmentFiles(db.prepare('SELECT path FROM attachments WHERE chat_id = ?').all(req.params.id));
  db.prepare('DELETE FROM chats WHERE id = ?').run(req.params.id); // attachments rows cascade
  res.status(204).end();
});

// ---------- export ----------
router.get('/:id/export', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const messages = getMessages(chat.id);
  const safe = chat.title.replace(/[^\w\-]+/g, '_').slice(0, 50) || 'chat';
  if (req.query.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.json"`);
    return res.json({ ...chat, messages });
  }
  const md = `# ${chat.title}\n\n` + messages.map((m) => {
    const files = m.attachments.length ? `_Attached: ${m.attachments.map((a) => a.name).join(', ')}_\n\n` : '';
    return `**${m.role === 'user' ? 'You' : 'Rajesh AI'}:**\n\n${files}${m.content}`;
  }).join('\n\n---\n\n');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.md"`);
  res.send(md);
});

// ---------- streaming generation ----------
// modes: send | edit (messageId = user message) | regenerate | continue
router.post('/:id/stream', async (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });

  const { mode = 'send', messageId, provider, model, temperature } = req.body || {};
  const attachmentIds = Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds : [];
  let content = String(req.body?.content || '');
  const now = Date.now();
  const lastMsg = () =>
    db.prepare('SELECT seq, id, role, content FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(chat.id);

  let prefix = '';
  let continueId = null;

  if (mode === 'send' || mode === 'edit') {
    // attachments being sent now must be unsent uploads
    let carry = [];
    if (attachmentIds.length) {
      carry = attachmentIds.map((id) => db.prepare('SELECT id FROM attachments WHERE id = ? AND message_id IS NULL').get(id));
      if (carry.some((x) => !x)) return res.status(400).json({ error: 'An attached file expired. Please attach it again.' });
    }
    if (mode === 'edit') {
      const m = db.prepare('SELECT seq, role FROM messages WHERE id = ? AND chat_id = ?').get(messageId, chat.id);
      if (!m || m.role !== 'user') return res.status(400).json({ error: 'Only your own messages can be edited' });
      // the edited message keeps its own files; files on later messages are discarded
      const keep = db.prepare('SELECT id FROM attachments WHERE message_id = ?').all(messageId).map((r) => r.id);
      carry = [...carry, ...keep.map((id) => ({ id }))];
      const doomed = db.prepare(`
        SELECT a.id, a.path FROM attachments a JOIN messages mm ON mm.id = a.message_id
        WHERE mm.chat_id = ? AND mm.seq >= ?`).all(chat.id, m.seq).filter((a) => !keep.includes(a.id));
      deleteAttachmentFiles(doomed);
      for (const a of doomed) db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
      db.prepare('UPDATE attachments SET message_id = NULL WHERE message_id = ?').run(messageId);
      db.prepare('DELETE FROM messages WHERE chat_id = ? AND seq >= ?').run(chat.id, m.seq);
    }
    if (!content.trim()) {
      if (!carry.length) return res.status(400).json({ error: 'Message is empty' });
      content = DEFAULT_ATTACH_PROMPT;
    }
    const newId = randomUUID();
    db.prepare('INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId, chat.id, 'user', content, now);
    for (const a of carry) {
      db.prepare('UPDATE attachments SET chat_id = ?, message_id = ? WHERE id = ?').run(chat.id, newId, a.id);
    }
    const count = db.prepare("SELECT COUNT(*) n FROM messages WHERE chat_id = ? AND role = 'user'").get(chat.id).n;
    if (count === 1 || chat.title === 'New chat') {
      const names = carry.length ? db.prepare('SELECT name FROM attachments WHERE id = ?').get(carry[0].id)?.name : '';
      const base = content === DEFAULT_ATTACH_PROMPT && names ? names : content;
      db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(base.trim().replace(/\s+/g, ' ').slice(0, 50), chat.id);
    }
  } else if (mode === 'regenerate') {
    const last = lastMsg();
    if (last?.role === 'assistant') db.prepare('DELETE FROM messages WHERE seq = ?').run(last.seq);
  } else if (mode === 'continue') {
    const last = lastMsg();
    if (last?.role !== 'assistant') return res.status(400).json({ error: 'Nothing to continue' });
    prefix = last.content;
    continueId = last.id;
  } else {
    return res.status(400).json({ error: `Unknown mode: ${mode}` });
  }

  const ctx = buildContext(chat.id, { maxChars: MAX_CONTEXT, continueMode: mode === 'continue' });
  const system = ctx.docContext ? `${SYSTEM_PROMPT}\n\n${ctx.docContext}` : SYSTEM_PROMPT;
  const payload = {
    provider, model,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    messages: [{ role: 'system', content: system }, ...ctx.history],
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (ctx.notice) send({ type: 'notice', message: ctx.notice });

  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); }); // user pressed Stop / closed tab

  let acc = '';
  let errMsg = null;
  try {
    const upstream = await fetch(`${AI_URL}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!upstream.ok) throw new Error(`AI service returned ${upstream.status}`);
    for await (const ev of parseSSE(upstream.body)) {
      if (ev.type === 'token') { acc += ev.content; send(ev); }
      else if (ev.type === 'notice') send(ev);
      else if (ev.type === 'error') { errMsg = ev.message; break; }
      else if (ev.type === 'done') break;
    }
  } catch (e) {
    if (!ac.signal.aborted) {
      errMsg = e?.cause?.code === 'ECONNREFUSED'
        ? `The AI service isn't running at ${AI_URL}. Start it with: cd ai-service && uvicorn main:app --port 8000`
        : e.message;
    }
  }

  // Persist whatever was generated (including partial output after Stop)
  if (acc) {
    if (continueId) {
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(prefix + acc, continueId);
    } else {
      db.prepare('INSERT INTO messages (id, chat_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), chat.id, 'assistant', acc, model || null, Date.now());
    }
  }
  db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(Date.now(), chat.id);

  if (!res.writableEnded) {
    send(errMsg ? { type: 'error', message: errMsg } : { type: 'done' });
    res.end();
  }
});

export default router;

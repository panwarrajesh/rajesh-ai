import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { listFiles, readFile, deleteFile, removeWorkspace, projectDir, safeRel } from './workspace.js';
import { buildZip } from './zip.js';
import fs from 'node:fs';
import path from 'node:path';

const router = Router();
const get = (id) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
const clean = (v, n) => String(v ?? '').trim().slice(0, n);

router.get('/', (_req, res) => {
  res.json(db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM chats c WHERE c.project_id = p.id) AS chat_count
    FROM projects p ORDER BY updated_at DESC`).all());
});

router.post('/', (req, res) => {
  const name = clean(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const now = Date.now();
  const id = randomUUID();
  db.prepare('INSERT INTO projects (id, name, instructions, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(id, name, clean(req.body?.instructions, 4000), now, now);
  res.status(201).json(get(id));
});

router.patch('/:id', (req, res) => {
  const p = get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const name = req.body?.name !== undefined ? clean(req.body.name, 80) : p.name;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const instructions = req.body?.instructions !== undefined ? clean(req.body.instructions, 4000) : p.instructions;
  db.prepare('UPDATE projects SET name = ?, instructions = ?, updated_at = ? WHERE id = ?').run(name, instructions, Date.now(), p.id);
  res.json(get(p.id));
});

// Chats are kept (moved out of the project); only the project and its files are removed.
router.delete('/:id', (req, res) => {
  const p = get(req.params.id);
  if (p) {
    db.prepare('UPDATE chats SET project_id = NULL WHERE project_id = ?').run(p.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    removeWorkspace(p.id);
  }
  res.status(204).end();
});

const guard = (req, res, next) => (get(req.params.id) ? next() : res.status(404).json({ error: 'Project not found' }));

router.get('/:id/files', guard, (req, res) => res.json(listFiles(req.params.id)));

router.get('/:id/files/content', guard, (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(readFile(req.params.id, req.query.path));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id/files', guard, (req, res) => {
  try { deleteFile(req.params.id, req.query.path); res.status(204).end(); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/:id/download', guard, (req, res) => {
  const p = get(req.params.id);
  const files = listFiles(p.id);
  if (!files.length) return res.status(404).json({ error: 'This project has no files yet' });
  const root = projectDir(p.id);
  const zip = buildZip(files.map((f) => ({ name: safeRel(f.path), data: fs.readFileSync(path.join(root, f.path)) })));
  const safe = p.name.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'project';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.zip"`);
  res.send(zip);
});

export default router;

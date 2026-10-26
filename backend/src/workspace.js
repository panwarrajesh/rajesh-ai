// Per-project file workspace. Every path is validated; nothing outside the project folder is reachable.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.DATA_DIR || './data', 'projects');
const MAX_FILE = Number(process.env.WORKSPACE_MAX_FILE_KB || 500) * 1024;
const MAX_FILES = Number(process.env.WORKSPACE_MAX_FILES || 200);
const MAX_TOTAL = Number(process.env.WORKSPACE_MAX_TOTAL_MB || 20) * 1024 * 1024;
const ID_RE = /^[0-9a-f-]{36}$/;

export function projectDir(projectId) {
  if (!ID_RE.test(projectId)) throw new Error('Invalid project');
  return path.join(ROOT, projectId, 'files');
}

export function safeRel(p) {
  if (typeof p !== 'string') throw new Error('Path must be text');
  const s = p.replace(/\\/g, '/').trim();
  if (!s) throw new Error('Path is empty');
  if (s.length > 200) throw new Error('Path is too long');
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.includes('\0')) throw new Error('Use a relative path like src/index.js');
  const parts = s.split('/');
  if (parts.length > 8) throw new Error('Path is nested too deeply');
  if (parts.some((x) => x === '' || x === '.' || x === '..')) throw new Error('Path cannot contain "..", "." or empty parts');
  return parts.join('/');
}

function resolveInside(projectId, rel) {
  const root = projectDir(projectId);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Path escapes the project folder');
  return { root, full };
}

export function listFiles(projectId) {
  const root = projectDir(projectId);
  const out = [];
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(full, rel);
      else if (e.isFile()) {
        const st = fs.statSync(full);
        out.push({ path: rel, size: st.size, modified: st.mtimeMs });
      }
    }
  };
  walk(root, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function readFile(projectId, p) {
  const rel = safeRel(p);
  const { full } = resolveInside(projectId, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`File not found: ${rel}`);
  if (fs.statSync(full).size > MAX_FILE) throw new Error('File is too large to read');
  return fs.readFileSync(full, 'utf8');
}

export function writeFile(projectId, p, content) {
  const rel = safeRel(p);
  if (typeof content !== 'string') throw new Error('Content must be text');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_FILE) throw new Error(`File is too large (limit ${MAX_FILE / 1024} KB)`);
  const { root, full } = resolveInside(projectId, rel);
  const existing = listFiles(projectId);
  const prev = existing.find((f) => f.path === rel);
  if (!prev && existing.length >= MAX_FILES) throw new Error(`Workspace is full (${MAX_FILES} files)`);
  const total = existing.reduce((n, f) => n + f.size, 0) - (prev?.size || 0) + bytes;
  if (total > MAX_TOTAL) throw new Error('Workspace size limit reached');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const realRoot = fs.realpathSync(root);
  if (!fs.realpathSync(path.dirname(full)).startsWith(realRoot)) throw new Error('Path escapes the project folder');
  fs.writeFileSync(full, content, 'utf8');
  return { path: rel, bytes, created: !prev };
}

export function deleteFile(projectId, p) {
  const rel = safeRel(p);
  const { full } = resolveInside(projectId, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`File not found: ${rel}`);
  fs.rmSync(full);
  return rel;
}

export function removeWorkspace(projectId) {
  fs.rmSync(path.join(ROOT, projectId), { recursive: true, force: true });
}

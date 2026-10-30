import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.DATA_DIR || './data';
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(path.join(dir, 'rajesh.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, seq);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT,
  name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  text TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_msg ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_att_chat ON attachments(chat_id);
`);

// Phase 3 migration: processing status for audio/video + transcript segments
const cols = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
if (!cols.includes('status')) db.exec("ALTER TABLE attachments ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'");
if (!cols.includes('error')) db.exec('ALTER TABLE attachments ADD COLUMN error TEXT');
if (!cols.includes('data')) db.exec('ALTER TABLE attachments ADD COLUMN data TEXT');

// Phase 4: memory, projects, tool activity
db.exec(`
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);
const chatCols = db.prepare('PRAGMA table_info(chats)').all().map((c) => c.name);
if (!chatCols.includes('project_id')) db.exec('ALTER TABLE chats ADD COLUMN project_id TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id)');
const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
if (!msgCols.includes('tools')) db.exec('ALTER TABLE messages ADD COLUMN tools TEXT');

// Phase 5: files created by the AI (generated / edited images and videos)
const attCols = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
if (!attCols.includes('origin')) db.exec("ALTER TABLE attachments ADD COLUMN origin TEXT NOT NULL DEFAULT 'upload'");

// Voice assistant: user-approved preferences (assistant name, user name, greeting). Additive table, no existing data touched.
db.exec(`
CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

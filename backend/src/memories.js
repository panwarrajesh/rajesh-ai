import { Router } from 'express';
import { db } from './db.js';

const MAX_LEN = 500;

function luhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

// Returns a short reason when the text looks like a secret, otherwise null.
export function sensitiveReason(text) {
  const t = String(text || '');
  if (/\b(password|passcode|passwd|pwd|otp|cvv|cvc|secret|pin(?!\s*-?code))\b/i.test(t) || /(पासवर्ड|ओटीपी|पिन\s*नंबर|सीक्रेट)/.test(t)) return 'a password, PIN, OTP or secret';
  if (/\b(api|access|auth|bearer|secret|private)[\s_-]?(key|token)\b/i.test(t)) return 'an API key or access token';
  if (/\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(t)) return 'an API key or access token';
  if (/[A-Za-z0-9+/_-]{40,}/.test(t)) return 'a long secret-looking key';
  for (const m of t.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return 'a card number';
  }
  if (/\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/.test(t)) return 'an Aadhaar number';
  if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(t)) return 'a PAN number';
  return null;
}

export class SensitiveError extends Error {
  constructor(reason) {
    super(`Not saved: this looks like ${reason}. I don't keep passwords or secrets in memory. A password manager is the safe place for them.`);
    this.sensitive = true;
  }
}
const BUDGET = Number(process.env.MEMORY_CHAR_BUDGET || 3000);
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export const REMEMBER_INTENT = /(remember|yaad|याद|don'?t forget|mat bhool|मत भूल)/i;
export const FORGET_INTENT = /(forget|delete|remove|erase|bhool|भूल|hata|मिटा|mita)/i;

// Only an explicit request saves anything. Works for any model (no tool calling needed).
export function detectRememberRequest(text) {
  const t = String(text || '').trim();
  if (t.length < 8 || t.length > 800 || /\?\s*$/.test(t)) return null; // questions are not requests
  const patterns = [
    /^(?:(?:hey|hi|ok|okay|please|pls|rajesh ai)[,:]?\s+)*remember(?:\s+that)?\s*[:,\-]?\s*([\s\S]+)$/i,
    /^(?:please\s+)?yaad\s+rakh(?:o|na|iye|iyega)?(?:\s+(?:ki|ye|yeh))?\s*[:,\-]?\s*([\s\S]+)$/i,
    /^याद\s+रख(?:ो|ना|िए|ियेगा)?(?:\s+(?:कि|की))?\s*[:,\-]?\s*([\s\S]+)$/,
    /^([\s\S]{4,300}?)[,.]?\s+(?:yaad\s+rakh(?:o|na|iye|iyega)|याद\s+रख(?:ो|ना|िए|ियेगा)?)\s*[.!]?$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    const fact = m?.[1]?.trim().replace(/[.!\s]+$/, '');
    if (fact && fact.length >= 3) return fact.slice(0, MAX_LEN);
  }
  return null;
}

export function listMemories() {
  return db.prepare('SELECT id, text, created_at, updated_at FROM memories ORDER BY id DESC').all();
}

export function addMemory(text) {
  const clean = String(text || '').trim().slice(0, MAX_LEN);
  if (!clean) throw new Error('Memory text is empty');
  const reason = sensitiveReason(clean);
  if (reason) throw new SensitiveError(reason);
  const dup = listMemories().find((m) => norm(m.text) === norm(clean));
  if (dup) return { id: dup.id, text: dup.text, duplicate: true };
  const now = Date.now();
  const r = db.prepare('INSERT INTO memories (text, created_at, updated_at) VALUES (?, ?, ?)').run(clean, now, now);
  return { id: Number(r.lastInsertRowid), text: clean, duplicate: false };
}

export function deleteMemory(id) {
  return db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
}

// Newest facts win when the budget is tight; returned oldest-first for readability.
export function memoryBlock(budget = BUDGET) {
  const picked = [];
  let used = 0;
  for (const m of listMemories()) {
    if (used + m.text.length > budget) break;
    picked.push(m.text);
    used += m.text.length;
  }
  return picked.reverse().map((t) => `- ${t}`).join('\n');
}

const router = Router();
router.get('/', (_req, res) => res.json(listMemories()));
router.post('/', (req, res) => {
  try { res.status(201).json(addMemory(req.body?.text)); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.patch('/:id', (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, MAX_LEN);
  if (!text) return res.status(400).json({ error: 'Memory text is empty' });
  const reason = sensitiveReason(text);
  if (reason) return res.status(400).json({ error: new SensitiveError(reason).message });
  const r = db.prepare('UPDATE memories SET text = ?, updated_at = ? WHERE id = ?').run(text, Date.now(), Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Memory not found' });
  res.json({ id: Number(req.params.id), text });
});
router.delete('/:id', (req, res) => { deleteMemory(Number(req.params.id)); res.status(204).end(); });
router.delete('/', (_req, res) => { db.prepare('DELETE FROM memories').run(); res.status(204).end(); });
export default router;

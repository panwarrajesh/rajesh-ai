import { db } from './db.js';
import { calculate } from './calc.js';
import { addMemory, listMemories, deleteMemory, REMEMBER_INTENT, FORGET_INTENT } from './memories.js';
import { listFiles, readFile, writeFile, deleteFile } from './workspace.js';
import { bm25, chunkText, tokenize } from './context.js';
import { clock } from './subtitles.js';
import { imageStatus } from './ai.js';
import { generateImage, editImage, transformImage, editVideo, hasKind } from './creative.js';

const MAX_RESULT = 6000;
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const str = (description) => ({ type: 'string', description });

const TOOLS = [
  {
    name: 'calculator',
    description: 'Evaluate a math expression exactly. Use it for any arithmetic instead of computing mentally. Supports + - * / ^ % ( ), sqrt, abs, round, floor, ceil, sin, cos, tan, ln, log (base 10), log2, exp, min, max, pow, pi, e.',
    parameters: obj({ expression: str('For example: (15+25)*3/4') }, ['expression']),
    run: ({ expression }) => { const v = calculate(expression); return { text: String(v), display: `${expression} = ${v}` }; },
  },
  {
    name: 'get_current_datetime',
    description: 'Get the current date and time. Use it whenever the answer depends on today\'s date or the time now.',
    parameters: obj({ timezone: str('IANA timezone such as Asia/Kolkata. Optional.') }),
    run: ({ timezone }) => {
      const tz = timezone || process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata';
      let formatted;
      try { formatted = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }).format(new Date()); }
      catch { throw new Error(`Unknown timezone "${tz}". Use an IANA name like Asia/Kolkata.`); }
      return { text: `${formatted} (${tz}). ISO: ${new Date().toISOString()}`, display: formatted };
    },
  },
  {
    name: 'remember',
    description: 'Save one fact to the user\'s long-term memory. ONLY call this when the user explicitly asked you, in their latest message, to remember or save something. Never save things on your own initiative.',
    parameters: obj({ text: str('The fact to save, written as a short standalone sentence.') }, ['text']),
    run: ({ text }, ctx) => {
      if (!REMEMBER_INTENT.test(ctx.userText)) throw new Error('The user did not explicitly ask to remember this, so nothing was saved.');
      const r = addMemory(text);
      return { text: r.duplicate ? `Already saved (id ${r.id}).` : `Saved with id ${r.id}.`, display: `Saved: ${r.text}` };
    },
  },
  {
    name: 'list_memories',
    description: 'List everything saved in the user\'s long-term memory, with ids.',
    parameters: obj({}),
    run: () => {
      const all = listMemories();
      return { text: all.length ? all.map((m) => `${m.id}: ${m.text}`).join('\n') : 'Memory is empty.', display: `${all.length} memories` };
    },
  },
  {
    name: 'forget_memory',
    description: 'Delete one saved memory by id. ONLY call this when the user explicitly asked you to forget/delete it. Use list_memories first to find the id.',
    parameters: obj({ memory_id: { type: 'integer', description: 'Id from list_memories' } }, ['memory_id']),
    run: ({ memory_id }, ctx) => {
      if (!FORGET_INTENT.test(ctx.userText)) throw new Error('The user did not ask to forget anything, so nothing was deleted.');
      const ok = deleteMemory(Number(memory_id));
      if (!ok) throw new Error(`No memory with id ${memory_id}.`);
      return { text: 'Deleted.', display: `Forgot memory ${memory_id}` };
    },
  },
  {
    name: 'search_attached_files',
    description: 'Search the documents and transcripts the user attached in this chat for passages matching a query (keyword search). Use it to find specific facts in long files.',
    parameters: obj({ query: str('Words likely to appear in the passage') }, ['query']),
    available: (ctx) => Boolean(db.prepare("SELECT 1 FROM attachments WHERE chat_id = ? AND status = 'ready' AND kind != 'image' AND length(text) > 0 LIMIT 1").get(ctx.chatId)),
    run: ({ query }, ctx) => {
      const docs = db.prepare("SELECT name, text FROM attachments WHERE chat_id = ? AND status = 'ready' AND kind != 'image' AND length(text) > 0").all(ctx.chatId);
      const all = [];
      for (const d of docs) { const cs = chunkText(d.text); cs.forEach((text, i) => all.push({ name: d.name, i, n: cs.length, text, toks: tokenize(text) })); }
      const scores = bm25(all.map((c) => c.toks), tokenize(query));
      const top = all.map((c, i) => ({ c, s: scores[i] })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
      if (!top.length) return { text: 'No matching passages found.', display: `"${query}": no matches` };
      return { text: top.map(({ c }) => `### ${c.name} (part ${c.i + 1} of ${c.n})\n${c.text}`).join('\n\n'), display: `"${query}": ${top.length} passages` };
    },
  },
  {
    name: 'get_transcript_range',
    description: 'Get the transcript lines of an attached audio/video file between two times (seconds). Use it for questions like "what was said around 12:30?".',
    parameters: obj({
      file_name: str('Name of the audio/video file. Optional if only one is attached.'),
      start_seconds: { type: 'number', description: 'Start time in seconds' },
      end_seconds: { type: 'number', description: 'End time in seconds' },
    }, ['start_seconds', 'end_seconds']),
    available: (ctx) => Boolean(db.prepare("SELECT 1 FROM attachments WHERE chat_id = ? AND status = 'ready' AND kind IN ('audio','video') AND data IS NOT NULL LIMIT 1").get(ctx.chatId)),
    run: ({ file_name, start_seconds, end_seconds }, ctx) => {
      const rows = db.prepare("SELECT name, data FROM attachments WHERE chat_id = ? AND status = 'ready' AND kind IN ('audio','video') AND data IS NOT NULL").all(ctx.chatId);
      const row = (file_name && rows.find((r) => r.name.toLowerCase().includes(String(file_name).toLowerCase()))) || (rows.length === 1 ? rows[0] : null);
      if (!row) throw new Error(`Say which file: ${rows.map((r) => r.name).join(', ')}`);
      const a = Number(start_seconds), b = Number(end_seconds);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) throw new Error('Invalid time range');
      const lines = JSON.parse(row.data).filter((s) => s.end >= a && s.start <= b).map((s) => `[${clock(s.start)}] ${s.text}`);
      const text = lines.join('\n').slice(0, MAX_RESULT);
      return { text: text || 'No speech in that time range.', display: `${row.name} ${clock(a)}-${clock(b)}: ${lines.length} lines` };
    },
  },
  {
    name: 'list_project_files',
    description: 'List the files in this project\'s workspace.',
    parameters: obj({}),
    available: (ctx) => Boolean(ctx.projectId),
    run: (_a, ctx) => {
      const f = listFiles(ctx.projectId);
      return { text: f.length ? f.map((x) => `${x.path} (${x.size} bytes)`).join('\n') : 'The workspace is empty.', display: `${f.length} files` };
    },
  },
  {
    name: 'read_project_file',
    description: 'Read a text file from the project workspace.',
    parameters: obj({ path: str('Relative path such as src/index.js') }, ['path']),
    available: (ctx) => Boolean(ctx.projectId),
    run: ({ path }, ctx) => { const t = readFile(ctx.projectId, path); return { text: t, display: `Read ${path} (${t.length} chars)` }; },
  },
  {
    name: 'write_project_file',
    description: 'Create or completely overwrite a text file in the project workspace. When the user asks you to build a website, app, script or API, write the real files with this tool (one call per file, full content), then summarize what you created and how to run it.',
    parameters: obj({ path: str('Relative path such as src/index.js (folders are created automatically)'), content: str('The complete file content') }, ['path', 'content']),
    available: (ctx) => Boolean(ctx.projectId),
    run: ({ path, content }, ctx) => {
      const r = writeFile(ctx.projectId, path, content);
      return { text: `${r.created ? 'Created' : 'Updated'} ${r.path} (${r.bytes} bytes).`, display: `${r.created ? 'Created' : 'Updated'} ${r.path}` };
    },
  },
  {
    name: 'delete_project_file',
    description: 'Delete a file from the project workspace. Only when the user asks for it.',
    parameters: obj({ path: str('Relative path') }, ['path']),
    available: (ctx) => Boolean(ctx.projectId),
    run: ({ path }, ctx) => { deleteFile(ctx.projectId, path); return { text: `Deleted ${path}.`, display: `Deleted ${path}` }; },
  },
  {
    name: 'generate_image',
    description: 'Create a NEW picture from a text description with the image generator. The picture appears in the chat automatically. Write the prompt in English with concrete visual detail (subject, style, lighting, colours).',
    parameters: obj({
      prompt: str('Detailed description of the picture'),
      size: { type: 'string', enum: ['square', 'landscape', 'portrait'], description: 'Shape of the picture. Default square.' },
      negative_prompt: str('Things to avoid (only used by Stable Diffusion). Optional.'),
    }, ['prompt']),
    available: async () => (await imageStatus()).available,
    run: (args, ctx) => generateImage(ctx, args),
  },
  {
    name: 'edit_image',
    description: 'Change an existing picture of this chat with AI according to an instruction (for example "make the sky purple" or "turn it into a watercolour"). Creates a new picture and keeps the original. For plain resizing, cropping, rotating or colour filters use transform_image instead.',
    parameters: obj({
      image: str('File name of the picture. Optional; defaults to the newest picture in the chat.'),
      prompt: str('What to change'),
      strength: { type: 'number', description: 'How strongly to change it, 0.1 to 0.9 (Stable Diffusion only). Default 0.6.' },
    }, ['prompt']),
    available: async (ctx) => (await imageStatus()).can_edit && hasKind(ctx.chatId, ['image']),
    run: (args, ctx) => editImage(ctx, args),
  },
  {
    name: 'transform_image',
    description: 'Apply exact, simple edits to a picture without AI: resize, crop, rotate, flip, grayscale, brightness, contrast, saturation, blur, sharpen, or convert format. The result is a new picture.',
    parameters: obj({
      image: str('File name of the picture. Optional; defaults to the newest picture in the chat.'),
      operations: {
        type: 'array',
        description: 'Applied in order. Examples: {"op":"resize","max_side":800}, {"op":"crop","left":10,"top":0,"right":10,"bottom":0} (percent removed from each side), {"op":"rotate","degrees":90}, {"op":"flip","direction":"horizontal"}, {"op":"grayscale"}, {"op":"brightness","factor":1.3}, {"op":"blur","radius":3}, {"op":"format","format":"webp","quality":85}',
        items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'], additionalProperties: true },
      },
    }, ['operations']),
    available: (ctx) => hasKind(ctx.chatId, ['image']),
    run: (args, ctx) => transformImage(ctx, args),
  },
  {
    name: 'edit_video',
    description: 'Edit a video or audio file attached to this chat. The result is a new file shown in the chat. Operations: trim (start, end in seconds), extract_audio, compress (optional crf 18-40, max_height), resize (height), gif (start, seconds up to 20, fps, width), speed (factor 0.25-4), burn_subtitles (needs the file\'s transcript).',
    parameters: obj({
      video: str('File name. Optional; defaults to the newest video or audio file in the chat.'),
      operation: { type: 'string', enum: ['trim', 'extract_audio', 'compress', 'resize', 'gif', 'speed', 'burn_subtitles'] },
      params: { type: 'object', description: 'Parameters for the operation, e.g. {"start": 10, "end": 40} for trim', additionalProperties: true },
    }, ['operation']),
    available: (ctx) => hasKind(ctx.chatId, ['video', 'audio']),
    run: (args, ctx) => editVideo(ctx, args),
  },
];

/** ctx: { chatId, projectId, userText, signal, send } -> { defs, run(name, args) } */
export async function buildTools(ctx) {
  const flags = await Promise.all(TOOLS.map(async (t) => !t.available || (await t.available(ctx))));
  const active = TOOLS.filter((_, i) => flags[i]);
  return {
    names: active.map((t) => t.name),
    defs: active.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    async run(name, args) {
      const tool = active.find((t) => t.name === name);
      if (!tool) return { ok: false, text: JSON.stringify({ error: `Unknown tool "${name}".` }), display: `Unknown tool ${name}` };
      try {
        const r = await tool.run(args && typeof args === 'object' ? args : {}, ctx);
        return { ok: true, text: String(r.text).slice(0, MAX_RESULT), display: String(r.display ?? r.text).slice(0, 300) };
      } catch (e) {
        return { ok: false, text: JSON.stringify({ error: e.message }), display: e.message.slice(0, 300) };
      }
    },
  };
}

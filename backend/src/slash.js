// Slash commands run without the language model, so they work with ANY model (even ones without tool support).
import { generateImage, editImage, transformImage, editVideo } from './creative.js';

export function parseSlash(text) {
  const m = /^\/(image|edit|img|video)\b[ \t]*([\s\S]*)$/i.exec(String(text || '').trim());
  return m ? { cmd: m[1].toLowerCase(), args: m[2].trim() } : null;
}

const USAGE = {
  image: 'Create a picture:\n\n`/image a red kite over Delhi at sunset`\n\nOptions: `--landscape`, `--portrait` (default is square). Needs an image provider (see README, Phase 5).',
  edit: 'Change the newest picture in this chat with AI:\n\n`/edit make the sky purple`\n\nOptional: `--strength 0.4` (lower keeps more of the original). Needs an editing-capable image provider.',
  img: 'Simple picture edits (no AI needed), applied to the newest picture:\n\n`/img resize 800` · `/img resize 1200x630` · `/img crop 10` (10% off every side) · `/img crop 0 20 0 0` (left top right bottom, in %)\n`/img rotate 90` · `/img flip` · `/img grayscale` · `/img brightness 1.3` · `/img contrast 1.2` · `/img saturation 0.5` · `/img blur 3` · `/img sharpen` · `/img webp` · `/img jpg 80`\n\nChain edits with commas: `/img resize 800, grayscale, webp`',
  video: 'Edit the newest video (or audio) in this chat:\n\n`/video trim 0:10 0:40` · `/video audio` · `/video gif 5 4` (start, seconds) · `/video compress` (optional: crf, max height) · `/video resize 480` · `/video speed 1.5` · `/video subtitles` (burns in the transcript)',
};

function time(v) {
  const s = String(v).replace(/s$/i, '');
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (!m) throw new Error(`"${v}" is not a time. Use seconds (90) or minutes:seconds (1:30).`);
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
const num = (v, what) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${what} must be a number, got "${v}".`);
  return n;
};

const EDIT_WORDS = { gray: 'grayscale', bw: 'grayscale', greyscale: 'grayscale', grey: 'grayscale' };

function imgOp(part) {
  const [rawName, ...a] = part.trim().split(/\s+/);
  const name = EDIT_WORDS[rawName.toLowerCase()] || rawName.toLowerCase();
  switch (name) {
    case 'resize': {
      const wh = /^(\d+)x(\d+)$/i.exec(a[0] || '');
      if (wh) return { op: 'resize', width: Number(wh[1]), height: Number(wh[2]) };
      if (!a[0]) throw new Error('resize needs a size, e.g. /img resize 800');
      return { op: 'resize', max_side: num(a[0], 'size') };
    }
    case 'crop': {
      if (!a.length) throw new Error('crop needs percentages, e.g. /img crop 10');
      const n = a.map((x) => num(x, 'crop value'));
      return n.length === 1 ? { op: 'crop', left: n[0], top: n[0], right: n[0], bottom: n[0] }
        : { op: 'crop', left: n[0], top: n[1] ?? 0, right: n[2] ?? 0, bottom: n[3] ?? 0 };
    }
    case 'rotate': return { op: 'rotate', degrees: num(a[0] ?? 90, 'degrees') };
    case 'flip': return { op: 'flip', direction: /^v/i.test(a[0] || '') ? 'vertical' : 'horizontal' };
    case 'grayscale': return { op: 'grayscale' };
    case 'brightness': case 'contrast': case 'saturation': return { op: name, factor: num(a[0] ?? 1.2, 'factor') };
    case 'blur': return { op: 'blur', radius: num(a[0] ?? 2, 'radius') };
    case 'sharpen': return { op: 'sharpen' };
    case 'png': case 'jpg': case 'jpeg': case 'webp': return { op: 'format', format: name, ...(a[0] ? { quality: num(a[0], 'quality') } : {}) };
    default: throw new Error(`Unknown picture edit "${rawName}". Type /img to see the list.`);
  }
}

function videoOp(args) {
  const [rawName, ...a] = args.trim().split(/\s+/);
  switch ((rawName || '').toLowerCase()) {
    case 'trim': case 'cut': {
      if (a.length < 2) throw new Error('trim needs a start and an end, e.g. /video trim 0:10 0:40');
      return { operation: 'trim', params: { start: time(a[0]), end: time(a[1]) } };
    }
    case 'audio': case 'mp3': return { operation: 'extract_audio', params: {} };
    case 'gif': return { operation: 'gif', params: { ...(a[0] ? { start: time(a[0]) } : {}), ...(a[1] ? { seconds: num(a[1], 'seconds') } : {}) } };
    case 'compress': return { operation: 'compress', params: { ...(a[0] ? { crf: num(a[0], 'crf') } : {}), ...(a[1] ? { max_height: num(a[1], 'max height') } : {}) } };
    case 'resize': if (!a[0]) throw new Error('resize needs a height, e.g. /video resize 480'); return { operation: 'resize', params: { height: num(a[0], 'height') } };
    case 'speed': if (!a[0]) throw new Error('speed needs a factor, e.g. /video speed 1.5'); return { operation: 'speed', params: { factor: num(a[0], 'factor') } };
    case 'subtitles': case 'subs': case 'burn': return { operation: 'burn_subtitles', params: {} };
    default: throw new Error(`Unknown video edit "${rawName}". Type /video to see the list.`);
  }
}

/** -> { text, display, tool, args } (text is the assistant's reply) */
export async function runSlash({ cmd, args }, ctx) {
  if (!args) return { text: USAGE[cmd] };

  if (cmd === 'image') {
    const size = /--landscape/i.test(args) ? 'landscape' : /--portrait/i.test(args) ? 'portrait' : 'square';
    const prompt = args.replace(/--(landscape|portrait|square)/gi, '').trim();
    if (!prompt) return { text: USAGE.image };
    const r = await generateImage(ctx, { prompt, size });
    return { text: `Here is your image for: "${prompt}"`, display: r.display, tool: 'generate_image', args: { prompt, size } };
  }
  if (cmd === 'edit') {
    const m = /--strength\s+([\d.]+)/i.exec(args);
    const prompt = args.replace(/--strength\s+[\d.]+/i, '').trim();
    if (!prompt) return { text: USAGE.edit };
    const r = await editImage(ctx, { prompt, strength: m ? Number(m[1]) : 0.6 });
    return { text: `Done: "${prompt}"`, display: r.display, tool: 'edit_image', args: { prompt } };
  }
  if (cmd === 'img') {
    const operations = args.split(/[,;]/).filter((p) => p.trim()).map(imgOp);
    const r = await transformImage(ctx, { operations });
    return { text: 'Done. Here is the edited picture.', display: r.display, tool: 'transform_image', args: { operations } };
  }
  const { operation, params } = videoOp(args);
  const r = await editVideo(ctx, { operation, params });
  return { text: 'Done. Here is the result.', display: r.display, tool: 'edit_video', args: { operation, params } };
}

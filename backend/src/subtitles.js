const pad = (n, l = 2) => String(n).padStart(l, '0');

export function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

function stamp(sec, sep) {
  const ms = Math.round(sec * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}${sep}${pad(ms % 1000, 3)}`;
}

function wrap(text, width) {
  const lines = [];
  let cur = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) { // very long words / scripts without spaces
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ' ' + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Whisper segments can be long; split into cues of at most 2 lines, timing proportional to text length.
export function toCues(segments, width = 42) {
  const cues = [];
  for (const seg of segments) {
    const lines = wrap(seg.text, width);
    const groups = [];
    for (let i = 0; i < lines.length; i += 2) groups.push(lines.slice(i, i + 2));
    const total = groups.reduce((n, g) => n + g.join(' ').length, 0) || 1;
    let t = seg.start;
    const dur = Math.max(seg.end - seg.start, 0.5);
    for (const g of groups) {
      const d = (dur * g.join(' ').length) / total;
      cues.push({ start: t, end: t + d, text: g.join('\n') });
      t += d;
    }
  }
  return cues;
}

export const toSrt = (segments) =>
  toCues(segments).map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');

export const toVtt = (segments) =>
  'WEBVTT\n\n' + toCues(segments).map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n');

export const toTxt = (segments) => segments.map((s) => `[${clock(s.start)}] ${s.text}`).join('\n');

// Text the model reads (also stored for search / Q&A)
export function transcriptText({ name, kind, meta, language, segments }) {
  const bits = [`duration ${clock(meta.duration || 0)}`];
  if (meta.width) bits.push(`${meta.width}x${meta.height}`);
  let lang = '';
  if (language?.code) {
    let label = language.code;
    try { label = new Intl.DisplayNames(['en'], { type: 'language' }).of(language.code) || label; } catch { /* keep code */ }
    lang = `Detected spoken language: ${label}.\n`;
  }
  const head = `${kind === 'video' ? 'Video' : 'Audio'} file "${name}" (${bits.join(', ')}).\n${lang}`;
  return segments.length
    ? `${head}Transcript with timestamps:\n${toTxt(segments)}`
    : `${head}No speech transcript is available for this file.`;
}

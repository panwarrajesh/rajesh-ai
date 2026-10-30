// Text-to-speech engine: voice choice (female where available), per-sentence language, a sentence queue,
// and a streamer that starts speaking a reply while it is still being written. Safe to import without a browser.

const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

export function detectLang(text, englishLang = 'en-IN') {
  const letters = (text.match(/\p{L}/gu) || []).length || 1;
  const devanagari = (text.match(/[\u0900-\u097F]/g) || []).length;
  return devanagari / letters >= 0.25 ? 'hi-IN' : englishLang;
}

// Markdown -> plain words a voice can read
export function cleanForSpeech(raw) {
  return String(raw)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/`+/g, '')
    .replace(/^[\s|:-]{3,}$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~|]+/g, ' ')
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const BOUNDARY = /[.!?।॥]+["')\]]*(?=\s)|\n+/g; // a sentence ends here, or at a line break

/** Cuts a growing text into speakable sentences. Code blocks are skipped (announced once). */
export class SpeechChunker {
  constructor() { this.offset = 0; this.inCode = false; }

  _clean(sentence) {
    let spoken = '';
    sentence.split('```').forEach((part, i) => {
      if (i > 0) {
        this.inCode = !this.inCode;
        if (this.inCode) spoken += ' The code is shown on screen. ';
      }
      if (!this.inCode) spoken += ' ' + part;
    });
    return cleanForSpeech(spoken);
  }

  push(text, final = false) {
    const out = [];
    const rest = text.slice(this.offset);
    let from = 0;
    BOUNDARY.lastIndex = 0;
    let m;
    while ((m = BOUNDARY.exec(rest))) {
      const end = m.index + m[0].length;
      const c = this._clean(rest.slice(from, end));
      if (c) out.push(c);
      from = end;
    }
    let tail = rest.slice(from);
    // a very long sentence without punctuation: cut at a comma or space so speech doesn't wait forever
    while (!final && tail.length > 240) {
      let cut = Math.max(tail.lastIndexOf(', ', 200), tail.lastIndexOf('، ', 200));
      if (cut < 60) cut = tail.lastIndexOf(' ', 200);
      if (cut < 60) break;
      const c = this._clean(tail.slice(0, cut + 1));
      if (c) out.push(c);
      from += cut + 1;
      tail = rest.slice(from);
    }
    if (final) {
      const c = this._clean(tail);
      if (c) out.push(c);
      from = rest.length;
    }
    this.offset += from;
    return out;
  }
}

// ---------- voice choice ----------
const FEMALE = /(female|woman|swara|kalpana|lekha|heera|veena|neerja|priya|aditi|raveena|zira|aria|jenny|samantha|karen|tessa|moira|fiona|susan|hazel|sonia|libby|natasha|google हिन्दी|google hindi|google uk english female|google us english)/i;
const MALE = /(\bmale\b|hemant|ravi|prabhat|rishi|david|mark|james|daniel|alex|fred|george|guy|ryan|thomas|google uk english male)/i;

export function pickVoice(voices, lang, preferredURI = '') {
  if (preferredURI) {
    const chosen = voices.find((v) => v.voiceURI === preferredURI);
    if (chosen && chosen.lang.replace('_', '-').slice(0, 2).toLowerCase() === lang.slice(0, 2).toLowerCase()) return chosen;
  }
  let best = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const vl = v.lang.replace('_', '-').toLowerCase();
    const want = lang.toLowerCase();
    let score = vl === want ? 20 : vl.slice(0, 2) === want.slice(0, 2) ? 10 : -100;
    if (score < 0) continue;
    if (FEMALE.test(v.name)) score += 10;
    if (MALE.test(v.name)) score -= 10;
    if (/natural|online|neural/i.test(v.name)) score += 4;
    if (/google/i.test(v.name)) score += 1;
    if (v.localService) score += 1;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

export class Speaker {
  constructor(synth, Utterance) {
    this.synth = synth || null;
    this.Utterance = Utterance || null;
    this.queue = [];
    this.busy = false;
    this.gen = 0; // bumped by stop(), so late callbacks from cancelled speech are ignored
    this.muted = false;
    this.warned = false;
    this.listeners = new Set();
    this.opts = { rate: 1, voiceURI: '', englishLang: 'en-IN' };
    if (this.synth) {
      this.synth.getVoices?.();
      if ('onvoiceschanged' in this.synth) this.synth.onvoiceschanged = () => this.emit('voices');
    }
  }

  get supported() { return Boolean(this.synth && this.Utterance); }
  get speaking() { return this.busy || this.queue.length > 0; }
  configure(o) { Object.assign(this.opts, o); }
  voices() { return this.synth?.getVoices?.() || []; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of [...this.listeners]) fn(type, data); }

  // Safari/iOS only allow speech that was unlocked by a tap; call this inside the tap handler.
  prime() {
    if (!this.supported) return;
    try { const u = new this.Utterance(' '); u.volume = 0; this.synth.speak(u); } catch { /* ignore */ }
  }

  speak(text, { force = false } = {}) {
    if (!this.supported || !text) return false;
    if (this.muted && !force) return false;
    this.queue.push(text);
    this._pump();
    return true;
  }

  _pump() {
    if (this.busy || !this.queue.length) return;
    const text = this.queue.shift();
    const lang = detectLang(text, this.opts.englishLang);
    const voices = this.voices();
    const voice = pickVoice(voices, lang, this.opts.voiceURI);
    if (!voice && lang.startsWith('hi') && voices.length && !this.warned) {
      this.warned = true;
      this.emit('warn', 'No Hindi voice was found on this device, so Hindi is read by a default voice and may sound wrong. Install a Hindi voice in your system settings.');
    }
    const u = new this.Utterance(text);
    u.lang = voice?.lang || lang;
    if (voice) u.voice = voice;
    u.rate = this.opts.rate;
    const gen = this.gen;
    this.busy = true;
    u.onstart = () => { if (gen === this.gen) this.emit('start'); };
    u.onboundary = () => { if (gen === this.gen) this.emit('boundary'); };
    const done = () => {
      if (gen !== this.gen) return;
      this.busy = false;
      if (this.queue.length) this._pump(); else this.emit('idle');
    };
    u.onend = done;
    u.onerror = done;
    try {
      this.synth.speak(u);
    } catch {
      // a browser refused to speak (locked audio, bad state): carry on instead of breaking the screen
      this.busy = false;
      this.emit('warn', 'This browser could not speak that text. Check the sound settings or tap the screen once and try again.');
      if (this.queue.length) this._pump(); else this.emit('idle');
    }
  }

  stop() {
    const was = this.speaking;
    this.gen++;
    this.queue = [];
    this.busy = false;
    try { this.synth?.cancel(); } catch { /* ignore */ }
    if (was) this.emit('idle');
  }
}

/** Feeds a reply to the speaker while it is still being written. */
export class ReplyStreamer {
  constructor(speaker) { this.speaker = speaker; this.chunker = new SpeechChunker(); this.skip = false; }
  update(text, final) {
    const chunks = this.chunker.push(text, final); // always advance, so nothing old is spoken after un-muting
    if (this.skip) return [];
    chunks.forEach((c) => this.speaker.speak(c));
    return chunks;
  }
  stopSpeaking() { this.skip = true; this.speaker.stop(); }
}

export const speaker = typeof window !== 'undefined' && window.speechSynthesis
  ? new Speaker(window.speechSynthesis, window.SpeechSynthesisUtterance)
  : new Speaker(null, null);

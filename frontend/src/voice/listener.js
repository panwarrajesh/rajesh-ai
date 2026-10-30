// Speech input: the browser's own recognition, or recording + server-side Whisper as a fallback.
export const hasBrowserRecognition = () =>
  typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
export const canRecord = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
const isMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// pref: 'auto' | 'browser' | 'server'  ->  'browser' | 'server' | 'none'
export function resolveSttMode(pref) {
  const b = hasBrowserRecognition();
  const s = canRecord();
  if (pref === 'server') return s ? 'server' : b ? 'browser' : 'none';
  if (pref === 'browser') return b ? 'browser' : s ? 'server' : 'none';
  return b ? 'browser' : s ? 'server' : 'none';
}

export function errorMessage(code, detail) {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed':
      return 'Microphone access is blocked. Allow the microphone for this site in your browser settings, or type your message below.';
    case 'audio-capture': return 'No microphone was found. Plug one in, or type your message below.';
    case 'network': return 'Speech recognition needs an internet connection (it runs on your browser vendor\'s servers). Check your connection, or switch to "This computer" in Settings, or type below.';
    case 'language-not-supported': return 'This browser does not support recognition for the chosen language. Pick another language in Settings.';
    case 'transcribe': return detail || 'Speech-to-text failed. You can type your message below.';
    default: return 'Speech recognition stopped unexpectedly. Tap the mic to try again, or type below.';
  }
}

// When to stop a recording: spoke then went quiet / too long / never spoke
export function shouldStopRecording({ now, start, lastVoice, speechSeen, maxMs = 30000, silenceMs = 1200, noSpeechMs = 8000 }) {
  if (now - start > maxMs) return 'max';
  if (speechSeen && now - lastVoice > silenceMs) return 'silence';
  if (!speechSeen && now - start > noSpeechMs) return 'nospeech';
  return null;
}

function rms(analyser, buf) {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
  return Math.sqrt(sum / buf.length);
}

async function openMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  return { stream, ctx, analyser, close() { stream.getTracks().forEach((t) => t.stop()); ctx.close?.().catch(() => {}); } };
}

/** Browser recognition: one utterance per start(); onEnd(text) is called when it finishes ('' if nothing was heard). */
export function createBrowserListener({ lang, onInterim, onEnd, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let finalText = '';
  let aborted = false;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else interim += t;
    }
    onInterim?.((finalText + interim).trim());
  };
  r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') onError?.(e.error); };
  r.onend = () => { if (!aborted) onEnd?.(finalText.trim()); };
  return {
    start: () => r.start(),
    abort: () => { aborted = true; try { r.abort(); } catch { /* ignore */ } },
  };
}

/** Records one spoken sentence, stops by itself when you go quiet, then asks the server to transcribe it. */
export function createServerListener({ onLevel, onState, transcribe, onEnd, onError }) {
  let aborted = false;
  let mic = null;
  let timer = null;
  let rec = null;
  const cleanup = () => { clearInterval(timer); mic?.close(); mic = null; };
  return {
    async start() {
      try { mic = await openMic(); } catch (e) { onError?.(e?.name === 'NotFoundError' ? 'audio-capture' : 'not-allowed'); return; }
      if (aborted) { cleanup(); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m));
      rec = new MediaRecorder(mic.stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const buf = new Uint8Array(mic.analyser.fftSize);
      const start = Date.now();
      let floor = null;
      let speechSeen = false;
      let lastVoice = start;
      rec.onstop = async () => {
        const heard = speechSeen;
        const type = rec.mimeType || 'audio/webm';
        cleanup();
        if (aborted) return;
        if (!heard || !chunks.length) { onEnd?.(''); return; }
        onState?.('transcribing');
        try { onEnd?.(await transcribe(new Blob(chunks, { type }))); }
        catch (e) { onError?.('transcribe', e.message); }
      };
      rec.start();
      timer = setInterval(() => {
        const level = rms(mic.analyser, buf);
        onLevel?.(Math.min(level * 5, 1));
        const now = Date.now();
        if (floor === null) floor = level; else if (now - start < 400) floor = Math.max(floor, level);
        const threshold = Math.max(0.03, (floor || 0) * 2.5);
        if (now - start > 400 && level > threshold) { speechSeen = true; lastVoice = now; }
        if (shouldStopRecording({ now, start, lastVoice, speechSeen }) && rec.state === 'recording') rec.stop();
      }, 80);
    },
    abort() { aborted = true; cleanup(); try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ } },
  };
}

/** Real microphone level for the orb while the browser does the recognition (skipped on phones, where a second mic stream can break recognition). */
export async function createLevelMeter(onLevel) {
  if (isMobile() || !canRecord()) return () => {};
  try {
    const mic = await openMic();
    const buf = new Uint8Array(mic.analyser.fftSize);
    const timer = setInterval(() => onLevel(Math.min(rms(mic.analyser, buf) * 5, 1)), 80);
    return () => { clearInterval(timer); mic.close(); };
  } catch { return () => {}; }
}

import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Square, RotateCcw, SendHorizontal, X, Settings as Cog, Paperclip, FileText } from 'lucide-react';
import Orb from '../voice/Orb.jsx';
import { speaker, ReplyStreamer, SpeechChunker } from '../voice/speech.js';
import { resolveSttMode, createBrowserListener, createServerListener, createLevelMeter, errorMessage } from '../voice/listener.js';
import { api } from '../api.js';
import { ACCEPT } from '../fileTypes.js';
import { PendingChip } from './Attachments.jsx';

const GREET_KEY = 'rajesh.lastGreeting';
const GREET_GAP = 10 * 60 * 1000; // the greeting is spoken once per voice session, not again if you reopen within 10 minutes
const LABEL = { idle: ['Ready', 'तैयार'], listening: ['Listening', 'सुन रही हूँ'], thinking: ['Thinking', 'सोच रही हूँ'], speaking: ['Speaking', 'बोल रही हूँ'] };
const NO_STT = 'Voice input is not available in this browser. Type your message below, or open Rajesh AI in Chrome, Edge or Safari.';
const IDLE_HINT = 'I stopped listening because I did not hear anything. Tap the mic to talk again. / कुछ सुनाई नहीं दिया, फिर से बोलने के लिए माइक दबाइए।';

const explainPrompt = (lang) =>
  String(lang).startsWith('hi') ? 'इन फ़ाइलों में क्या है, सरल हिंदी में समझाइए।' : 'Please explain what is in these files in simple words.';

function VoiceSession({ onClose, settings, setSettings, prefs, messages, streaming, error, notice, onSend, onStopGeneration, attach, onOpenSettings }) {
  const startMode = resolveSttMode(settings.sttMode || 'auto');
  const [phase, setPhaseState] = useState('idle');
  const [active, setActiveState] = useState(startMode !== 'none'); // continuous conversation on/off (off when there is no microphone support)
  const [muted, setMutedState] = useState(() => localStorage.getItem('rajesh.muted') === '1');
  const [interim, setInterim] = useState('');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [hint, setHint] = useState('');
  const [localErr, setLocalErr] = useState(startMode === 'none' ? NO_STT : '');
  const [typed, setTyped] = useState('');

  const levelRef = useRef(0);
  const phaseRef = useRef('idle');
  const activeRef = useRef(startMode !== 'none');
  const mutedRef = useRef(muted);
  const closedRef = useRef(false);
  const awaitingRef = useRef(false);
  const sawStreamRef = useRef(false);
  const baseLenRef = useRef(0);
  const emptyRef = useRef(0);
  const listenerRef = useRef(null);
  const meterRef = useRef(null);
  const streamerRef = useRef(null);
  const lastReplyRef = useRef('');
  const lastBoundaryRef = useRef(0);
  const fileInput = useRef(null);
  const P = useRef({});
  P.current = { settings, prefs, messages, streaming, onSend, attach };

  // All behaviour lives here, written once. It reads the latest props through P.current.
  const ctl = useMemo(() => {
    const self = {};
    const setPhase = (p) => { phaseRef.current = p; setPhaseState(p); };
    const setActive = (v) => { activeRef.current = v; setActiveState(v); };

    const stopListening = () => {
      listenerRef.current?.abort(); listenerRef.current = null;
      meterRef.current?.(); meterRef.current = null;
    };

    // the AI finished talking (or never spoke): go back to listening if the conversation is on
    const afterSpeech = () => {
      if (closedRef.current) return;
      setPhase('idle');
      if (!activeRef.current) return;
      setTimeout(() => {
        if (!closedRef.current && activeRef.current && phaseRef.current === 'idle' && !speaker.speaking && !awaitingRef.current) self.startListening();
      }, 350);
    };

    const replyDone = () => { if (!speaker.speaking) afterSpeech(); }; // otherwise wait for the speaker's "idle"

    const startListening = async () => {
      if (closedRef.current || !activeRef.current || listenerRef.current) return;
      const { settings: s } = P.current;
      const mode = resolveSttMode(s.sttMode || 'auto');
      if (mode === 'none') { setLocalErr(NO_STT); setActive(false); setPhase('idle'); return; }
      setLocalErr(''); setInterim('');
      setPhase('listening');
      const lang = s.voiceLang || 'hi-IN';
      const onLevel = (l) => { levelRef.current = Math.max(levelRef.current, l); };
      if (mode === 'browser') {
        const l = createBrowserListener({ lang, onInterim: setInterim, onEnd: (t) => self.heardText(t), onError: (c) => self.sttError(c) });
        listenerRef.current = l;
        try { l.start(); } catch { listenerRef.current = null; self.sttError('other'); return; }
        createLevelMeter(onLevel).then((stop) => { if (listenerRef.current === l) meterRef.current = stop; else stop(); });
      } else {
        const l = createServerListener({
          onLevel,
          onState: (st) => { if (st === 'transcribing') { setPhase('thinking'); setHint('Transcribing your voice...'); } },
          transcribe: async (blob) => (await api.transcribe(blob, lang)).text || '',
          onEnd: (t) => self.heardText(t),
          onError: (c, d) => self.sttError(c, d),
        });
        listenerRef.current = l;
        l.start();
      }
    };

    const sttError = (code, detail) => {
      stopListening();
      setLocalErr(errorMessage(code, detail));
      setActive(false);
      setPhase('idle');
    };

    const heardText = (text) => {
      stopListening();
      if (closedRef.current) return;
      setInterim(''); setHint('');
      const t = (text || '').trim();
      if (!t) {
        emptyRef.current += 1;
        if (emptyRef.current >= 2) { emptyRef.current = 0; setActive(false); setPhase('idle'); setHint(IDLE_HINT); return; }
        setPhase('idle');
        setTimeout(() => self.startListening(), 250);
        return;
      }
      emptyRef.current = 0;
      self.sendText(t);
    };

    const sendText = (text) => {
      const p = P.current;
      const t = String(text).trim();
      if (!t && !p.attach.ready.length) return;
      const content = t || explainPrompt(p.settings.voiceLang);
      awaitingRef.current = true; // set first: stopping the speaker below must not restart the microphone
      sawStreamRef.current = false;
      baseLenRef.current = p.messages.length;
      stopListening();
      speaker.stop();
      setHeard(content); setInterim(''); setReply(''); setHint(''); setLocalErr('');
      streamerRef.current = new ReplyStreamer(speaker);
      streamerRef.current.skip = mutedRef.current;
      setPhase('thinking');
      Promise.resolve(p.onSend(content)).finally(() => {
        if (awaitingRef.current && !sawStreamRef.current) { awaitingRef.current = false; replyDone(); } // sending failed before any reply
      });
    };

    // called whenever the chat messages / streaming flag change
    const onMessages = () => {
      if (!awaitingRef.current) return;
      const { messages: ms, streaming: st } = P.current;
      if (st) sawStreamRef.current = true;
      if (!sawStreamRef.current) return;
      const last = ms[ms.length - 1];
      const hasReply = last?.role === 'assistant' && ms.length >= baseLenRef.current + 2;
      const text = hasReply ? last.content || '' : '';
      if (hasReply) { setReply(text); streamerRef.current?.update(text, !st); }
      if (!st) {
        if (text) lastReplyRef.current = text;
        awaitingRef.current = false;
        replyDone();
      }
    };

    Object.assign(self, { setPhase, setActive, stopListening, afterSpeech, replyDone, startListening, sttError, heardText, sendText, onMessages });
    return self;
  }, []);

  useEffect(() => { ctl.onMessages(); }, [messages, streaming, ctl]);

  // speaker events drive the phase and the orb's pulse
  useEffect(() => speaker.subscribe((type, data) => {
    if (closedRef.current) return;
    if (type === 'start') ctl.setPhase('speaking');
    else if (type === 'boundary') { levelRef.current = Math.max(levelRef.current, 0.9); lastBoundaryRef.current = performance.now(); }
    else if (type === 'idle') { if (awaitingRef.current) ctl.setPhase('thinking'); else ctl.afterSpeech(); }
    else if (type === 'warn') setHint(data);
  }), [ctl]);

  // some voices send no word-boundary events: keep the orb gently moving while speaking
  useEffect(() => {
    if (phase !== 'speaking') return undefined;
    const id = setInterval(() => {
      const now = performance.now();
      if (now - lastBoundaryRef.current > 500) levelRef.current = Math.max(levelRef.current, 0.35 + 0.25 * Math.sin(now / 160));
    }, 120);
    return () => clearInterval(id);
  }, [phase]);

  // session start: greet once, then start listening
  useEffect(() => {
    closedRef.current = false;
    speaker.muted = mutedRef.current;
    const greeting = P.current.prefs.greeting;
    const fresh = Date.now() - Number(localStorage.getItem(GREET_KEY) || 0) > GREET_GAP;
    if (fresh && greeting) {
      localStorage.setItem(GREET_KEY, String(Date.now()));
      setReply(greeting);
      if (!mutedRef.current) new SpeechChunker().push(greeting, true).forEach((c) => speaker.speak(c));
    }
    if (!speaker.supported) setHint('This browser cannot speak aloud, so replies are only shown as text.');
    if (!speaker.speaking) ctl.afterSpeech(); // otherwise the speaker's "idle" event does it
    return () => { closedRef.current = true; ctl.stopListening(); speaker.stop(); };
  }, [ctl]);

  // ---- controls ----
  const close = () => { closedRef.current = true; ctl.stopListening(); speaker.stop(); onClose(); };

  const toggleMic = () => {
    if (activeRef.current) {
      ctl.setActive(false); ctl.stopListening(); setInterim('');
      if (phaseRef.current === 'listening') ctl.setPhase('idle');
    } else {
      ctl.setActive(true); setLocalErr('');
      if (phaseRef.current === 'speaking') speaker.stop(); // its "idle" event then starts listening
      else if (phaseRef.current === 'idle') ctl.startListening();
    }
  };
  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next; setMutedState(next);
    localStorage.setItem('rajesh.muted', next ? '1' : '0');
    speaker.muted = next;
    if (streamerRef.current) streamerRef.current.skip = next;
    if (next) speaker.stop();
  };
  const stopSpeaking = () => { if (streamerRef.current) streamerRef.current.stopSpeaking(); else speaker.stop(); };
  const replay = () => {
    const text = lastReplyRef.current;
    if (!text || mutedRef.current) return;
    ctl.stopListening();
    speaker.stop();
    new SpeechChunker().push(text, true).forEach((c) => speaker.speak(c));
  };
  const submitTyped = (e) => {
    e.preventDefault();
    if (!typed.trim() && !attach.ready.length) return;
    ctl.sendText(typed);
    setTyped('');
  };
  const toggleLang = () => setSettings((s) => ({ ...s, voiceLang: String(s.voiceLang).startsWith('hi') ? 'en-IN' : 'hi-IN' }));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === ' ' && !/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) { e.preventDefault(); toggleMic(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const mode = resolveSttMode(settings.sttMode || 'auto');
  const [en, hi] = LABEL[phase];
  const banner = localErr || error;
  const canExplain = attach.ready.length > 0 && !attach.busy && phase !== 'thinking';
  const ctrl = 'flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div role="dialog" aria-modal="true" aria-label="Voice conversation"
      className="fixed inset-0 z-50 flex flex-col bg-[radial-gradient(ellipse_at_50%_35%,#18235a_0%,#0b1020_65%)] text-white"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-medium text-white/80">{prefs.assistant_name}</p>
        <div className="flex items-center gap-1">
          <button onClick={toggleLang} aria-label={`Speech language: ${settings.voiceLang}. Tap to switch`} title="Switch speaking language"
            className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium hover:bg-white/10">
            {String(settings.voiceLang).startsWith('hi') ? 'हिं' : 'EN'}
          </button>
          <button onClick={onOpenSettings} aria-label="Voice settings" title="Voice settings" className="rounded-full p-2 hover:bg-white/10"><Cog size={20} /></button>
          <button onClick={close} aria-label="Close voice mode" title="Close (Esc)" className="rounded-full p-2 hover:bg-white/10"><X size={22} /></button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4">
        <div className="w-[min(74vw,330px)] max-h-[40vh] flex-none"><Orb state={phase} levelRef={levelRef} /></div>
        <div className="text-center" aria-live="polite">
          <p className="text-xl font-semibold tracking-wide">{en} <span className="font-normal text-white/60">· {hi}</span></p>
          {phase === 'idle' && !active && <p className="mt-1 text-sm text-white/60">Tap the mic to talk · बोलने के लिए माइक दबाइए</p>}
        </div>
        <div className="w-full max-w-xl space-y-2 overflow-y-auto text-center" style={{ maxHeight: '26vh' }}>
          {(interim || heard) && <p className="text-sm text-white/60">{interim ? `“${interim}”` : `You: ${heard}`}</p>}
          {reply && <p className="whitespace-pre-wrap text-base leading-relaxed text-white/95">{reply}</p>}
        </div>
      </main>

      {(banner || hint || notice) && (
        <div className="mx-auto mb-2 w-full max-w-xl space-y-1 px-4 text-sm">
          {banner && <p role="alert" className="rounded-lg bg-red-500/20 px-3 py-2 text-red-100">{banner}</p>}
          {hint && <p role="status" className="rounded-lg bg-white/10 px-3 py-2 text-white/90">{hint}</p>}
          {notice && <p role="status" className="rounded-lg bg-white/10 px-3 py-2 text-white/90">{notice}</p>}
        </div>
      )}

      {attach.items.length > 0 && (
        <div className="mx-auto mb-2 flex w-full max-w-xl flex-wrap items-center gap-2 px-4 text-slate-900">
          {attach.items.map((it) => <PendingChip key={it.key} item={it} onRemove={() => attach.remove(it.key)} />)}
          {canExplain && (
            <button onClick={() => ctl.sendText('')} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-white/90">
              <FileText size={14} /> Explain my file aloud
            </button>
          )}
        </div>
      )}

      <footer className="px-4 pb-4">
        <div className="mx-auto flex max-w-xl items-center justify-center gap-3">
          <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { attach.add(e.target.files); e.target.value = ''; }} />
          <button onClick={() => fileInput.current?.click()} aria-label="Attach file" title="Attach a file to talk about" className={ctrl}><Paperclip size={20} /></button>
          <button onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute voice replies' : 'Mute voice replies'} title={muted ? 'Unmute' : 'Mute'} className={ctrl}>
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <button onClick={toggleMic} disabled={mode === 'none'} aria-pressed={active}
            aria-label={active ? 'Stop listening' : 'Start listening'} title={active ? 'Stop listening (Space)' : 'Start listening (Space)'}
            className={`flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? 'bg-blue-500 hover:bg-blue-400' : 'bg-white/15 hover:bg-white/25'} ${phase === 'listening' ? 'ring-4 ring-blue-300/50' : ''}`}>
            {active ? <Mic size={26} /> : <MicOff size={26} />}
          </button>
          {phase === 'thinking' ? (
            <button onClick={onStopGeneration} aria-label="Stop generating" title="Stop generating" className={ctrl}><Square size={18} fill="currentColor" /></button>
          ) : (
            <button onClick={stopSpeaking} disabled={phase !== 'speaking'} aria-label="Stop speaking" title="Stop speaking" className={ctrl}><Square size={18} fill="currentColor" /></button>
          )}
          <button onClick={replay} disabled={muted || !lastReplyRef.current || phase === 'thinking'} aria-label="Replay last reply" title={muted ? 'Unmute to replay' : 'Replay'} className={ctrl}><RotateCcw size={20} /></button>
        </div>

        <form onSubmit={submitTyped} className="mx-auto mt-3 flex max-w-xl items-center gap-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type here · या यहाँ लिखिए" aria-label="Type a message"
            className="min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/50" />
          <button type="submit" disabled={!typed.trim() && !attach.ready.length} aria-label="Send" className={ctrl}><SendHorizontal size={18} /></button>
        </form>
        <p className="mx-auto mt-2 max-w-xl text-center text-[11px] text-white/40">
          {mode === 'browser' && 'Voice recognition runs in your browser, which may send audio to its vendor (Google, in Chrome). Choose “This computer” in Settings to keep it local.'}
          {mode === 'server' && 'Voice recognition runs on this computer (Whisper).'}
          {mode === 'none' && 'Voice recognition is not available in this browser, so only typing works.'}
        </p>
      </footer>
    </div>
  );
}

// If anything in the voice screen ever crashes, show a clear message instead of a blank page.
class VoiceBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error('Voice mode crashed', err); speaker.stop(); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#0b1020] p-6 text-center text-white">
        <p className="text-lg font-semibold">Voice mode ran into a problem.</p>
        <p className="max-w-sm text-sm text-white/70">You can keep chatting by typing. Close this screen and open it again to retry.</p>
        <button onClick={this.props.onClose} className="rounded-full bg-white px-5 py-2 font-medium text-slate-900">Close</button>
      </div>
    );
  }
}

export default function VoiceMode(props) {
  // a fresh session (state, greeting) every time it opens
  return props.open ? <VoiceBoundary onClose={props.onClose}><VoiceSession {...props} /></VoiceBoundary> : null;
}

import { useEffect, useRef, useState } from 'react';
import { SendHorizontal, Square, Mic, MicOff, Paperclip } from 'lucide-react';
import { ACCEPT } from '../fileTypes.js';
import { PendingChip } from './Attachments.jsx';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const COMMANDS = [
  ['/image', 'create a picture from a description'],
  ['/edit', 'change the newest picture with AI'],
  ['/img', 'resize, crop, rotate, filters, convert'],
  ['/video', 'trim, audio, gif, compress, speed, subtitles'],
];

export default function Composer({ streaming, onSend, onStop, voiceLang, onError, attach }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const ta = useRef(null);
  const rec = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  const hints = /^\/[a-z]*$/i.test(text) ? COMMANDS.filter(([c]) => c.startsWith(text.toLowerCase())) : [];
  const canSend = !streaming && !attach.busy && (text.trim() || attach.ready.length > 0);

  function submit() {
    if (!canSend) return;
    onSend(text.trim(), attach.ready);
    setText('');
    attach.clear();
  }

  function toggleMic() {
    if (!SR) return onError('Voice input needs Chrome, Edge or Safari. Your browser does not support it.');
    if (listening) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = voiceLang;
    r.interimResults = true;
    r.continuous = true;
    const base = text ? text.trimEnd() + ' ' : '';
    r.onresult = (e) => {
      let s = '';
      for (const res of e.results) s += res[0].transcript;
      setText(base + s);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed') onError('Microphone access is blocked. Allow it in your browser settings.');
      setListening(false);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 pt-2 sm:px-4" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
      {hints.length > 0 && (
        <div role="listbox" aria-label="Commands" className="mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm dark:border-ink-600 dark:bg-ink-800">
          {hints.map(([c, d]) => (
            <button key={c} type="button" role="option" aria-selected="false" onClick={() => { setText(c + ' '); ta.current?.focus(); }}
              className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-ink-700">
              <span className="font-mono font-medium">{c}</span><span className="text-slate-500">{d}</span>
            </button>
          ))}
        </div>
      )}
      <div className="rounded-3xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-brand-500 dark:border-ink-600 dark:bg-ink-800">
        {attach.items.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pb-2 pt-1">
            {attach.items.map((it) => <PendingChip key={it.key} item={it} onRemove={() => attach.remove(it.key)} />)}
          </div>
        )}
        <div className="flex items-end gap-1">
          <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden"
            onChange={(e) => { attach.add(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => fileInput.current?.click()} title="Attach images, PDFs, Word files, text, code, audio or video" aria-label="Attach file"
            className="rounded-full p-2.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-700">
            <Paperclip size={20} />
          </button>
          <textarea
            ref={ta}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData?.files?.length) { e.preventDefault(); attach.add(e.clipboardData.files); }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }}
            placeholder={attach.items.length ? 'Add a question about your file(s)...' : 'Kuch bhi poochho... Ask anything'}
            aria-label="Message"
            className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] outline-none placeholder:text-slate-400"
          />
          <button type="button" onClick={toggleMic} aria-pressed={listening}
            aria-label={listening ? 'Stop voice input' : 'Start voice input'} title="Voice input"
            className={`rounded-full p-2.5 ${listening ? 'bg-red-500 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-700'}`}>
            {listening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          {streaming ? (
            <button type="button" onClick={onStop} aria-label="Stop generating" title="Stop generating"
              className="rounded-full bg-slate-900 p-2.5 text-white dark:bg-slate-100 dark:text-slate-900">
              <Square size={20} fill="currentColor" />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!canSend} aria-label="Send" title={attach.busy ? 'Wait for files to finish processing' : 'Send'}
              className="rounded-full bg-brand-600 p-2.5 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-ink-700">
              <SendHorizontal size={20} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">Rajesh AI can make mistakes. Check important information.</p>
    </div>
  );
}

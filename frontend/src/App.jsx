import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, Sun, Moon, SquarePen, AlertCircle, Info, X, Sparkles, Upload } from 'lucide-react';
import { api, streamChat } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Message from './components/Message.jsx';
import Composer from './components/Composer.jsx';
import Settings from './components/Settings.jsx';
import { useAttachments } from './useAttachments.js';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

const SUGGESTIONS = [
  'Recursion kya hota hai? Step by step samjhao',
  'Mujhe ek React + Express todo app ka project plan do',
  'Explain how HTTP and HTTPS differ, in simple words',
  'Python mein list aur tuple ka difference example ke saath batao',
];

const stripMd = (s) => s.replace(/```[\s\S]*?```/g, ' code block ').replace(/[#*_`>|~-]+/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

export default function App() {
  const [theme, setTheme] = useState(() => load('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [settings, setSettings] = useState(() => load('settings', { provider: '', model: '', temperature: 0.7, voiceLang: 'en-IN' }));
  const [providers, setProviders] = useState([]);
  const [modelsError, setModelsError] = useState('');
  const [chats, setChats] = useState([]);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const attach = useAttachments(setError);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [showSettings, setShowSettings] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const abortRef = useRef(null);
  const scroller = useRef(null);
  const stick = useRef(true);

  // theme
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); save('theme', theme); }, [theme]);
  useEffect(() => save('settings', settings), [settings]);

  // models: load and pick a working default
  const loadModels = useCallback(async () => {
    try {
      const r = await api.models();
      setProviders(r.providers || []);
      setModelsError(r.error || '');
      setSettings((s) => {
        const p = (r.providers || []).find((x) => x.id === s.provider && x.available);
        if (p && p.models.some((m) => m.id === s.model)) return s;
        const first = (r.providers || []).find((x) => x.available);
        return first ? { ...s, provider: first.id, model: first.models[0].id } : s;
      });
    } catch (e) { setModelsError(e.message); }
  }, []);
  useEffect(() => { loadModels(); }, [loadModels]);

  // chat list (with search debounce)
  const refreshChats = useCallback(async (q = query) => {
    try { setChats(await api.chats(q)); } catch (e) { setError(e.message); }
  }, [query]);
  useEffect(() => { const t = setTimeout(() => refreshChats(query), 200); return () => clearTimeout(t); }, [query, refreshChats]);

  // autoscroll while the user is at the bottom
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const closeOnMobile = () => { if (window.innerWidth < 768) setSidebarOpen(false); };

  function newChat() {
    abortRef.current?.abort();
    setActiveId(null); setMessages([]); setError(''); setNotice(''); stick.current = true;
    closeOnMobile();
  }

  async function selectChat(id) {
    abortRef.current?.abort();
    try {
      const c = await api.getChat(id);
      setActiveId(id); setMessages(c.messages); setError(''); stick.current = true;
      closeOnMobile();
    } catch (e) { setError(e.message); }
  }

  async function renameChat(id, title) {
    try { await api.renameChat(id, title); refreshChats(); } catch (e) { setError(e.message); }
  }

  async function deleteChat(id) {
    try {
      await api.deleteChat(id);
      if (id === activeId) newChat();
      refreshChats();
    } catch (e) { setError(e.message); }
  }

  // modes: send | edit | regenerate | continue
  async function run(mode, { content, messageId, attachments = [] } = {}) {
    if (streaming) return;
    setError('');
    setNotice('');
    stick.current = true;
    let chatId = activeId;
    try {
      if (!chatId) {
        const c = await api.createChat();
        chatId = c.id;
        setActiveId(chatId);
      }
    } catch (e) { return setError(e.message); }

    const placeholder = { id: 'tmp-a', role: 'assistant', content: '' };
    setMessages((prev) => {
      if (mode === 'send') return [...prev, { id: 'tmp-u', role: 'user', content: content || 'Please explain what is in the attached file(s).', attachments }, placeholder];
      if (mode === 'edit') {
        const i = prev.findIndex((m) => m.id === messageId);
        return [...prev.slice(0, i), { id: 'tmp-u', role: 'user', content, attachments: [...(prev[i]?.attachments || []), ...attachments] }, placeholder];
      }
      if (mode === 'regenerate') {
        const a = prev.at(-1)?.role === 'assistant' ? prev.slice(0, -1) : prev;
        return [...a, placeholder];
      }
      return prev; // continue appends to the last assistant message
    });

    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    try {
      const body = { mode, content, messageId, attachmentIds: attachments.map((a) => a.id), provider: settings.provider, model: settings.model, temperature: settings.temperature };
      for await (const ev of streamChat(chatId, body, ac.signal)) {
        if (ev.type === 'token') {
          setMessages((prev) => {
            const a = [...prev];
            const last = a[a.length - 1];
            a[a.length - 1] = { ...last, content: last.content + ev.content };
            return a;
          });
        } else if (ev.type === 'notice') {
          setNotice(ev.message);
        } else if (ev.type === 'error') {
          setError(ev.message);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'Connection lost. Check that the backend is running.');
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // sync with the saved state (real ids, partial output after Stop)
      try { const c = await api.getChat(chatId); setActiveId((cur) => { if (cur === chatId) setMessages(c.messages); return cur; }); } catch { /* ignore */ }
      refreshChats();
    }
  }

  function speak(msg) {
    const synth = window.speechSynthesis;
    if (!synth) return setError('Read-aloud is not supported in this browser.');
    const was = speakingId === msg.id;
    synth.cancel();
    if (was) return setSpeakingId(null);
    const u = new SpeechSynthesisUtterance(stripMd(msg.content));
    u.lang = settings.voiceLang;
    u.onend = u.onerror = () => setSpeakingId(null);
    setSpeakingId(msg.id);
    synth.speak(u);
  }

  const noModel = !settings.model;
  const empty = messages.length === 0;

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        open={sidebarOpen} chats={chats} activeId={activeId} query={query} setQuery={setQuery}
        onNew={newChat} onSelect={selectChat} onRename={renameChat} onDelete={deleteChat}
        onSettings={() => { setShowSettings(true); loadModels(); closeOnMobile(); }} onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />}

      <main className="relative flex min-w-0 flex-1 flex-col"
        onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true); } }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); attach.add(e.dataTransfer.files); }}>
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-500 bg-white/90 text-brand-700 dark:bg-ink-900/90 dark:text-brand-500">
            <Upload size={32} />
            <p className="font-medium">Drop files to attach</p>
            <p className="text-sm text-slate-500">Images, PDFs, Word files, text and code</p>
          </div>
        )}
        <header className="flex items-center gap-1 px-3 py-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
          {!sidebarOpen && (
            <>
              <button onClick={() => setSidebarOpen(true)} aria-label="Open sidebar" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-ink-700"><Menu size={20} /></button>
              <button onClick={newChat} aria-label="New chat" title="New chat" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-ink-700"><SquarePen size={20} /></button>
            </>
          )}
          <button onClick={() => setShowSettings(true)} className="ml-1 truncate rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-700" title="Change model">
            {settings.model || 'No model connected'}
          </button>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" title="Toggle theme"
            className="ml-auto rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-ink-700">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </header>

        <div ref={scroller} className="flex-1 overflow-y-auto"
          onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          {empty ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4 text-center">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-800 text-marigold"><Sparkles size={26} /></div>
              <h1 className="text-2xl font-semibold">Namaste, kya madad karun?</h1>
              <p className="mt-2 text-slate-500">Hindi, Hinglish ya English: jis mein aap likho, usi mein jawab milega. Photo, PDF ya document bhi attach kar sakte ho.</p>
              {noModel && (
                <p className="mt-5 rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {modelsError || 'No AI model is connected yet. Open Settings to see what is missing.'}
                </p>
              )}
              <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} disabled={noModel} onClick={() => run('send', { content: s })}
                    className="rounded-xl border border-slate-200 p-3 text-left text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-ink-700 dark:hover:bg-ink-800">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-4" aria-live="polite">
              {messages.map((m, i) => (
                <Message key={m.id} msg={m} isLast={i === messages.length - 1} streaming={streaming}
                  speaking={speakingId === m.id} onSpeak={speak}
                  onRegenerate={() => run('regenerate')} onContinue={() => run('continue')}
                  onEdit={(id, content) => run('edit', { messageId: id, content })} />
              ))}
            </div>
          )}
        </div>

        {notice && (
          <div role="status" className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:border-ink-600 dark:bg-ink-800 dark:text-brand-100">
            <Info size={18} className="mt-0.5 flex-none" />
            <p className="flex-1 break-words">{notice}</p>
            <button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={16} /></button>
          </div>
        )}

        {error && (
          <div role="alert" className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <AlertCircle size={18} className="mt-0.5 flex-none" />
            <p className="flex-1 break-words">{error}</p>
            <button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button>
          </div>
        )}

        <Composer streaming={streaming} voiceLang={settings.voiceLang} onError={setError} attach={attach}
          onSend={(t, atts) => run('send', { content: t, attachments: atts })} onStop={() => abortRef.current?.abort()} />
      </main>

      {showSettings && (
        <Settings settings={settings} setSettings={setSettings} providers={providers} modelsError={modelsError}
          theme={theme} setTheme={setTheme} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { X, Pencil, Trash2, Check, Plus } from 'lucide-react';
import { api } from '../api.js';

export default function Memory({ onClose, onChatsDeleted }) {
  const [items, setItems] = useState(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null); // { id, text }
  const [error, setError] = useState('');

  const load = () => api.memories().then(setItems).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const run = async (fn) => { setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Memory">
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-2xl bg-white p-5 shadow-xl dark:bg-ink-850" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Memory</h2>
          <button onClick={onClose} aria-label="Close memory" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-ink-700"><X size={18} /></button>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          Only things you explicitly ask me to remember are saved, for example "Remember that my name is Rajesh" or "yaad rakhna: main Faridabad mein rehta hoon". You can edit or delete anything here. What is listed here is saved on this computer and used in every chat; anything you say only inside a chat stays in that chat's history and is not memory. Passwords, PINs, API keys and card numbers are never saved.
        </p>

        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) run(async () => { await api.addMemory(draft.trim()); setDraft(''); }); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Add something to remember" aria-label="New memory"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800" />
          <button type="submit" disabled={!draft.trim()} className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"><Plus size={16} /> Add</button>
        </form>

        {error && <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}

        <div className="min-h-[4rem] flex-1 space-y-1 overflow-y-auto">
          {items === null && <p className="text-sm text-slate-500">Loading...</p>}
          {items?.length === 0 && <p className="text-sm text-slate-500">Nothing saved yet.</p>}
          {items?.map((m) => (
            <div key={m.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-ink-600">
              {editing?.id === m.id ? (
                <>
                  <input autoFocus value={editing.text} maxLength={500} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter' && editing.text.trim()) run(async () => { await api.updateMemory(m.id, editing.text.trim()); setEditing(null); }); if (e.key === 'Escape') setEditing(null); }}
                    className="min-w-0 flex-1 rounded border border-slate-300 bg-transparent px-2 py-1 dark:border-ink-600" aria-label="Edit memory" />
                  <button aria-label="Save" title="Save" className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-ink-700"
                    onClick={() => editing.text.trim() && run(async () => { await api.updateMemory(m.id, editing.text.trim()); setEditing(null); })}><Check size={15} /></button>
                </>
              ) : (
                <>
                  <p className="min-w-0 flex-1 break-words py-1">{m.text}</p>
                  <button aria-label="Edit memory" title="Edit" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-700" onClick={() => setEditing({ id: m.id, text: m.text })}><Pencil size={15} /></button>
                  <button aria-label="Delete memory" title="Delete" className="rounded p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950" onClick={() => run(() => api.deleteMemory(m.id))}><Trash2 size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>

        {items?.length > 0 && (
          <button className="mt-3 self-start text-sm text-red-600 hover:underline"
            onClick={() => { if (window.confirm('Delete ALL saved memories? This cannot be undone.')) run(() => api.clearMemories()); }}>Clear all memory</button>
        )}

        <div className="mt-4 border-t border-slate-200 pt-3 text-sm dark:border-ink-700">
          <p className="font-medium">Conversations</p>
          <p className="text-slate-500">Saved chats are listed in the sidebar, where you can delete them one by one. You can also delete all of them at once. Memories, projects and settings are kept.</p>
          <button className="mt-2 text-red-600 hover:underline"
            onClick={() => { if (window.confirm('Delete ALL conversations and their files? This cannot be undone. Your memories and settings are kept.')) run(async () => { await api.deleteAllChats(); onChatsDeleted?.(); }); }}>Delete all conversations</button>
        </div>
      </div>
    </div>
  );
}

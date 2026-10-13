import { useState } from 'react';
import { Plus, Search, Settings, PanelLeftClose, Pencil, Trash2, Download, FolderKanban, Sparkles, X } from 'lucide-react';
import { api } from '../api.js';

const row = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-left hover:bg-slate-200/60 dark:hover:bg-ink-700';

export default function Sidebar({ chats, activeId, query, setQuery, onNew, onSelect, onRename, onDelete, onSettings, onClose, open }) {
  const [menuFor, setMenuFor] = useState(null);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-slate-200 bg-slate-50 transition-transform dark:border-ink-700 dark:bg-ink-850 md:static ${
        open ? 'translate-x-0' : '-translate-x-full md:hidden'
      }`}
      aria-label="Sidebar"
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-800 text-marigold"><Sparkles size={16} /></span>
          Rajesh AI
        </div>
        <button onClick={onClose} aria-label="Close sidebar" title="Close sidebar"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-200/60 dark:hover:bg-ink-700"><PanelLeftClose size={18} /></button>
      </div>

      <div className="space-y-1 px-3 pt-2">
        <button onClick={onNew} className={`${row} bg-white font-medium shadow-sm dark:bg-ink-800`}><Plus size={18} /> New chat</button>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats"
            aria-label="Search chats"
            className="w-full rounded-lg border border-transparent bg-transparent py-2 pl-9 pr-8 text-sm outline-none placeholder:text-slate-400 hover:bg-slate-200/60 focus:border-brand-500 focus:bg-white dark:hover:bg-ink-700 dark:focus:bg-ink-800" />
          {query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400"><X size={14} /></button>}
        </div>
        <button disabled className={`${row} cursor-not-allowed opacity-50`} title="Projects arrive in a later phase">
          <FolderKanban size={18} /> Projects <span className="ml-auto text-xs">soon</span>
        </button>
      </div>

      <nav className="mt-3 flex-1 overflow-y-auto px-3 pb-3" aria-label="Chat history">
        <p className="px-3 pb-1 text-xs font-medium text-slate-500">History</p>
        {chats.length === 0 && (
          <p className="px-3 py-2 text-sm text-slate-500">{query ? 'No chats match your search.' : 'Your chats will appear here.'}</p>
        )}
        {chats.map((c) => (
          <div key={c.id} className="group relative">
            <button onClick={() => onSelect(c.id)}
              className={`${row} pr-20 ${c.id === activeId ? 'bg-slate-200/80 dark:bg-ink-700' : ''}`}>
              <span className="truncate">{c.title}</span>
            </button>
            <div className={`absolute right-1 top-1/2 flex -translate-y-1/2 items-center ${menuFor === c.id ? '' : 'md:hidden md:group-hover:flex md:group-focus-within:flex'}`}>
              <button aria-label="Rename chat" title="Rename" className="rounded p-1.5 text-slate-500 hover:bg-slate-300/60 dark:hover:bg-ink-600"
                onClick={() => { const t = window.prompt('Rename chat', c.title); if (t?.trim()) onRename(c.id, t.trim()); }}><Pencil size={14} /></button>
              <div className="relative">
                <button aria-label="Export chat" title="Export" className="rounded p-1.5 text-slate-500 hover:bg-slate-300/60 dark:hover:bg-ink-600"
                  onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}><Download size={14} /></button>
                {menuFor === c.id && (
                  <div className="absolute right-0 top-8 z-10 w-36 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-ink-600 dark:bg-ink-800">
                    <a className="block rounded px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-ink-700" href={api.exportUrl(c.id, 'md')} onClick={() => setMenuFor(null)}>Markdown</a>
                    <a className="block rounded px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-ink-700" href={api.exportUrl(c.id, 'json')} onClick={() => setMenuFor(null)}>JSON</a>
                  </div>
                )}
              </div>
              <button aria-label="Delete chat" title="Delete" className="rounded p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950"
                onClick={() => { if (window.confirm(`Delete "${c.title}"? This can't be undone.`)) onDelete(c.id); }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-3 dark:border-ink-700">
        <button onClick={onSettings} className={row}><Settings size={18} /> Settings</button>
      </div>
    </aside>
  );
}

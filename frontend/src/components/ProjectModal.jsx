import { useEffect, useState } from 'react';
import { X, Download, Trash2, FileText } from 'lucide-react';
import { api } from '../api.js';
import { formatSize } from '../fileTypes.js';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800';

function Files({ project, version }) {
  const [files, setFiles] = useState(null);
  const [open, setOpen] = useState(null); // { path, text }
  const [error, setError] = useState('');
  const load = () => api.projectFiles(project.id).then(setFiles).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [project.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-500">
        When you ask for a website, app or script in a chat of this project, a tool-capable model writes the files here. Files are plain text and can be downloaded as a zip.
      </p>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {files === null && <p className="text-slate-500">Loading...</p>}
      {files?.length === 0 && <p className="text-slate-500">No files yet.</p>}
      {files?.length > 0 && (
        <>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {files.map((f) => (
              <div key={f.path} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 dark:border-ink-600">
                <FileText size={14} className="flex-none text-slate-400" />
                <button className="min-w-0 flex-1 truncate text-left font-mono text-xs hover:underline" title="View"
                  onClick={() => api.projectFile(project.id, f.path).then((text) => setOpen({ path: f.path, text })).catch((e) => setError(e.message))}>{f.path}</button>
                <span className="text-xs text-slate-400">{formatSize(f.size)}</span>
                <button aria-label={`Delete ${f.path}`} title="Delete" className="rounded p-1 text-slate-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950"
                  onClick={() => { if (window.confirm(`Delete ${f.path}?`)) api.deleteProjectFile(project.id, f.path).then(() => { if (open?.path === f.path) setOpen(null); load(); }).catch((e) => setError(e.message)); }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <a href={api.projectDownloadUrl(project.id)} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-white hover:bg-brand-700"><Download size={16} /> Download all (.zip)</a>
        </>
      )}
      {open && (
        <div>
          <p className="mb-1 font-mono text-xs text-slate-500">{open.path}</p>
          <pre className="max-h-64 overflow-auto rounded-lg bg-[#0d1117] p-3 text-xs text-slate-200">{open.text}</pre>
        </div>
      )}
    </div>
  );
}

export default function ProjectModal({ project, filesVersion, initialTab = 'details', onClose, onSaved, onDeleted }) {
  const [tab, setTab] = useState(project ? initialTab : 'details');
  const [name, setName] = useState(project?.name || '');
  const [instructions, setInstructions] = useState(project?.instructions || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    try {
      const saved = project ? await api.updateProject(project.id, { name, instructions }) : await api.createProject({ name, instructions });
      onSaved(saved, !project);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Project">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-ink-850" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{project ? project.name : 'New project'}</h2>
          <button onClick={onClose} aria-label="Close project" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-ink-700"><X size={18} /></button>
        </div>

        {project && (
          <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-ink-700" role="tablist">
            {[['details', 'Details'], ['files', 'Files']].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand-500 font-medium' : 'border-transparent text-slate-500'}`}>{label}</button>
            ))}
          </div>
        )}

        {tab === 'files' && project ? <Files project={project} version={filesVersion} /> : (
          <div className="space-y-4 text-sm">
            <label className="block space-y-1.5">
              <span className="font-medium">Name</span>
              <input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shop website" autoFocus={!project} />
            </label>
            <label className="block space-y-1.5">
              <span className="font-medium">Instructions for every chat in this project</span>
              <textarea className={field} rows={6} value={instructions} maxLength={4000} onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. We are building a Hindi/English website for my sweet shop using plain HTML and CSS. Keep code simple and commented." />
            </label>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
            <div className="flex items-center justify-between">
              {project ? (
                <button className="text-red-600 hover:underline" onClick={() => {
                  if (window.confirm(`Delete project "${project.name}" and its files? Its chats are kept and moved to All chats.`)) api.deleteProject(project.id).then(() => onDeleted(project.id)).catch((e) => setError(e.message));
                }}>Delete project</button>
              ) : <span />}
              <button disabled={!name.trim() || busy} onClick={save} className="rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50">{project ? 'Save' : 'Create project'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

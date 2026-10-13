import { FileText, X, Loader2, AlertTriangle } from 'lucide-react';
import { fileUrl } from '../api.js';
import { formatSize } from '../fileTypes.js';

// Chip used for the files waiting in the composer
export function PendingChip({ item, onRemove }) {
  const warn = item.att?.meta?.warning;
  return (
    <div className={`relative flex items-center gap-2 rounded-xl border p-1.5 pr-8 text-xs ${
      item.status === 'error' ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950' : 'border-slate-200 dark:border-ink-600'}`}
      title={item.error || warn || item.name}>
      {item.previewUrl ? (
        <img src={item.previewUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-ink-700"><FileText size={18} /></span>
      )}
      <div className="max-w-[10rem] leading-tight">
        <p className="truncate font-medium">{item.name}</p>
        <p className={`truncate ${item.status === 'error' ? 'text-red-600 dark:text-red-300' : 'text-slate-500'}`}>
          {item.status === 'uploading' && 'Reading file...'}
          {item.status === 'error' && item.error}
          {item.status === 'ready' && (warn ? <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle size={11} /> {warn}</span> : formatSize(item.size))}
        </p>
      </div>
      {item.status === 'uploading' && <Loader2 size={16} className="absolute right-2 animate-spin text-slate-400" />}
      <button type="button" onClick={onRemove} aria-label={`Remove ${item.name}`}
        className={`absolute right-1.5 top-1.5 rounded-full p-0.5 hover:bg-slate-200 dark:hover:bg-ink-600 ${item.status === 'uploading' ? 'hidden' : ''}`}><X size={14} /></button>
    </div>
  );
}

// Files shown on a sent message
export function MessageAttachments({ attachments }) {
  if (!attachments?.length) return null;
  const images = attachments.filter((a) => a.kind === 'image');
  const docs = attachments.filter((a) => a.kind !== 'image');
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {images.map((a) => (
            <a key={a.id} href={fileUrl(a.url)} target="_blank" rel="noreferrer" title={a.name}>
              <img src={fileUrl(a.url)} alt={a.name} loading="lazy"
                className="max-h-64 max-w-full rounded-xl border border-slate-200 object-cover dark:border-ink-600 sm:max-w-xs" />
            </a>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {docs.map((a) => (
            <a key={a.id} href={fileUrl(a.url)} target="_blank" rel="noreferrer" download={a.name}
              className="flex items-center gap-2 rounded-xl border border-slate-200 p-2 text-xs hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-800">
              <FileText size={18} className="text-brand-600" />
              <span className="max-w-[12rem] leading-tight">
                <span className="block truncate font-medium">{a.name}</span>
                <span className="block text-slate-500">{formatSize(a.size)}{a.meta?.pages ? ` · ${a.meta.pages} pages` : ''}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

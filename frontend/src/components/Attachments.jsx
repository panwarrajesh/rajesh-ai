import { FileText, X, Loader2, AlertTriangle, Music, Film, Download } from 'lucide-react';
import { fileUrl } from '../api.js';
import { formatSize, formatDuration } from '../fileTypes.js';

const ext = (n) => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
const isAudio = (n) => ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(ext(n));
const isVideo = (n) => ['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(ext(n));

function statusLine(item) {
  if (item.status === 'uploading') return `Uploading${item.pct ? ` ${item.pct}%` : '...'}`;
  if (item.status === 'processing') {
    const p = item.att?.progress;
    return p ? `${p.stage} ${p.percent}%` : 'Processing...';
  }
  return null;
}

// Chip used for the files waiting in the composer
export function PendingChip({ item, onRemove }) {
  const warn = item.att?.meta?.warning;
  const thumb = item.previewUrl || (item.att?.thumbUrl ? fileUrl(item.att.thumbUrl) : null);
  const working = item.status === 'uploading' || item.status === 'processing';
  const Icon = isAudio(item.name) ? Music : isVideo(item.name) ? Film : FileText;
  return (
    <div className={`relative flex items-center gap-2 rounded-xl border p-1.5 pr-14 text-xs ${
      item.status === 'error' ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950' : 'border-slate-200 dark:border-ink-600'}`}
      title={item.error || warn || item.name}>
      {thumb ? (
        <img src={thumb} alt="" className="h-10 w-10 rounded-lg object-cover" />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-ink-700"><Icon size={18} /></span>
      )}
      <div className="max-w-[11rem] leading-tight">
        <p className="truncate font-medium">{item.name}</p>
        <p className={`truncate ${item.status === 'error' ? 'text-red-600 dark:text-red-300' : 'text-slate-500'}`}>
          {working && statusLine(item)}
          {item.status === 'error' && item.error}
          {item.status === 'ready' && (warn
            ? <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle size={11} /> {warn}</span>
            : [formatSize(item.size), item.att?.meta?.duration ? formatDuration(item.att.meta.duration) : null].filter(Boolean).join(' · '))}
        </p>
        {item.status === 'processing' && item.att?.progress && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded bg-slate-200 dark:bg-ink-600">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${item.att.progress.percent}%` }} />
          </div>
        )}
      </div>
      {working && <Loader2 size={16} className="absolute right-8 animate-spin text-slate-400" />}
      <button type="button" onClick={onRemove} aria-label={item.status === 'ready' ? `Remove ${item.name}` : `Cancel ${item.name}`}
        className="absolute right-1.5 top-1.5 rounded-full p-1 hover:bg-slate-200 dark:hover:bg-ink-600"><X size={14} /></button>
    </div>
  );
}

function MediaCard({ a }) {
  const dl = a.generated ? <a href={fileUrl(a.url)} download={a.name} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-800"><Download size={12} /> Download</a> : null;
  const m = a.meta || {};
  const sub = (fmt) => fileUrl(`/api/uploads/${a.id}/subtitles?format=${fmt}`);
  return (
    <div className="w-[28rem] max-w-full overflow-hidden rounded-xl border border-slate-200 text-left dark:border-ink-600">
      {a.kind === 'video' ? (
        <video controls preload="metadata" poster={a.thumbUrl ? fileUrl(a.thumbUrl) : undefined} src={fileUrl(a.url)}
          className="max-h-72 w-full bg-black" />
      ) : (
        <audio controls preload="metadata" src={fileUrl(a.url)} className="w-full" />
      )}
      <div className="space-y-1 p-2.5 text-xs">
        <p className="truncate font-medium">{a.name}</p>
        <p className="text-slate-500">
          {[m.duration ? formatDuration(m.duration) : null, m.width ? `${m.width}x${m.height}` : null, m.language?.code ? `speech: ${m.language.code}` : null, formatSize(a.size)]
            .filter(Boolean).join(' · ')}
        </p>
        {m.warning && <p className="flex items-start gap-1 text-amber-600"><AlertTriangle size={12} className="mt-0.5 flex-none" />{m.warning}</p>}
        {(m.segment_count > 0 || dl) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {dl}
            {m.segment_count > 0 && [['srt', 'Subtitles .srt'], ['vtt', 'Subtitles .vtt'], ['txt', 'Transcript .txt']].map(([f, label]) => (
              <a key={f} href={sub(f)} download
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-800">
                <Download size={12} /> {label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Files shown on a sent message
export function MessageAttachments({ attachments, align = 'end' }) {
  if (!attachments?.length) return null;
  const side = align === 'start' ? 'items-start justify-start' : 'items-end justify-end';
  const images = attachments.filter((a) => a.kind === 'image');
  const media = attachments.filter((a) => a.kind === 'video' || a.kind === 'audio');
  const docs = attachments.filter((a) => !['image', 'video', 'audio'].includes(a.kind));
  return (
    <div className={`mt-2 flex max-w-[85%] flex-col gap-2 ${align === 'start' ? 'items-start' : 'items-end'}`}>
      {images.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${side}`}>
          {images.map((a) => (
            <div key={a.id} className="relative">
              <a href={fileUrl(a.url)} target="_blank" rel="noreferrer" title={a.name}>
                <img src={fileUrl(a.url)} alt={a.name} loading="lazy"
                  className={`max-w-full rounded-xl border border-slate-200 object-cover dark:border-ink-600 ${a.generated ? 'max-h-96 sm:max-w-md' : 'max-h-64 sm:max-w-xs'}`} />
              </a>
              {a.generated && (
                <a href={fileUrl(a.url)} download={a.name} aria-label={`Download ${a.name}`} title="Download"
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"><Download size={14} /></a>
              )}
            </div>
          ))}
        </div>
      )}
      {media.map((a) => <MediaCard key={a.id} a={a} />)}
      {docs.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${side}`}>
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

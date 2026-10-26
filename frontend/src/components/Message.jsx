import { useState } from 'react';
import { RefreshCw, Pencil, Volume2, VolumeX, ChevronsRight, Sparkles, Wrench, Loader2 } from 'lucide-react';
import Markdown, { CopyButton } from './Markdown.jsx';
import { MessageAttachments } from './Attachments.jsx';

const actionBtn =
  'flex items-center gap-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-ink-700 dark:hover:text-slate-100 disabled:opacity-40';

const LABEL = {
  calculator: 'Calculator', get_current_datetime: 'Date and time', remember: 'Memory', list_memories: 'Memory',
  forget_memory: 'Memory', search_attached_files: 'Searched your files', get_transcript_range: 'Read transcript',
  list_project_files: 'Project files', read_project_file: 'Read file', write_project_file: 'Wrote file', delete_project_file: 'Deleted file',
  generate_image: 'Created image', edit_image: 'Edited image', transform_image: 'Edited image', edit_video: 'Edited video',
};

function ToolActivity({ tools }) {
  if (!tools?.length) return null;
  return (
    <div className="mb-2 space-y-1" aria-label="Tool activity">
      {tools.map((t) => (
        <div key={t.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
          t.ok === false ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300' : 'border-slate-200 text-slate-600 dark:border-ink-600 dark:text-slate-300'}`}>
          {t.status === 'running' ? <Loader2 size={13} className="mt-0.5 flex-none animate-spin" /> : <Wrench size={13} className="mt-0.5 flex-none" />}
          <span className="min-w-0 break-words"><b>{LABEL[t.name] || t.name}</b>{t.summary ? ` · ${t.summary}` : t.status === 'running' ? ' · working...' : ''}</span>
        </div>
      ))}
    </div>
  );
}

function Typing() {
  return (
    <div className="flex gap-1.5 py-2" role="status" aria-label="Rajesh AI is thinking">
      <span className="dot h-2 w-2 rounded-full bg-slate-400" />
      <span className="dot h-2 w-2 rounded-full bg-slate-400" />
      <span className="dot h-2 w-2 rounded-full bg-slate-400" />
    </div>
  );
}

export default function Message({ msg, isLast, streaming, speaking, onSpeak, onRegenerate, onContinue, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const isUser = msg.role === 'user';
  const live = streaming && isLast && !isUser;
  const showActions = !live && msg.content;
  const vis = isLast ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100';

  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-1">
        <MessageAttachments attachments={msg.attachments} />
        {editing ? (
          <div className="w-full max-w-[85%] rounded-2xl border border-slate-300 dark:border-ink-600 p-2">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(8, draft.split('\n').length + 1)}
              className="w-full resize-none bg-transparent p-2 outline-none" autoFocus />
            <div className="flex justify-end gap-2 p-1">
              <button onClick={() => { setEditing(false); setDraft(msg.content); }}
                className="rounded-lg px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-ink-700">Cancel</button>
              <button disabled={!draft.trim()} onClick={() => { setEditing(false); onEdit(msg.id, draft.trim()); }}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50">Save and resend</button>
            </div>
          </div>
        ) : (
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-slate-100 px-4 py-2.5 text-[15px] leading-7 dark:bg-ink-700">
            {msg.content}
          </div>
        )}
        {!editing && !streaming && (
          <div className={`flex ${vis}`}>
            <CopyButton text={msg.content} className={actionBtn} />
            <button className={actionBtn} onClick={() => setEditing(true)} aria-label="Edit message" title="Edit"><Pencil size={15} /></button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group flex gap-3">
      <div className="mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink-800 text-marigold">
        <Sparkles size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <ToolActivity tools={msg.tools} />
        {msg.content ? (
          <div className={live ? 'caret' : ''}><Markdown>{msg.content}</Markdown></div>
        ) : live ? <Typing /> : null}
        <MessageAttachments attachments={msg.attachments} align="start" />
        {showActions && (
          <div className={`mt-1 flex -ml-1.5 ${vis}`}>
            <CopyButton text={msg.content} className={actionBtn} />
            <button className={actionBtn} onClick={() => onSpeak(msg)} aria-label={speaking ? 'Stop reading' : 'Read aloud'} title="Read aloud">
              {speaking ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            {isLast && (
              <>
                <button className={actionBtn} onClick={onRegenerate} aria-label="Regenerate" title="Regenerate"><RefreshCw size={15} /></button>
                <button className={actionBtn} onClick={onContinue} aria-label="Continue" title="Continue"><ChevronsRight size={15} /></button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

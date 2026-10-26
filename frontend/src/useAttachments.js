import { useCallback, useRef, useState } from 'react';
import { api } from './api.js';
import { MAX_FILES } from './fileTypes.js';

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Pending files for the next message.
// Lifecycle: uploading -> (processing, for audio/video) -> ready | error
export function useAttachments(onError) {
  const [items, setItems] = useState([]);
  const countRef = useRef(0);
  const alive = useRef(new Set());        // keys still in the composer (stops polling when removed)
  const controllers = useRef(new Map());  // key -> AbortController for in-flight uploads

  const patch = useCallback((key, p) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...p } : i))), []);

  const poll = useCallback((key, id) => {
    const tick = async () => {
      if (!alive.current.has(key)) return;
      try {
        const a = await api.getUpload(id);
        if (!alive.current.has(key)) return;
        if (a.status === 'processing') { patch(key, { att: a }); setTimeout(tick, 1500); }
        else if (a.status === 'failed') patch(key, { status: 'error', error: a.error || 'Processing failed.', att: a });
        else patch(key, { status: 'ready', att: a });
      } catch (e) { patch(key, { status: 'error', error: e.message }); }
    };
    setTimeout(tick, 1500);
  }, [patch]);

  const add = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const room = MAX_FILES - countRef.current;
    if (files.length > room) onError(`You can attach up to ${MAX_FILES} files per message.`);
    for (const file of files.slice(0, Math.max(room, 0))) {
      const key = uid();
      countRef.current++;
      alive.current.add(key);
      const ac = new AbortController();
      controllers.current.set(key, ac);
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setItems((prev) => [...prev, { key, name: file.name || 'pasted-image.png', size: file.size, previewUrl, status: 'uploading', pct: 0 }]);
      api.upload(file, { signal: ac.signal, onProgress: (f) => patch(key, { pct: Math.round(f * 100) }) })
        .then((att) => {
          if (!alive.current.has(key)) { api.deleteUpload(att.id).catch(() => {}); return; }
          if (att.status === 'processing') { patch(key, { status: 'processing', att }); poll(key, att.id); }
          else patch(key, { status: 'ready', att });
        })
        .catch((e) => { if (e.name !== 'AbortError') patch(key, { status: 'error', error: e.message }); })
        .finally(() => controllers.current.delete(key));
    }
  }, [onError, patch, poll]);

  const remove = useCallback((key) => {
    alive.current.delete(key);
    controllers.current.get(key)?.abort();
    setItems((prev) => {
      const it = prev.find((i) => i.key === key);
      if (it?.att) api.deleteUpload(it.att.id).catch(() => {}); // also cancels server-side processing
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return prev.filter((i) => i.key !== key);
    });
    countRef.current = Math.max(0, countRef.current - 1);
  }, []);

  // after a successful send the files belong to the message, so just forget them locally
  const clear = useCallback(() => {
    alive.current.clear();
    setItems((prev) => { prev.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl)); return []; });
    countRef.current = 0;
  }, []);

  const ready = items.filter((i) => i.status === 'ready').map((i) => i.att);
  const busy = items.some((i) => i.status === 'uploading' || i.status === 'processing');
  return { items, add, remove, clear, ready, busy };
}

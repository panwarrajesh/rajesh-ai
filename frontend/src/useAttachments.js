import { useCallback, useRef, useState } from 'react';
import { api } from './api.js';
import { MAX_FILES } from './fileTypes.js';

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Pending files for the next message: uploads start immediately and can be removed before sending.
export function useAttachments(onError) {
  const [items, setItems] = useState([]);
  const countRef = useRef(0);

  const patch = (key, p) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const add = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const room = MAX_FILES - countRef.current;
    if (files.length > room) onError(`You can attach up to ${MAX_FILES} files per message.`);
    for (const file of files.slice(0, Math.max(room, 0))) {
      const key = uid();
      countRef.current++;
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setItems((prev) => [...prev, { key, name: file.name || 'pasted-image.png', size: file.size, previewUrl, status: 'uploading' }]);
      api.upload(file)
        .then((att) => patch(key, { status: 'ready', att }))
        .catch((e) => patch(key, { status: 'error', error: e.message }));
    }
  }, [onError]);

  const remove = useCallback((key) => {
    setItems((prev) => {
      const it = prev.find((i) => i.key === key);
      if (it?.att) api.deleteUpload(it.att.id).catch(() => {});
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return prev.filter((i) => i.key !== key);
    });
    countRef.current = Math.max(0, countRef.current - 1);
  }, []);

  // after a successful send the files belong to the message, so just forget them locally
  const clear = useCallback(() => {
    setItems((prev) => { prev.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl)); return []; });
    countRef.current = 0;
  }, []);

  const ready = items.filter((i) => i.status === 'ready').map((i) => i.att);
  const busy = items.some((i) => i.status === 'uploading');
  return { items, add, remove, clear, ready, busy };
}

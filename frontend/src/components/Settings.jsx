import { X, Sun, Moon } from 'lucide-react';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800';

export default function Settings({ settings, setSettings, providers, modelsError, theme, setTheme, onClose, caps }) {
  const provider = providers.find((p) => p.id === settings.provider);
  const models = provider?.models || [];
  const current = models.find((m) => m.id === settings.model);

  function pickProvider(id) {
    const p = providers.find((x) => x.id === id);
    setSettings({ ...settings, provider: id, model: p?.models[0]?.id || '' });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-ink-850" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} aria-label="Close settings" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-ink-700"><X size={18} /></button>
        </div>

        <div className="space-y-5 text-sm">
          {modelsError && <p className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{modelsError}</p>}

          <label className="block space-y-1.5">
            <span className="font-medium">AI provider</span>
            <select className={field} value={settings.provider} onChange={(e) => pickProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.label}{p.experimental ? ' ⚠' : ''}{p.available ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
            {providers.filter((p) => !p.available).map((p) => (
              <p key={p.id} className="text-xs text-slate-500"><b>{p.label}:</b> {p.error}</p>
            ))}
          </label>

          <label className="block space-y-1.5">
            <span className="font-medium">Model</span>
            <select className={field} value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {current && (
              <p className="text-xs text-slate-500">
                Image input: {current.capabilities.vision ? 'supported (the model sees the picture)' : 'not supported (only OCR text is used)'} · Tools: {current.capabilities.tools ? 'supported' : 'not supported'}
              </p>
            )}
            {provider?.experimental && (
              <p className="text-xs text-amber-700 dark:text-amber-300">Experimental: a small custom model will be far less capable than modern pretrained LLMs.</p>
            )}
          </label>

          <label className="block space-y-1.5">
            <span className="font-medium">Creativity: {settings.temperature.toFixed(1)}</span>
            <input type="range" min="0" max="1.5" step="0.1" value={settings.temperature} className="w-full accent-brand-600"
              onChange={(e) => setSettings({ ...settings, temperature: Number(e.target.value) })} />
            <span className="block text-xs text-slate-500">Lower is more focused and factual. Higher is more varied.</span>
          </label>

          {[['useMemory', 'Use memory', 'Send the facts you asked me to remember along with your messages.'],
            ['useTools', 'Use tools', 'Let the model use the calculator, date/time, memory, your attached files and project files. Needs a tool-capable model.']].map(([key, label, help]) => (
            <label key={key} className="flex items-start justify-between gap-3">
              <span><span className="block font-medium">{label}</span><span className="block text-xs text-slate-500">{help}</span></span>
              <input type="checkbox" className="mt-1 h-4 w-4 flex-none accent-brand-600" checked={settings[key] !== false}
                onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })} />
            </label>
          ))}

          <label className="block space-y-1.5">
            <span className="font-medium">Voice language (input and read-aloud)</span>
            <select className={field} value={settings.voiceLang} onChange={(e) => setSettings({ ...settings, voiceLang: e.target.value })}>
              <option value="en-IN">English (India)</option>
              <option value="hi-IN">हिन्दी (Hindi)</option>
              <option value="en-US">English (US)</option>
            </select>
          </label>

          <div className="space-y-1">
            <span className="font-medium">Image generation</span>
            {!caps ? <p className="text-xs text-slate-500">Checking...</p> : caps.image?.available ? (
              <p className="text-xs text-slate-500">Connected: {caps.image.model} ({caps.image.provider}). Try <code>/image a red kite</code>. {caps.image.can_edit ? 'AI editing works too (/edit).' : 'This model can create but not edit pictures.'}</p>
            ) : (
              <p className="text-xs text-slate-500">{caps.image?.message || 'Not configured.'} Simple edits (/img) and video edits (/video) still work.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="font-medium">Theme</span>
            <div className="grid grid-cols-2 gap-2">
              {[['light', 'Light', Sun], ['dark', 'Dark', Moon]].map(([v, label, Icon]) => (
                <button key={v} onClick={() => setTheme(v)} aria-pressed={theme === v}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 ${theme === v ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-ink-700 dark:text-brand-500' : 'border-slate-300 dark:border-ink-600'}`}>
                  <Icon size={16} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

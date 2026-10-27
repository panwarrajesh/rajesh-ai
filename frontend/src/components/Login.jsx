import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { api } from '../api.js';

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true); setError('');
    try { await api.login(password); onSuccess(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <main className="flex h-dvh items-center justify-center bg-slate-50 p-4 dark:bg-ink-900">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-ink-700 dark:bg-ink-850">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-800 text-marigold"><Sparkles size={22} /></span>
          <h1 className="text-xl font-semibold">Rajesh AI</h1>
          <p className="text-sm text-slate-500">Enter your password to continue.</p>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Password</span>
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-ink-600 dark:bg-ink-800" />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
        <button type="submit" disabled={!password || busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy && <Loader2 size={16} className="animate-spin" />} Log in
        </button>
      </form>
    </main>
  );
}

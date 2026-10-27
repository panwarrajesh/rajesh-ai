import { parseSSE } from './sse.js';
import { aiFetch } from './ai.js';

const MAX_ROUNDS = Number(process.env.MAX_TOOL_ROUNDS || 5);

// Keep stored tool arguments small (file contents can be huge).
const shortArgs = (a) =>
  Object.fromEntries(Object.entries(a || {}).map(([k, v]) => [k, typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + `... (${v.length} chars)` : v]));

/**
 * Stream an answer, running tools the model asks for (multi-round).
 * Returns { acc, toolLog, errMsg }. Throws only for transport failures (caller maps them).
 */
export async function runGeneration({ signal, send, provider, model, temperature, system, history, toolkit }) {
  const messages = [{ role: 'system', content: system }, ...history];
  const toolLog = [];
  const seenNotices = new Set();
  let acc = '';

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const useTools = toolkit.defs.length > 0 && round < MAX_ROUNDS; // last round must answer in text
    const upstream = await aiFetch('/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ provider, model, temperature, messages, tools: useTools ? toolkit.defs : undefined }),
    });
    if (!upstream.ok) throw new Error(`AI service returned ${upstream.status}`);

    let roundText = '';
    let calls = null;
    for await (const ev of parseSSE(upstream.body)) {
      if (ev.type === 'token') {
        if (!roundText && acc) { acc += '\n\n'; send({ type: 'token', content: '\n\n' }); }
        roundText += ev.content;
        acc += ev.content;
        send(ev);
      } else if (ev.type === 'notice') {
        if (!seenNotices.has(ev.message)) { seenNotices.add(ev.message); send(ev); }
      } else if (ev.type === 'tool_calls') {
        calls = ev.calls;
      } else if (ev.type === 'error') {
        return { acc, toolLog, errMsg: ev.message };
      } else if (ev.type === 'done') {
        break;
      }
    }
    if (!calls?.length) break;

    messages.push({ role: 'assistant', content: roundText, tool_calls: calls });
    for (const c of calls) {
      const uid = `${round}-${c.id}`;
      const args = shortArgs(c.arguments);
      send({ type: 'tool', id: uid, name: c.name, arguments: args, status: 'running' });
      const r = await toolkit.run(c.name, c.arguments);
      toolLog.push({ id: uid, name: c.name, arguments: args, ok: r.ok, summary: r.display });
      send({ type: 'tool', id: uid, name: c.name, arguments: args, status: 'done', ok: r.ok, summary: r.display });
      messages.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: r.text });
      if (signal.aborted) return { acc, toolLog, errMsg: null };
    }
  }
  return { acc, toolLog, errMsg: null };
}

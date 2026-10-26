// Parse a Server-Sent-Events byte stream into JSON objects.
export async function* parseSSE(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try { yield JSON.parse(line.slice(5).trim()); } catch { /* ignore bad frame */ }
      }
    }
  }
}

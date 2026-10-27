// Small in-memory fixed-window rate limiter (enough for a personal server; use a shared store if you ever scale out).
const buckets = new Map();

export function limiter(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.count++;
    if (b.count > max) {
      const secs = Math.ceil((b.reset - now) / 1000);
      res.setHeader('Retry-After', String(secs));
      return res.status(429).json({ error: `Too many requests. Please try again in ${secs} seconds.` });
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 60000).unref();

// Safe calculator: a small parser, never eval().
const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp, min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_]\w*)|(\*\*|[-+*/^%(),×÷]))/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(i))) break; throw new Error(`Unexpected character "${src.slice(i).trim()[0]}"`); }
    i = re.lastIndex;
    if (m[1] !== undefined) toks.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) toks.push({ t: 'id', v: m[2].toLowerCase() });
    else toks.push({ t: 'op', v: m[3] === '×' ? '*' : m[3] === '÷' ? '/' : m[3] === '**' ? '^' : m[3] });
  }
  return toks;
}

export function calculate(expression) {
  const src = String(expression ?? '').replace(/,(?=\d{3}\b)/g, ''); // 1,000 -> 1000
  if (!src.trim()) throw new Error('Empty expression');
  if (src.length > 200) throw new Error('Expression too long');
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;
  const need = (v) => { if (!isOp(v)) throw new Error(`Expected "${v}"`); pos++; };

  function expr(depth) {
    if (depth > 50) throw new Error('Expression too deeply nested');
    let v = term(depth);
    while (isOp('+') || isOp('-')) { const op = toks[pos++].v; const r = term(depth); v = op === '+' ? v + r : v - r; }
    return v;
  }
  function term(depth) {
    let v = unary(depth);
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = toks[pos++].v; const r = unary(depth);
      if ((op === '/' || op === '%') && r === 0) throw new Error('Division by zero');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function unary(depth) {
    if (isOp('-')) { pos++; return -unary(depth); }
    if (isOp('+')) { pos++; return unary(depth); }
    return power(depth);
  }
  function power(depth) {
    const base = atom(depth);
    if (isOp('^')) { pos++; return Math.pow(base, unary(depth)); } // right-associative
    return base;
  }
  function atom(depth) {
    const tk = toks[pos++];
    if (!tk) throw new Error('Unexpected end of expression');
    if (tk.t === 'num') return tk.v;
    if (tk.t === 'id') {
      if (isOp('(')) {
        pos++;
        const args = [];
        if (!isOp(')')) { do { args.push(expr(depth + 1)); } while (isOp(',') && ++pos); }
        need(')');
        const f = Object.hasOwn(FUNCS, tk.v) ? FUNCS[tk.v] : null;
        if (!f) throw new Error(`Unknown function "${tk.v}"`);
        return f(...args);
      }
      if (Object.hasOwn(CONSTS, tk.v)) return CONSTS[tk.v];
      throw new Error(`Unknown name "${tk.v}"`);
    }
    if (tk.v === '(') { const v = expr(depth + 1); need(')'); return v; }
    throw new Error(`Unexpected "${tk.v}"`);
  }

  const result = expr(0);
  if (pos < toks.length) throw new Error(`Unexpected "${toks[pos].v}"`);
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return Number(result.toPrecision(15));
}

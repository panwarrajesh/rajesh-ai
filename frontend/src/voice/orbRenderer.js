// The AI orb: a pure canvas drawing function, so it can be rendered and checked outside React.
const PALETTE = {
  idle: { a: [20, 163, 154], b: [109, 91, 208] },
  listening: { a: [59, 130, 246], b: [34, 211, 238] },
  thinking: { a: [139, 92, 246], b: [236, 72, 153] },
  speaking: { a: [20, 163, 154], b: [242, 169, 0] },
};
const WHITE = [255, 255, 255];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (c, d, t) => c.map((v, i) => v + (d[i] - v) * t);
const frac = (x) => x - Math.floor(x);

// fixed "random" particles, so the orb looks the same every time
const PARTICLES = Array.from({ length: 42 }, (_, i) => {
  const r1 = frac(Math.sin(i * 12.9898) * 43758.5453);
  const r2 = frac(Math.sin(i * 78.233) * 12345.6789);
  const r3 = frac(Math.sin(i * 39.346) * 9876.5432);
  return { ang: r1 * Math.PI * 2, rad: 1.25 + r2 * 0.8, spd: (0.05 + r3 * 0.12) * (i % 2 ? 1 : -1), size: 0.7 + r3 * 1.8, ph: r2 * 6.28 };
});

const SPEED = { idle: 0.35, listening: 0.8, thinking: 1.8, speaking: 1.1 };

export function drawOrb(ctx, { w, h, t, state, level, reduce }) {
  const pal = PALETTE[state] || PALETTE.idle;
  const { a, b } = pal;
  const tt = reduce ? 0 : t;
  const lv = Math.min(1, Math.max(0, level || 0));
  ctx.clearRect(0, 0, w, h);

  const R0 = Math.min(w, h) * 0.27;
  const cx = w / 2;
  const cy = h / 2 + (reduce ? 0 : Math.sin(tt * 0.9) * R0 * 0.05); // slow float
  let scale = 1 + Math.sin(tt * 0.8) * 0.015;
  if (state === 'listening') scale = 1 + lv * 0.1 + Math.sin(tt * 2.2) * 0.008;
  else if (state === 'thinking') scale = 1 + Math.sin(tt * 1.6) * 0.02;
  else if (state === 'speaking') scale = 1 + lv * 0.16 + Math.sin(tt * 3) * 0.008; // expands with each spoken word
  const R = R0 * scale;

  // 1. outer glow
  let g = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 2.1);
  g.addColorStop(0, rgba(a, 0.38 + lv * 0.25));
  g.addColorStop(0.45, rgba(b, 0.12 + lv * 0.08));
  g.addColorStop(1, rgba(b, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 2. particles
  const pMul = state === 'thinking' ? 3 : state === 'speaking' ? 1.8 : state === 'listening' ? 1.3 : 1;
  for (const p of PARTICLES) {
    const ang = p.ang + tt * p.spd * pMul;
    const rad = R0 * p.rad * (1 + (state === 'speaking' ? lv * 0.12 : 0));
    const tw = 0.5 + 0.5 * Math.sin(tt * 1.5 + p.ph);
    const alpha = (0.2 + 0.5 * tw) * (state === 'idle' ? 0.6 : 1);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.92, p.size * (R0 / 90), 0, Math.PI * 2);
    ctx.fillStyle = rgba(mix(a, WHITE, 0.55), alpha);
    ctx.shadowColor = rgba(b, 0.9);
    ctx.shadowBlur = 6;
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // 3. expanding sound-wave rings (listening) / speech pulses (speaking) / faint ring (idle)
  if (state === 'listening') {
    for (let i = 0; i < 3; i++) {
      const ph = (tt * 0.7 + i / 3) % 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1.05 + ph * 0.55), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(b, (1 - ph) * (0.18 + lv * 0.4));
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  } else if (state === 'speaking') {
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1.1 + i * 0.12 + lv * 0.16), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(i ? b : a, 0.34 - i * 0.14);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  } else if (state === 'idle') {
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.1, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(a, 0.14);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 4. sphere body: lit from the upper left, darker at the far edge (gives the 3D look)
  g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.05);
  g.addColorStop(0, rgba(mix(a, WHITE, 0.78), 1));
  g.addColorStop(0.25, rgba(mix(a, WHITE, 0.25), 1));
  g.addColorStop(0.62, rgba(a, 1));
  g.addColorStop(1, rgba(mix(b, [10, 12, 30], 0.55), 1));
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // 5. liquid light inside the sphere
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const sp = SPEED[state] || 0.35;
  for (let i = 0; i < 3; i++) {
    const bx = cx + Math.cos(tt * sp * (0.7 + i * 0.35) + i * 2.1) * R * 0.45;
    const by = cy + Math.sin(tt * sp * (0.9 + i * 0.25) + i * 1.3) * R * 0.45;
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, R * 0.8);
    bg.addColorStop(0, rgba(i % 2 ? a : b, 0.5));
    bg.addColorStop(1, rgba(b, 0));
    ctx.fillStyle = bg;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  vg.addColorStop(0, 'rgba(5,8,25,0)');
  vg.addColorStop(1, 'rgba(5,8,25,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();

  // 6. thinking: a light that orbits the edge
  if (state === 'thinking') {
    ctx.lineCap = 'round';
    for (let k = 0; k < 26; k++) {
      const ang = tt * 2.4 - k * 0.07;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.03, ang, ang + 0.1);
      ctx.strokeStyle = rgba(mix(b, WHITE, 0.6), (1 - k / 26) * 0.95);
      ctx.lineWidth = Math.max(2, R * 0.035) * (1 - k / 40);
      ctx.shadowColor = rgba(b, 1);
      ctx.shadowBlur = 14;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // 7. glowing rim
  const rg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  rg.addColorStop(0, 'rgba(255,255,255,0.75)');
  rg.addColorStop(0.5, rgba(a, 0.35));
  rg.addColorStop(1, rgba(b, 0.55));
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = rg;
  ctx.lineWidth = Math.max(1.5, R * 0.014);
  ctx.shadowColor = rgba(a, 0.95);
  ctx.shadowBlur = R * 0.14;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 8. listening: a wavy ring that follows the voice
  if (state === 'listening') {
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const ang = (i / 120) * Math.PI * 2;
      const wob = (Math.sin(ang * 7 + tt * 5) * 0.5 + Math.sin(ang * 13 - tt * 3) * 0.5) * R * 0.055 * (0.25 + lv * 1.7);
      const r = R * 1.14 + wob;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgba(b, 0.85);
    ctx.lineWidth = 2.2;
    ctx.shadowColor = rgba(b, 1);
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // 9. soft highlight
  ctx.save();
  ctx.translate(cx - R * 0.36, cy - R * 0.42);
  ctx.scale(1, 0.7);
  const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.42);
  hg.addColorStop(0, 'rgba(255,255,255,0.6)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

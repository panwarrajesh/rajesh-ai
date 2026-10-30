import { useEffect, useRef } from 'react';
import { drawOrb } from './orbRenderer.js';

// state: 'idle' | 'listening' | 'thinking' | 'speaking'.  levelRef.current (0..1) is the live sound level.
export default function Orb({ state, levelRef }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    const ctx = el.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let size = 300;
    let raf = 0;
    let smooth = 0;
    const t0 = performance.now();

    const resize = () => {
      size = Math.max(160, Math.min(box.clientWidth, box.clientHeight || box.clientWidth));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = size * dpr;
      el.height = size * dpr;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    const frame = (now) => {
      const target = levelRef?.current || 0;
      if (levelRef) levelRef.current = target * 0.9; // pulses fade out on their own
      smooth += (target - smooth) * 0.25;
      drawOrb(ctx, { w: size, h: size, t: (now - t0) / 1000, state: stateRef.current, level: smooth, reduce });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [levelRef]);

  return (
    <div ref={wrap} className="flex aspect-square w-full items-center justify-center">
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}

// Rotary knob: drag up/down (Shift = fine), mouse wheel, double-click to reset,
// arrow keys when focused. Shows its value while being adjusted.

import { h } from './dom';

export interface KnobOptions {
  label: string;
  min: number;
  max: number;
  get: () => number;
  set: (v: number) => void;
  def?: number;
  curve?: 'lin' | 'log';
  step?: number;
  format?: (v: number) => string;
  bipolar?: boolean;
  size?: 'sm' | 'md';
  onCommit?: () => void;
  title?: string;
}

export type Knob = HTMLDivElement & { refresh(): void };

const ARC = 270;

export function knob(o: KnobOptions): Knob {
  const curve = o.curve ?? 'lin';
  const def = o.def ?? o.get();
  const fmt = o.format ?? ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)));

  const toNorm = (v: number) =>
    curve === 'log' ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min);
  const fromNorm = (n: number) => {
    n = Math.min(1, Math.max(0, n));
    let v = curve === 'log' ? o.min * Math.pow(o.max / o.min, n) : o.min + n * (o.max - o.min);
    if (o.step) v = Math.round(v / o.step) * o.step;
    return Math.min(o.max, Math.max(o.min, v));
  };

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  const track = document.createElementNS(ns, 'path');
  track.setAttribute('class', 'k-track');
  const fill = document.createElementNS(ns, 'path');
  fill.setAttribute('class', 'k-fill');
  const cap = document.createElementNS(ns, 'circle');
  cap.setAttribute('cx', '20');
  cap.setAttribute('cy', '20');
  cap.setAttribute('r', '11.5');
  cap.setAttribute('class', 'k-cap');
  const ptr = document.createElementNS(ns, 'line');
  ptr.setAttribute('class', 'k-ptr');
  svg.append(track, fill, cap, ptr);
  track.setAttribute('d', arcPath(0, 1));

  const valueEl = h('div', { class: 'k-val' });
  const el = h(
    'div',
    {
      class: `knob ${o.size === 'sm' ? 'sm' : ''}`,
      tabindex: 0,
      role: 'slider',
      'aria-label': o.label,
      'aria-valuemin': o.min,
      'aria-valuemax': o.max,
      title: o.title ?? `${o.label} — drag, wheel or double-click to reset`,
    },
    svg,
    h('div', { class: 'k-label' }, o.label),
    valueEl,
  ) as Knob;

  el.refresh = () => {
    const v = o.get();
    const n = Math.min(1, Math.max(0, toNorm(v)));
    const start = o.bipolar ? toNorm(0) : 0;
    fill.setAttribute('d', n >= start ? arcPath(start, n) : arcPath(n, start));
    const ang = ((-ARC / 2 + n * ARC) * Math.PI) / 180;
    ptr.setAttribute('x1', String(20 + Math.sin(ang) * 4));
    ptr.setAttribute('y1', String(20 - Math.cos(ang) * 4));
    ptr.setAttribute('x2', String(20 + Math.sin(ang) * 10));
    ptr.setAttribute('y2', String(20 - Math.cos(ang) * 10));
    valueEl.textContent = fmt(v);
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', fmt(v));
  };

  const setNorm = (n: number) => {
    const v = fromNorm(n);
    if (v !== o.get()) {
      o.set(v);
      el.refresh();
    }
  };

  let dragStartY = 0;
  let dragStartN = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus();
    el.setPointerCapture(e.pointerId);
    el.classList.add('active');
    dragStartY = e.clientY;
    dragStartN = toNorm(o.get());
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const range = e.shiftKey ? 900 : 180;
    const n = dragStartN + (dragStartY - e.clientY) / range;
    if (e.shiftKey) {
      dragStartN = n;
      dragStartY = e.clientY;
    }
    setNorm(n);
  });
  const end = (e: PointerEvent) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    el.releasePointerCapture(e.pointerId);
    el.classList.remove('active');
    o.onCommit?.();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => {
    o.set(def);
    el.refresh();
    o.onCommit?.();
  });
  let wheelTimer: number | null = null;
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const stepN = o.step ? o.step / (o.max - o.min) : 0.01;
      const dir = e.deltaY < 0 ? 1 : -1;
      const v0 = o.get();
      setNorm(toNorm(v0) + dir * Math.max(stepN, e.shiftKey ? 0.002 : 0.01));
      if (o.step && o.get() === v0) setNorm(toNorm(v0) + dir * stepN * 1.01);
      if (wheelTimer !== null) clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => o.onCommit?.(), 350);
    },
    { passive: false },
  );
  el.addEventListener('keydown', (e) => {
    const stepN = o.step ? o.step / (o.max - o.min) : e.shiftKey ? 0.002 : 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setNorm(toNorm(o.get()) + stepN);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setNorm(toNorm(o.get()) - stepN);
    else return;
    e.preventDefault();
    e.stopPropagation();
    o.onCommit?.();
  });

  el.refresh();
  return el;
}

function arcPath(n0: number, n1: number): string {
  const r = 16;
  const a0 = ((-ARC / 2 + n0 * ARC) * Math.PI) / 180;
  const a1 = ((-ARC / 2 + n1 * ARC) * Math.PI) / 180;
  const x0 = 20 + Math.sin(a0) * r;
  const y0 = 20 - Math.cos(a0) * r;
  const x1 = 20 + Math.sin(a1) * r;
  const y1 = 20 - Math.cos(a1) * r;
  const large = (n1 - n0) * ARC > 180 ? 1 : 0;
  if (Math.abs(n1 - n0) < 1e-4) return `M${x0} ${y0}`;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// Common value formatters
export const fmt = {
  pct: (v: number) => `${Math.round(v * 100)}%`,
  hz: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : `${Math.round(v)}`),
  sec: (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  db: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  int: (v: number) => `${Math.round(v)}`,
  signed: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
  cents: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} ct`,
  oct: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`,
  pan: (v: number) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
  q: (v: number) => v.toFixed(1),
};

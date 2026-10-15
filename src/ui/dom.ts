// Tiny DOM helpers and shared form controls.

type Attrs = Record<string, unknown> & { class?: string; style?: string };
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'style') {
      el.setAttribute('style', String(v));
    } else if (k in el && typeof v !== 'string') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function select<T extends string>(
  options: (T | [T, string])[],
  value: () => T,
  onChange: (v: T) => void,
  attrs: Attrs = {},
): HTMLSelectElement & { refresh(): void } {
  const el = h('select', { class: 'sel', ...attrs }) as HTMLSelectElement & { refresh(): void };
  for (const o of options) {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    el.append(h('option', { value: v }, label));
  }
  el.refresh = () => {
    el.value = value();
  };
  el.refresh();
  el.addEventListener('change', () => onChange(el.value as T));
  return el;
}

export function toggle(
  label: string,
  value: () => boolean,
  onChange: (v: boolean) => void,
  attrs: Attrs = {},
): HTMLButtonElement & { refresh(): void } {
  const el = h('button', { class: 'tgl', type: 'button', ...attrs }, label) as HTMLButtonElement & { refresh(): void };
  el.refresh = () => {
    el.classList.toggle('on', value());
    el.setAttribute('aria-pressed', String(value()));
  };
  el.refresh();
  el.addEventListener('click', () => {
    onChange(!value());
    el.refresh();
  });
  return el;
}

/** A row of buttons acting as a radio group. */
export function segmented<T extends string | number>(
  options: [T, string][],
  value: () => T,
  onChange: (v: T) => void,
  attrs: Attrs = {},
): HTMLDivElement & { refresh(): void } {
  const el = h('div', { class: 'seg', role: 'radiogroup', ...attrs }) as HTMLDivElement & { refresh(): void };
  const btns = options.map(([v, label]) => {
    const b = h('button', { type: 'button', role: 'radio', title: String(label) }, label);
    b.addEventListener('click', () => {
      onChange(v);
      el.refresh();
    });
    el.append(b);
    return [v, b] as const;
  });
  el.refresh = () => {
    for (const [v, b] of btns) {
      b.classList.toggle('on', v === value());
      b.setAttribute('aria-checked', String(v === value()));
    }
  };
  el.refresh();
  return el;
}

export function icon(name: 'play' | 'stop' | 'undo' | 'redo' | 'download' | 'folder' | 'save' | 'file' | 'plus' | 'trash'): SVGSVGElement {
  const paths: Record<string, string> = {
    play: 'M7 4.5v15l13-7.5z',
    stop: 'M6 6h12v12H6z',
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    download: 'M12 3v12m0 0-5-5m5 5 5-5M5 21h14',
    folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
    save: 'M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 3v5h7V3M8 21v-7h8v7',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    plus: 'M12 5v14M5 12h14',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  };
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', paths[name]);
  if (name === 'play' || name === 'stop') {
    p.setAttribute('fill', 'currentColor');
  } else {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(p);
  return svg;
}

export function toast(msg: string, kind: 'info' | 'error' = 'info'): void {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const t = h('div', { class: `toast ${kind}` }, msg);
  host.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

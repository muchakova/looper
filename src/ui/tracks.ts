// Track list doubling as the mixer: select, rename, mute/solo, volume, pan.

import { changed, commit } from '../app';
import { store } from '../state/project';
import { h } from './dom';
import { fmt, knob, type Knob } from './knob';

export class TrackList {
  readonly el: HTMLElement;
  private knobs: Knob[] = [];

  constructor() {
    this.el = h('aside', { class: 'tracks', 'aria-label': 'Tracks' });
    this.refresh();
  }

  refresh(): void {
    this.knobs = [];
    this.el.replaceChildren(h('div', { class: 'tracks-title' }, 'Tracks'));
    store.project.tracks.forEach((t, i) => {
      const sel = i === store.selected;
      const name = h('input', {
        class: 'track-name',
        value: t.name,
        'aria-label': `Track ${i + 1} name`,
        spellcheck: false,
        readOnly: true,
        title: 'Double-click to rename',
      });
      name.addEventListener('dblclick', () => {
        name.readOnly = false;
        name.select();
      });
      const finish = () => {
        name.readOnly = true;
        const v = name.value.trim() || t.name;
        if (v !== t.name) {
          t.name = v;
          commit('mixer');
        }
        name.value = v;
      };
      name.addEventListener('blur', finish);
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') name.blur();
        e.stopPropagation();
      });
      const btn = (label: string, on: boolean, title: string, fn: () => void, cls: string) => {
        const b = h('button', { class: `ms ${cls} ${on ? 'on' : ''}`, type: 'button', title, 'aria-pressed': String(on) }, label);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          fn();
        });
        return b;
      };
      const vol = knob({ label: 'Vol', min: 0, max: 1.2, def: 0.8, size: 'sm', get: () => t.volume, set: (v) => { t.volume = v; changed('mixer'); }, format: fmt.pct, onCommit: () => commit('mixer') });
      const pan = knob({ label: 'Pan', min: -1, max: 1, def: 0, bipolar: true, size: 'sm', get: () => t.pan, set: (v) => { t.pan = v; changed('mixer'); }, format: fmt.pan, onCommit: () => commit('mixer') });
      this.knobs.push(vol, pan);
      const sub = t.kind === 'synth' ? `${t.patch.name} · ${t.notes.length} notes` : `Drum machine · ${t.steps} steps`;
      const rowEl = h(
        'div',
        {
          class: `track ${sel ? 'selected' : ''} ${t.mute ? 'muted' : ''}`,
          style: `--tc:${t.color}`,
          role: 'button',
          tabindex: 0,
          'aria-pressed': String(sel),
          title: `Select (key ${i + 1})`,
        },
        h('div', { class: 'track-color' }),
        h(
          'div',
          { class: 'track-main' },
          h('div', { class: 'track-top' }, h('span', { class: 'track-num' }, String(i + 1)), name),
          h('div', { class: 'track-sub' }, sub),
          h(
            'div',
            { class: 'track-ctrls' },
            btn('M', t.mute, 'Mute', () => { t.mute = !t.mute; commit('mixer'); this.refresh(); }, 'mute'),
            btn('S', t.solo, 'Solo', () => { t.solo = !t.solo; commit('mixer'); this.refresh(); }, 'solo'),
            vol,
            pan,
          ),
        ),
      );
      rowEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.knob')) return;
        if (store.selected !== i) store.select(i);
      });
      rowEl.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === rowEl) {
          e.preventDefault();
          store.select(i);
        }
      });
      this.el.append(rowEl);
    });

    const masterKnobs = [
      knob({ label: 'Volume', min: 0, max: 1.2, def: 0.8, size: 'sm', get: () => store.project.master.volume, set: (v) => { store.project.master.volume = v; changed('mixer'); }, format: fmt.pct, onCommit: () => commit('mixer') }),
      knob({ label: 'Glue', min: 0, max: 1, def: 0.3, size: 'sm', get: () => store.project.master.glue, set: (v) => { store.project.master.glue = v; changed('mixer'); }, format: fmt.pct, onCommit: () => commit('mixer'), title: 'Master bus compression: glues the mix together and makes it louder' }),
    ];
    this.knobs.push(...masterKnobs);
    this.el.append(
      h(
        'div',
        { class: 'master-strip' },
        h('div', { class: 'master-label' }, h('strong', {}, 'Master'), h('span', {}, 'Compressor + limiter')),
        ...masterKnobs,
      ),
    );
  }

  refreshKnobs(): void {
    for (const k of this.knobs) k.refresh();
  }
}

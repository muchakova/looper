// The sound-design panel for a synth track (oscillators, filter, envelopes,
// LFOs, voice, effects) plus the preset browser. Also exports the FX section
// used by the drum track.

import { changed, commit, previewChord } from '../app';
import { LFO_RATES, DELAY_TIMES } from '../state/music';
import { CATEGORIES, FACTORY_PRESETS, initPatch } from '../state/presets';
import { store } from '../state/project';
import type { Env, Fx, Lfo, LfoTarget, LfoWave, Osc, Patch, SynthTrack, Wave } from '../state/types';
import { h, segmented, select, toast, toggle } from './dom';
import { fmt, knob, type KnobOptions } from './knob';

type Refreshable = { refresh(): void };

/** Collects every control so the whole panel can refresh after undo. */
class Controls {
  list: Refreshable[] = [];
  add<T extends Refreshable>(c: T): T {
    this.list.push(c);
    return c;
  }
  refresh(): void {
    for (const c of this.list) c.refresh();
  }
  knob(o: KnobOptions) {
    return this.add(knob({ onCommit: () => commit(), ...o, set: (v) => { o.set(v); changed(); } }));
  }
}

function section(title: string, cls: string, ...body: (Node | null)[]): HTMLElement {
  return h('section', { class: `panel ${cls}` }, h('h3', { class: 'panel-title' }, title), h('div', { class: 'panel-body' }, ...body));
}

function row(...items: (Node | null)[]): HTMLElement {
  return h('div', { class: 'krow' }, ...items);
}

const WAVES: [Wave, string][] = [
  ['sine', 'Sine'],
  ['triangle', 'Tri'],
  ['sawtooth', 'Saw'],
  ['square', 'Sqr'],
  ['pulse', 'Pulse'],
];

export class SynthPanel {
  readonly el: HTMLElement;
  private c = new Controls();
  private presetSel!: HTMLSelectElement;
  private graphs: EnvGraph[] = [];

  constructor(private readonly trackIndex: number) {
    this.el = h('div', { class: 'sound' });
    this.build();
  }

  private get track(): SynthTrack {
    return store.project.tracks[this.trackIndex] as SynthTrack;
  }
  private get p(): Patch {
    return this.track.patch;
  }

  refresh(): void {
    this.c.refresh();
    for (const g of this.graphs) g.draw();
    this.fillPresets();
  }

  private build(): void {
    const c = this.c;
    const P = () => this.p;

    this.el.append(this.presetBar());

    const oscSection = (title: string, get: () => Osc) =>
      section(
        title,
        'osc',
        h(
          'div',
          { class: 'panel-head' },
          c.add(toggle('On', () => get().on, (v) => { get().on = v; commit(); }, { class: 'tgl power' })),
          c.add(segmented(WAVES, () => get().wave, (v) => { get().wave = v; commit(); this.audition(); })),
        ),
        row(
          c.knob({ label: 'Octave', min: -3, max: 3, step: 1, def: 0, bipolar: true, get: () => get().octave, set: (v) => { get().octave = v; }, format: fmt.signed }),
          c.knob({ label: 'Semi', min: -12, max: 12, step: 1, def: 0, bipolar: true, get: () => get().semi, set: (v) => { get().semi = v; }, format: fmt.signed }),
          c.knob({ label: 'Fine', min: -100, max: 100, step: 1, def: 0, bipolar: true, get: () => get().fine, set: (v) => { get().fine = v; }, format: fmt.cents }),
          c.knob({ label: 'Level', min: 0, max: 1, def: 0.7, get: () => get().level, set: (v) => { get().level = v; }, format: fmt.pct }),
          c.knob({ label: 'PW', min: 0.05, max: 0.95, def: 0.5, get: () => get().pw, set: (v) => { get().pw = v; }, format: fmt.pct, title: 'Pulse width (Pulse wave only)' }),
        ),
      );

    const subNoise = section(
      'Sub & Noise',
      'sub',
      h(
        'div',
        { class: 'panel-head' },
        c.add(segmented<'sine' | 'square'>([['sine', 'Sine'], ['square', 'Sqr']], () => P().sub.wave, (v) => { P().sub.wave = v; commit(); })),
        c.add(segmented<number>([[-1, '-1 oct'], [-2, '-2 oct']], () => P().sub.octave, (v) => { P().sub.octave = v; commit(); })),
      ),
      row(
        c.knob({ label: 'Sub', min: 0, max: 1, def: 0, get: () => P().sub.level, set: (v) => { P().sub.level = v; }, format: fmt.pct }),
        c.knob({ label: 'Noise', min: 0, max: 1, def: 0, get: () => P().noise.level, set: (v) => { P().noise.level = v; }, format: fmt.pct }),
      ),
    );

    const unison = section(
      'Unison',
      'uni',
      row(
        c.knob({ label: 'Voices', min: 1, max: 7, step: 1, def: 1, get: () => P().unison.voices, set: (v) => { P().unison.voices = v; }, format: fmt.int }),
        c.knob({ label: 'Detune', min: 0, max: 100, def: 15, get: () => P().unison.detune, set: (v) => { P().unison.detune = v; }, format: fmt.cents }),
        c.knob({ label: 'Width', min: 0, max: 1, def: 0.6, get: () => P().unison.width, set: (v) => { P().unison.width = v; }, format: fmt.pct }),
      ),
    );

    const filtGraph = new EnvGraph(() => P().filtEnv, '--accent-2');
    const ampGraph = new EnvGraph(() => P().ampEnv, '--accent');
    this.graphs = [filtGraph, ampGraph];
    const envKnobs = (get: () => Env, graph: EnvGraph) => {
      const k = (label: string, key: keyof Env, min: number, max: number, def: number, curve: 'lin' | 'log', f: (v: number) => string) =>
        c.knob({ label, min, max, def, curve, get: () => get()[key], set: (v) => { get()[key] = v; graph.draw(); }, format: f, size: 'sm' });
      return row(
        k('Attack', 'a', 0.001, 8, 0.005, 'log', fmt.sec),
        k('Decay', 'd', 0.005, 8, 0.3, 'log', fmt.sec),
        k('Sustain', 's', 0, 1, 0.7, 'lin', fmt.pct),
        k('Release', 'r', 0.005, 10, 0.3, 'log', fmt.sec),
      );
    };

    const filter = section(
      'Filter',
      'filter',
      h(
        'div',
        { class: 'panel-head' },
        c.add(segmented<'lowpass' | 'highpass' | 'bandpass'>([['lowpass', 'LP'], ['highpass', 'HP'], ['bandpass', 'BP']], () => P().filter.type, (v) => { P().filter.type = v; commit(); this.audition(); })),
        c.add(segmented<12 | 24>([[12, '12 dB'], [24, '24 dB']], () => P().filter.slope, (v) => { P().filter.slope = v; commit(); this.audition(); })),
      ),
      row(
        c.knob({ label: 'Cutoff', min: 20, max: 20000, curve: 'log', def: 6000, get: () => P().filter.cutoff, set: (v) => { P().filter.cutoff = v; }, format: fmt.hz }),
        c.knob({ label: 'Reso', min: 0.1, max: 20, curve: 'log', def: 0.8, get: () => P().filter.res, set: (v) => { P().filter.res = v; }, format: fmt.q }),
        c.knob({ label: 'Drive', min: 0, max: 1, def: 0, get: () => P().filter.drive, set: (v) => { P().filter.drive = v; }, format: fmt.pct }),
        c.knob({ label: 'Env amt', min: -6, max: 6, def: 0, bipolar: true, get: () => P().filter.envAmt, set: (v) => { P().filter.envAmt = v; }, format: fmt.oct }),
        c.knob({ label: 'Key trk', min: 0, max: 1, def: 0.3, get: () => P().filter.keyTrack, set: (v) => { P().filter.keyTrack = v; }, format: fmt.pct }),
      ),
      h('div', { class: 'env-wrap' }, h('div', { class: 'env-label' }, 'Filter envelope'), filtGraph.el),
      envKnobs(() => P().filtEnv, filtGraph),
    );

    const amp = section(
      'Amp envelope',
      'amp',
      ampGraph.el,
      envKnobs(() => P().ampEnv, ampGraph),
    );

    const lfoSection = (title: string, get: () => Lfo) =>
      section(
        title,
        'lfo',
        h(
          'div',
          { class: 'lfo-grid' },
          h('label', { class: 'field' }, h('span', {}, 'Shape'), c.add(select<LfoWave>([['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square'], ['sawtooth', 'Saw']], () => get().wave, (v) => { get().wave = v; commit(); }))),
          h('label', { class: 'field' }, h('span', {}, 'Rate'), c.add(select(Object.keys(LFO_RATES), () => get().rate, (v) => { get().rate = v; commit(); }))),
          h('label', { class: 'field' }, h('span', {}, 'Target'), c.add(select<LfoTarget>([['off', 'Off'], ['pitch', 'Pitch (vibrato)'], ['cutoff', 'Filter cutoff'], ['volume', 'Volume (tremolo)'], ['pan', 'Pan']], () => get().target, (v) => { get().target = v; commit(); }))),
        ),
        row(c.knob({ label: 'Amount', min: 0, max: 1, def: 0.3, get: () => get().amount, set: (v) => { get().amount = v; }, format: fmt.pct })),
      );

    const voice = section(
      'Voice',
      'voice',
      h(
        'div',
        { class: 'panel-head' },
        c.add(segmented<'poly' | 'mono'>([['poly', 'Poly'], ['mono', 'Mono']], () => P().voice.mode, (v) => { P().voice.mode = v; commit(); })),
      ),
      row(
        c.knob({ label: 'Glide', min: 0, max: 1, def: 0.08, get: () => P().voice.glide, set: (v) => { P().voice.glide = v; }, format: fmt.sec, title: 'Portamento time (mono mode)' }),
        c.knob({ label: 'Velocity', min: 0, max: 1, def: 0.5, get: () => P().voice.velSens, set: (v) => { P().voice.velSens = v; }, format: fmt.pct, title: 'How much note velocity affects loudness and brightness' }),
        c.knob({ label: 'Volume', min: 0, max: 1, def: 0.7, get: () => P().gain, set: (v) => { P().gain = v; }, format: fmt.pct }),
      ),
    );

    this.el.append(
      h(
        'div',
        { class: 'panels' },
        oscSection('Oscillator 1', () => P().osc1),
        oscSection('Oscillator 2', () => P().osc2),
        subNoise,
        unison,
        filter,
        amp,
        lfoSection('LFO 1', () => P().lfo1),
        lfoSection('LFO 2', () => P().lfo2),
        voice,
      ),
      h('div', { class: 'panels fx-panels' }, ...fxSections(c, () => P().fx)),
    );
    requestAnimationFrame(() => this.graphs.forEach((g) => g.draw()));
  }

  private presetBar(): HTMLElement {
    this.presetSel = h('select', { class: 'sel preset-sel', 'aria-label': 'Preset' });
    this.presetSel.addEventListener('change', () => this.loadPreset(this.presetSel.value));
    this.fillPresets();
    const step = (dir: number) => {
      const opts = [...this.presetSel.querySelectorAll('option')].filter((o) => o.value);
      const idx = opts.findIndex((o) => o.value === this.presetSel.value);
      const next = opts[(idx + dir + opts.length) % opts.length];
      if (next) this.loadPreset(next.value);
    };
    return h(
      'div',
      { class: 'preset-bar' },
      h('span', { class: 'preset-label' }, 'Preset'),
      h('button', { class: 'btn icon-btn', type: 'button', title: 'Previous preset', 'aria-label': 'Previous preset', onclick: () => step(-1) }, '‹'),
      this.presetSel,
      h('button', { class: 'btn icon-btn', type: 'button', title: 'Next preset', 'aria-label': 'Next preset', onclick: () => step(1) }, '›'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => this.audition(), title: 'Hear the current sound' }, 'Listen'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => this.savePreset() }, 'Save preset'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => this.deletePreset(), title: 'Delete the selected user preset' }, 'Delete'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => this.loadPreset('init:Init'), title: 'Start from a plain saw wave' }, 'Init'),
    );
  }

  private fillPresets(): void {
    const sel = this.presetSel;
    if (!sel) return;
    sel.replaceChildren();
    const user = store.userPresets();
    if (user.length) {
      const g = h('optgroup', { label: 'My presets' });
      for (const p of user) g.append(h('option', { value: `user:${p.name}` }, p.name));
      sel.append(g);
    }
    for (const cat of CATEGORIES) {
      const g = h('optgroup', { label: cat });
      for (const p of FACTORY_PRESETS.filter((x) => x.category === cat)) g.append(h('option', { value: `factory:${p.name}` }, p.name));
      sel.append(g);
    }
    const cur = this.p;
    const isUser = user.some((u) => u.name === cur.name) && cur.category === 'User';
    const val = isUser ? `user:${cur.name}` : `factory:${cur.name}`;
    if (![...sel.options].some((o) => o.value === val)) {
      sel.prepend(h('option', { value: '' }, `${cur.name} (edited)`));
      sel.value = '';
    } else {
      sel.value = val;
    }
  }

  private loadPreset(value: string): void {
    const [src, ...rest] = value.split(':');
    const name = rest.join(':');
    let patch: Patch | undefined;
    if (src === 'factory') patch = FACTORY_PRESETS.find((p) => p.name === name);
    else if (src === 'user') patch = store.userPresets().find((p) => p.name === name);
    else if (src === 'init') patch = initPatch();
    if (!patch) return;
    this.track.patch = structuredClone(patch);
    commit();
    this.refresh();
    this.audition();
  }

  private savePreset(): void {
    const name = prompt('Preset name:', this.p.category === 'User' ? this.p.name : `${this.p.name} (my)`);
    if (!name) return;
    const patch = { ...structuredClone(this.p), name: name.trim(), category: 'User' };
    if (store.saveUserPreset(patch)) {
      this.track.patch.name = patch.name;
      this.track.patch.category = 'User';
      commit();
      this.fillPresets();
      toast(`Preset “${patch.name}” saved`);
    } else {
      toast('Could not save the preset (browser storage unavailable)', 'error');
    }
  }

  private deletePreset(): void {
    const v = this.presetSel.value;
    if (!v.startsWith('user:')) {
      toast('Only your own presets can be deleted');
      return;
    }
    const name = v.slice(5);
    if (!confirm(`Delete preset “${name}”?`)) return;
    store.deleteUserPreset(name);
    this.fillPresets();
  }

  /** Play a short chord in the current key to hear the sound. */
  audition(): void {
    const k = store.project.key;
    const root = 48 + k + (k > 6 ? -12 : 0) + 12;
    const minor = ['minor', 'dorian', 'phrygian', 'harmonic', 'pentaMinor', 'blues'].includes(store.project.scale);
    previewChord(this.trackIndex, [root, root + (minor ? 3 : 4), root + 7], 0.8, 0.9);
  }
}

export function fxSections(c: Controls, get: () => Fx): HTMLElement[] {
  const head = (on: () => boolean, set: (v: boolean) => void, ...extra: Node[]) =>
    h('div', { class: 'panel-head' }, c.add(toggle('On', on, (v) => { set(v); commit(); }, { class: 'tgl power' })), ...extra);
  const F = get;
  return [
    section(
      'Drive',
      'fx',
      head(() => F().drive.on, (v) => (F().drive.on = v)),
      row(
        c.knob({ label: 'Amount', min: 0, max: 1, def: 0.3, get: () => F().drive.amount, set: (v) => { F().drive.amount = v; }, format: fmt.pct }),
        c.knob({ label: 'Tone', min: 0, max: 1, def: 0.7, get: () => F().drive.tone, set: (v) => { F().drive.tone = v; }, format: fmt.pct }),
        c.knob({ label: 'Mix', min: 0, max: 1, def: 1, get: () => F().drive.mix, set: (v) => { F().drive.mix = v; }, format: fmt.pct }),
      ),
    ),
    section(
      'Chorus',
      'fx',
      head(() => F().chorus.on, (v) => (F().chorus.on = v)),
      row(
        c.knob({ label: 'Rate', min: 0.05, max: 8, curve: 'log', def: 0.6, get: () => F().chorus.rate, set: (v) => { F().chorus.rate = v; }, format: (v) => `${v.toFixed(2)} Hz` }),
        c.knob({ label: 'Depth', min: 0, max: 1, def: 0.5, get: () => F().chorus.depth, set: (v) => { F().chorus.depth = v; }, format: fmt.pct }),
        c.knob({ label: 'Mix', min: 0, max: 1, def: 0.4, get: () => F().chorus.mix, set: (v) => { F().chorus.mix = v; }, format: fmt.pct }),
      ),
    ),
    section(
      'Delay',
      'fx',
      head(
        () => F().delay.on,
        (v) => (F().delay.on = v),
        c.add(select(Object.keys(DELAY_TIMES), () => F().delay.time, (v) => { F().delay.time = v; commit(); }, { 'aria-label': 'Delay time', title: 'Delay time (synced to tempo)' })),
        c.add(toggle('Ping-pong', () => F().delay.pingpong, (v) => { F().delay.pingpong = v; commit(); })),
      ),
      row(
        c.knob({ label: 'Feedback', min: 0, max: 0.92, def: 0.35, get: () => F().delay.feedback, set: (v) => { F().delay.feedback = v; }, format: fmt.pct }),
        c.knob({ label: 'Mix', min: 0, max: 1, def: 0.25, get: () => F().delay.mix, set: (v) => { F().delay.mix = v; }, format: fmt.pct }),
      ),
    ),
    section(
      'Reverb',
      'fx',
      head(() => F().reverb.on, (v) => (F().reverb.on = v)),
      row(
        c.knob({ label: 'Size', min: 0, max: 1, def: 0.4, get: () => F().reverb.size, set: (v) => { F().reverb.size = v; }, format: (v) => `${(0.4 + v * 5.6).toFixed(1)} s` }),
        c.knob({ label: 'Damp', min: 0, max: 1, def: 0.5, get: () => F().reverb.damp, set: (v) => { F().reverb.damp = v; }, format: fmt.pct }),
        c.knob({ label: 'Mix', min: 0, max: 1, def: 0.25, get: () => F().reverb.mix, set: (v) => { F().reverb.mix = v; }, format: fmt.pct }),
      ),
    ),
    section(
      'EQ',
      'fx',
      row(
        c.knob({ label: 'Low', min: -12, max: 12, def: 0, bipolar: true, get: () => F().eq.low, set: (v) => { F().eq.low = v; }, format: fmt.db }),
        c.knob({ label: 'Mid', min: -12, max: 12, def: 0, bipolar: true, get: () => F().eq.mid, set: (v) => { F().eq.mid = v; }, format: fmt.db }),
        c.knob({ label: 'High', min: -12, max: 12, def: 0, bipolar: true, get: () => F().eq.high, set: (v) => { F().eq.high = v; }, format: fmt.db }),
      ),
    ),
  ];
}

/** Effects-only panel for the drum track. */
export class FxPanel {
  readonly el: HTMLElement;
  private c = new Controls();
  constructor(get: () => Fx, title: string) {
    this.el = h(
      'div',
      { class: 'sound' },
      h('div', { class: 'preset-bar' }, h('span', { class: 'preset-label' }, title)),
      h('div', { class: 'panels fx-panels' }, ...fxSections(this.c, get)),
    );
  }
  refresh(): void {
    this.c.refresh();
  }
}

/** Small ADSR shape display. */
class EnvGraph {
  readonly el: HTMLCanvasElement;
  constructor(
    private readonly get: () => Env,
    private readonly colorVar: string,
  ) {
    this.el = h('canvas', { class: 'env-graph', 'aria-hidden': 'true' });
  }
  draw(): void {
    const c = this.el;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 220;
    const ht = c.clientHeight || 54;
    if (c.width !== Math.floor(w * dpr)) {
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(ht * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, ht);
    const e = this.get();
    // Time axis is compressed (sqrt) so short and long envelopes both read well.
    const sq = (s: number) => Math.sqrt(s);
    const total = sq(e.a) + sq(e.d) + 0.6 + sq(e.r);
    const sx = (w - 8) / total;
    const top = 6;
    const bot = ht - 4;
    const x0 = 4;
    const xa = x0 + sq(e.a) * sx;
    const xd = xa + sq(e.d) * sx;
    const xs = xd + 0.6 * sx;
    const xr = xs + sq(e.r) * sx;
    const ys = bot - (bot - top) * e.s;
    const color = getComputedStyle(document.documentElement).getPropertyValue(this.colorVar).trim() || '#ff7a45';
    g.beginPath();
    g.moveTo(x0, bot);
    g.lineTo(xa, top);
    g.quadraticCurveTo(xa + (xd - xa) * 0.15, ys, xd, ys);
    g.lineTo(xs, ys);
    g.quadraticCurveTo(xs + (xr - xs) * 0.15, bot, xr, bot);
    g.lineWidth = 2;
    g.strokeStyle = color;
    g.stroke();
    g.lineTo(x0, bot);
    g.closePath();
    g.fillStyle = color + '22';
    g.fill();
  }
}

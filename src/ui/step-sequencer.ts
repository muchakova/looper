// Drum step sequencer: 8 synthesized voices × 16/32 steps, with accents,
// paint-dragging, per-voice tune/decay/level and pattern presets.

import { changed, commit, ensureAudio, engine, audioCtx, transport } from '../app';
import { DRUM_LABELS, DRUM_VOICES } from '../audio/drums';
import { STEP_OPTIONS, store } from '../state/project';
import type { DrumTrack, DrumVoice } from '../state/types';
import { h } from './dom';
import { fmt, knob, type Knob } from './knob';

type Pat = Partial<Record<DrumVoice, string>>;

// x = hit, X = accent, . = rest (16 steps)
const PATTERNS: Record<string, Pat> = {
  'Pop / Rock': {
    kick: 'X......xX.x.....',
    snare: '....X.......X...',
    chh: 'x.x.x.x.x.x.x.x.',
  },
  'Rock drive': {
    kick: 'X.x...x.X.x...x.',
    snare: '....X.......X...',
    chh: 'XxXxXxXxXxXxXxXx',
    ohh: '..............x.',
  },
  'Lo-fi hip-hop': {
    kick: 'X......x..x.....',
    snare: '....X.......X..x',
    chh: 'x.x.x.xxx.x.x.x.',
    rim: '.......x........',
  },
  'Four on the floor': {
    kick: 'X...X...X...X...',
    clap: '....X.......X...',
    chh: '..x...x...x...x.',
    ohh: '..x...x...x...x.',
  },
  'Trap': {
    kick: 'X......x..X.....',
    snare: '........X.......',
    clap: '........X.......',
    chh: 'xxxxxxxxxxXxxxxx',
  },
  'Half-time cinematic': {
    kick: 'X.........x.....',
    snare: '........X.......',
    tom: '..............xx',
    chh: 'x...x...x...x...',
  },
  'Breakbeat': {
    kick: 'X.........X.....',
    snare: '....X..x.x..X...',
    chh: 'x.x.x.x.x.x.x.x.',
    ohh: '...............x',
  },
  'Reggaeton': {
    kick: 'X...X...X...X...',
    snare: '...x..x....x..x.',
    chh: 'x.x.x.x.x.x.x.x.',
  },
};

export class StepSequencer {
  readonly el: HTMLElement;
  private cells: Record<string, HTMLButtonElement[]> = {};
  private knobs: Knob[] = [];
  private grid: HTMLElement;
  private stepsSel: HTMLSelectElement;
  private paint: number | null = null;
  private lastStep = -1;

  constructor() {
    this.grid = h('div', { class: 'seq-grid' });
    this.stepsSel = h('select', { class: 'sel', 'aria-label': 'Pattern length', title: 'Pattern length: a longer pattern lets the drums change from section to section' });
    this.stepsSel.addEventListener('change', () => this.setSteps(+this.stepsSel.value));
    const patSel = h(
      'select',
      { class: 'sel', 'aria-label': 'Load pattern', title: 'Load a ready-made drum pattern' },
      h('option', { value: '' }, 'Load pattern…'),
      ...Object.keys(PATTERNS).map((k) => h('option', { value: k }, k)),
    );
    patSel.addEventListener('change', () => {
      if (patSel.value) this.loadPattern(PATTERNS[patSel.value]);
      patSel.value = '';
    });
    this.el = h(
      'div',
      { class: 'seq' },
      h(
        'div',
        { class: 'editor-toolbar' },
        h('label', { class: 'tb-field' }, h('span', {}, 'Pattern'), this.stepsSel),
        patSel,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => this.clear() }, 'Clear'),
        h('div', { class: 'tb-hint' }, 'Click — hit · Shift/right-click — accent · Drag — paint · Click a name — listen'),
      ),
      h('div', { class: 'seq-scroll' }, this.grid),
    );
    window.addEventListener('pointerup', () => {
      if (this.paint !== null) {
        this.paint = null;
        commit('notes');
      }
    });
    const tick = () => {
      this.updatePlayhead();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private track(): DrumTrack {
    const t = store.project.tracks.find((x) => x.kind === 'drums') as DrumTrack;
    return store.track.kind === 'drums' ? store.track : t;
  }

  private trackIndex(): number {
    return store.project.tracks.indexOf(this.track());
  }

  /** Rebuild the grid from the project. */
  refresh(): void {
    const t = this.track();
    // Offer pattern lengths up to the song length (at least 2 bars)
    const maxSteps = Math.max(32, store.project.bars * 16, t.steps);
    this.stepsSel.replaceChildren(
      ...STEP_OPTIONS.filter((n) => n <= maxSteps).map((n) => h('option', { value: String(n) }, `${n / 16} bar${n > 16 ? 's' : ''}`)),
    );
    this.stepsSel.value = String(t.steps);
    this.grid.replaceChildren();
    this.cells = {};
    this.knobs = [];
    this.grid.style.setProperty('--steps', String(t.steps));
    this.grid.style.setProperty('--cell', t.steps > 32 ? '24px' : '34px');
    if (t.steps > 16) {
      // Bar numbers above the grid
      const bars = h('div', { class: 'seq-bars' });
      for (let b = 0; b < t.steps / 16; b++) bars.append(h('span', {}, `Bar ${b + 1}`));
      this.grid.append(h('div', { class: 'seq-row seq-head' }, h('div', { class: 'seq-name-spacer' }), h('div', { class: 'seq-knobs-spacer' }), bars));
    }
    for (const v of DRUM_VOICES) {
      const s = () => this.track().sounds[v];
      const name = h(
        'button',
        { class: 'seq-name', type: 'button', title: `Play ${DRUM_LABELS[v]}`, onclick: () => this.audition(v) },
        DRUM_LABELS[v],
      );
      const k = [
        knob({ label: 'Tune', min: -12, max: 12, step: 1, def: 0, bipolar: true, size: 'sm', get: () => s().tune, set: (x) => { s().tune = x; }, format: fmt.signed, onCommit: () => { commit(); this.audition(v); } }),
        knob({ label: 'Decay', min: 0.2, max: 3, def: 1, curve: 'log', size: 'sm', get: () => s().decay, set: (x) => { s().decay = x; }, format: (x) => `${x.toFixed(2)}×`, onCommit: () => { commit(); this.audition(v); } }),
        knob({ label: 'Level', min: 0, max: 1, def: 0.8, size: 'sm', get: () => s().level, set: (x) => { s().level = x; changed(); }, format: fmt.pct, onCommit: () => commit() }),
      ];
      this.knobs.push(...k);
      const cells: HTMLButtonElement[] = [];
      const row = h('div', { class: 'seq-cells' });
      for (let i = 0; i < t.steps; i++) {
        const c = h('button', {
          class: `seq-cell ${Math.floor(i / 4) % 2 ? 'alt' : ''} ${i % 16 === 0 && i > 0 ? 'bar-start' : ''}`,
          type: 'button',
          'aria-label': `${DRUM_LABELS[v]} step ${i + 1}`,
        });
        c.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const cur = this.track().pattern[v][i];
          const accent = e.shiftKey || e.button === 2;
          this.paint = accent ? (cur === 2 ? 0 : 2) : cur ? 0 : 1;
          this.setCell(v, i, this.paint);
          if (this.paint) this.audition(v, this.paint === 2 ? 1 : 0.72);
        });
        c.addEventListener('pointerenter', () => {
          if (this.paint !== null) this.setCell(v, i, this.paint);
        });
        c.addEventListener('contextmenu', (e) => e.preventDefault());
        cells.push(c);
        row.append(c);
      }
      this.cells[v] = cells;
      this.grid.append(h('div', { class: 'seq-row' }, name, h('div', { class: 'seq-knobs' }, ...k), row));
    }
    this.paintCells();
  }

  private paintCells(): void {
    const t = this.track();
    for (const v of DRUM_VOICES) {
      this.cells[v]?.forEach((c, i) => {
        const val = t.pattern[v][i];
        c.classList.toggle('on', val === 1);
        c.classList.toggle('accent', val === 2);
        c.classList.toggle('beyond', i * 0.25 >= store.project.bars * 4);
      });
    }
  }

  private setCell(v: DrumVoice, i: number, val: number): void {
    const t = this.track();
    if (t.pattern[v][i] === val) return;
    t.pattern[v][i] = val;
    this.paintCells();
    changed('notes');
  }

  private setSteps(n: number): void {
    const t = this.track();
    if (t.steps === n) return;
    for (const v of DRUM_VOICES) {
      const old = t.pattern[v];
      // Growing to 32 repeats the first bar so the groove keeps going.
      t.pattern[v] = Array.from({ length: n }, (_, i) => old[i] ?? old[i % old.length] ?? 0);
    }
    t.steps = n;
    commit('notes');
    this.refresh();
  }

  private loadPattern(p: Pat): void {
    const t = this.track();
    for (const v of DRUM_VOICES) {
      const str = p[v] ?? '';
      t.pattern[v] = Array.from({ length: t.steps }, (_, i) => {
        const ch = str[i % 16] ?? '.';
        return ch === 'X' ? 2 : ch === 'x' ? 1 : 0;
      });
    }
    commit('notes');
    this.paintCells();
  }

  private clear(): void {
    const t = this.track();
    for (const v of DRUM_VOICES) t.pattern[v] = new Array(t.steps).fill(0);
    commit('notes');
    this.paintCells();
  }

  private audition(v: DrumVoice, vel = 0.85): void {
    void ensureAudio().then(() => engine.drums(this.trackIndex())?.trigger(v, vel, audioCtx.currentTime + 0.005));
  }

  refreshKnobs(): void {
    for (const k of this.knobs) k.refresh();
  }

  private updatePlayhead(): void {
    const pos = transport.position();
    const t = this.track();
    const step = pos === null ? -1 : Math.floor(pos / 0.25 + 1e-6) % t.steps;
    if (step === this.lastStep) return;
    for (const v of DRUM_VOICES) {
      const cells = this.cells[v];
      if (!cells) continue;
      if (this.lastStep >= 0) cells[this.lastStep]?.classList.remove('now');
      if (step >= 0) cells[step]?.classList.add('now');
    }
    this.lastStep = step;
  }
}

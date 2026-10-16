// Drum step sequencer: 8 synthesized voices, accents, paint-dragging,
// per-voice tune/decay/level, pattern presets, and an Opal-style step lane for
// per-step parameter locks (tune, decay, level, pan, ratchet, nudge) and trig
// conditions (chance, A:B cycles).

import { changed, commit, ensureAudio, engine, audioCtx, transport } from '../app';
import { DRUM_LABELS, DRUM_VOICES } from '../audio/drums';
import { STEP_OPTIONS, store } from '../state/project';
import { condLabel, hasLocks, hasTrig, nextCond } from '../state/conditions';
import type { DrumTrack, DrumVoice, StepParams } from '../state/types';
import { h, select } from './dom';
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

type LaneParam = 'tune' | 'decay' | 'level' | 'pan' | 'ratchet' | 'nudge' | 'chance' | 'cond';

interface LaneDef {
  label: string;
  min: number;
  max: number;
  step: number;
  bipolar?: boolean;
  /** Value used when the step has no lock (the row's own setting). */
  def: (t: DrumTrack, v: DrumVoice) => number;
  fmt: (x: number) => string;
  hint: string;
}

const LANES: Record<Exclude<LaneParam, 'cond'>, LaneDef> = {
  tune: { label: 'Tune', min: -24, max: 24, step: 1, bipolar: true, def: (t, v) => t.sounds[v].tune, fmt: (x) => `${x > 0 ? '+' : ''}${Math.round(x)}`, hint: 'Pitch of this hit in semitones' },
  decay: { label: 'Decay', min: 0.2, max: 3, step: 0.05, def: (t, v) => t.sounds[v].decay, fmt: (x) => `${x.toFixed(1)}×`, hint: 'How long this hit rings' },
  level: { label: 'Level', min: 0, max: 1, step: 0.01, def: (t, v) => t.sounds[v].level, fmt: (x) => `${Math.round(x * 100)}`, hint: 'Loudness of this hit' },
  pan: { label: 'Pan', min: -1, max: 1, step: 0.05, bipolar: true, def: () => 0, fmt: (x) => (Math.abs(x) < 0.03 ? 'C' : x < 0 ? `L${Math.round(-x * 100)}` : `R${Math.round(x * 100)}`), hint: 'Left/right position of this hit' },
  ratchet: { label: 'Ratchet', min: 1, max: 4, step: 1, def: () => 1, fmt: (x) => `${Math.round(x)}×`, hint: 'Repeat the hit 2–4 times inside its step (rolls)' },
  nudge: { label: 'Nudge', min: -0.45, max: 0.45, step: 0.05, bipolar: true, def: () => 0, fmt: (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`, hint: 'Push the hit slightly early or late (micro-timing)' },
  chance: { label: 'Chance', min: 0, max: 100, step: 5, def: () => 100, fmt: (x) => `${Math.round(x)}%`, hint: 'Probability that the hit plays on each pass' },
};

const LANE_ORDER: [LaneParam, string][] = [
  ['tune', 'Tune'],
  ['decay', 'Decay'],
  ['level', 'Level'],
  ['pan', 'Pan'],
  ['ratchet', 'Ratchet'],
  ['nudge', 'Nudge'],
  ['chance', 'Chance'],
  ['cond', 'Condition'],
];

export class StepSequencer {
  readonly el: HTMLElement;
  private cells: Record<string, HTMLButtonElement[]> = {};
  private knobs: Knob[] = [];
  private grid: HTMLElement;
  private stepsSel: HTMLSelectElement;
  private paint: number | null = null;
  private lastStep = -1;
  private laneVoice: DrumVoice = 'chh';
  private laneParam: LaneParam = 'tune';
  private laneCells: HTMLElement[] = [];
  private laneDrag = false;
  private laneChanged = false;
  private lastHeard = '';

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
        h('div', { class: 'tb-hint' }, 'Click — hit · Shift/right-click — accent · Drag — paint · Click a name — listen & edit in the step lane below'),
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
        {
          class: `seq-name ${v === this.laneVoice ? 'lane-on' : ''}`,
          type: 'button',
          title: `Play ${DRUM_LABELS[v]} and show it in the step lane`,
          onclick: () => {
            this.audition(v);
            if (this.laneVoice !== v) {
              this.laneVoice = v;
              this.refresh();
            }
          },
        },
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
    this.grid.append(this.buildLane(t));
    this.paintCells();
  }

  // ── Step lane: per-step locks and conditions ─────────────────────────

  private locksOf(v: DrumVoice): Record<number, StepParams> {
    const t = this.track();
    t.locks ??= {};
    return (t.locks[v] ??= {});
  }

  private buildLane(t: DrumTrack): HTMLElement {
    const voiceSel = select(
      DRUM_VOICES.map((v) => [v, DRUM_LABELS[v]] as [DrumVoice, string]),
      () => this.laneVoice,
      (v) => {
        this.laneVoice = v;
        this.refresh();
      },
      { 'aria-label': 'Drum shown in the step lane' },
    );
    const paramSel = select(
      LANE_ORDER,
      () => this.laneParam,
      (v) => {
        this.laneParam = v;
        this.refresh();
      },
      { 'aria-label': 'Parameter shown in the step lane' },
    );
    const hint = this.laneParam === 'cond' ? 'Click a step to choose when it plays (A:B = pass A of every B)' : LANES[this.laneParam].hint;
    const lane = h('div', { class: 'seq-lane', title: `${hint}. Drag to set · right-click or double-click to reset` });
    this.laneCells = [];
    for (let i = 0; i < t.steps; i++) {
      const c = h('div', { class: `lane-cell ${i % 16 === 0 && i > 0 ? 'bar-start' : ''}` }, h('div', { class: 'lane-bar' }), h('span', { class: 'lane-val' }));
      this.laneCells.push(c);
      lane.append(c);
    }
    lane.addEventListener('pointerdown', (e) => this.laneDown(e, lane));
    lane.addEventListener('pointermove', (e) => this.laneMove(e));
    lane.addEventListener('pointerup', (e) => this.laneUp(e, lane));
    lane.addEventListener('dblclick', (e) => this.laneClear(e));
    lane.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.laneClear(e);
    });
    return h(
      'div',
      { class: 'seq-row seq-lane-row' },
      h('div', { class: 'lane-ctrl' }, h('span', { class: 'lane-title' }, 'Step lane'), h('div', { class: 'lane-selects' }, voiceSel, paramSel), h('small', {}, hint)),
      lane,
    );
  }

  private laneIndex(e: MouseEvent): number {
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.lane-cell');
    return el ? this.laneCells.indexOf(el as HTMLElement) : -1;
  }

  private laneDown(e: PointerEvent, lane: HTMLElement): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const i = this.laneIndex(e);
    if (i < 0 || !this.track().pattern[this.laneVoice][i]) return;
    this.laneChanged = false;
    if (this.laneParam === 'cond') {
      const locks = this.locksOf(this.laneVoice);
      const next = nextCond(locks[i]?.cond, e.shiftKey ? -1 : 1);
      this.writeLock(i, (sp) => (next ? (sp.cond = next) : delete sp.cond));
      commit('notes');
      return;
    }
    lane.setPointerCapture(e.pointerId);
    this.laneDrag = true;
    this.laneSet(e);
  }

  private laneMove(e: PointerEvent): void {
    if (this.laneDrag) this.laneSet(e);
  }

  private laneUp(e: PointerEvent, lane: HTMLElement): void {
    if (lane.hasPointerCapture(e.pointerId)) lane.releasePointerCapture(e.pointerId);
    if (this.laneDrag && this.laneChanged) commit('notes');
    this.laneDrag = false;
  }

  private laneSet(e: PointerEvent): void {
    if (this.laneParam === 'cond') return;
    const i = this.laneIndex(e);
    if (i < 0 || !this.track().pattern[this.laneVoice][i]) return;
    const def = LANES[this.laneParam];
    const r = this.laneCells[i].getBoundingClientRect();
    const n = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    const x = Math.round((def.min + n * (def.max - def.min)) / def.step) * def.step;
    const key = this.laneParam;
    this.writeLock(i, (sp) => {
      // A value equal to the row's own setting is no lock at all
      if (Math.abs(x - def.def(this.track(), this.laneVoice)) < def.step / 2) delete sp[key];
      else sp[key] = +x.toFixed(3);
    });
    // Let the user hear the new value, but only once per value per step
    const tag = `${i}:${key}:${x}`;
    if (key !== 'chance' && key !== 'nudge' && tag !== this.lastHeard) {
      this.lastHeard = tag;
      this.auditionStep(i);
    }
  }

  private laneClear(e: MouseEvent): void {
    const i = this.laneIndex(e);
    if (i < 0) return;
    const key = this.laneParam;
    this.writeLock(i, (sp) => delete sp[key]);
    commit('notes');
  }

  private writeLock(i: number, edit: (sp: StepParams) => void): void {
    const locks = this.locksOf(this.laneVoice);
    const sp = { ...(locks[i] ?? {}) };
    edit(sp);
    if (Object.keys(sp).length) locks[i] = sp;
    else delete locks[i];
    this.laneChanged = true;
    this.paintCells();
    changed('notes');
  }

  private auditionStep(i: number): void {
    const t = this.track();
    const lock = t.locks?.[this.laneVoice]?.[i];
    const vel = t.pattern[this.laneVoice][i] === 2 ? 1 : 0.72;
    void ensureAudio().then(() => engine.drums(this.trackIndex())?.trigger(this.laneVoice, vel, audioCtx.currentTime + 0.005, Math.random() * 1e9, lock));
  }

  private paintLane(): void {
    const t = this.track();
    const v = this.laneVoice;
    const locks = t.locks?.[v] ?? {};
    this.laneCells.forEach((c, i) => {
      const active = !!t.pattern[v][i];
      const sp = locks[i];
      const bar = c.firstElementChild as HTMLElement;
      const label = c.lastElementChild as HTMLElement;
      c.classList.toggle('inactive', !active);
      c.classList.toggle('cond-mode', this.laneParam === 'cond');
      if (this.laneParam === 'cond') {
        const has = !!sp?.cond;
        c.classList.toggle('locked', has);
        bar.style.cssText = 'display:none';
        label.textContent = active ? condLabel(sp?.cond).replace('Always', '·') : '';
        return;
      }
      const def = LANES[this.laneParam];
      const locked = sp?.[this.laneParam] !== undefined;
      const val = locked ? (sp![this.laneParam] as number) : def.def(t, v);
      const norm = (val - def.min) / (def.max - def.min);
      c.classList.toggle('locked', locked);
      if (def.bipolar) {
        const mid = (0 - def.min) / (def.max - def.min);
        const lo = Math.min(norm, mid);
        bar.style.cssText = `bottom:${lo * 100}%;height:${Math.max(2, Math.abs(norm - mid) * 100)}%`;
      } else {
        bar.style.cssText = `bottom:0;height:${Math.max(2, norm * 100)}%`;
      }
      label.textContent = active && locked ? def.fmt(val) : '';
    });
  }

  private paintCells(): void {
    const t = this.track();
    for (const v of DRUM_VOICES) {
      this.cells[v]?.forEach((c, i) => {
        const val = t.pattern[v][i];
        c.classList.toggle('on', val === 1);
        c.classList.toggle('accent', val === 2);
        c.classList.toggle('beyond', i * 0.25 >= store.project.bars * 4);
        const sp = t.locks?.[v]?.[i];
        c.classList.toggle('has-lock', !!val && hasLocks(sp));
        c.classList.toggle('has-cond', !!val && hasTrig(sp));
        c.classList.toggle('lane-voice', v === this.laneVoice);
      });
    }
    this.paintLane();
  }

  private setCell(v: DrumVoice, i: number, val: number): void {
    const t = this.track();
    if (t.pattern[v][i] === val) return;
    t.pattern[v][i] = val;
    if (!val && t.locks?.[v]?.[i]) delete t.locks[v]![i];
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
      const locks = t.locks?.[v];
      if (locks) {
        const next: Record<number, StepParams> = {};
        for (let i = 0; i < n; i++) {
          const src = locks[i] ?? (i >= t.steps ? locks[i % t.steps] : undefined);
          if (src) next[i] = { ...src };
        }
        t.locks![v] = next;
      }
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
    delete t.locks;
    commit('notes');
    this.paintCells();
  }

  private clear(): void {
    const t = this.track();
    for (const v of DRUM_VOICES) t.pattern[v] = new Array(t.steps).fill(0);
    delete t.locks;
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

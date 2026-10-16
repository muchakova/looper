// Canvas piano roll with scale highlighting, chord drawing, selection,
// move/resize, copy/paste and a velocity lane.

import { changed, commit, previewChord, previewNote, transport } from '../app';
import { buildChord, CHORD_LABELS, inScale, NOTE_NAMES, SNAP_OPTIONS, snapToScale, type ChordMode } from '../state/music';
import { condLabel, hasTrig, nextCond } from '../state/conditions';
import { newNoteId, store } from '../state/project';
import type { Note, SynthTrack } from '../state/types';
import { h, select, toggle } from './dom';

const LOW = 24; // C1
const HIGH = 108; // C8
const KEY_W = 58;
const RULER_H = 22;
const ROW_H = 15;
const VEL_H = 70;

type Drag =
  | { mode: 'move'; startBeat: number; startPitch: number; orig: Map<number, Note>; anchor: Note; lastPitch: number }
  | { mode: 'resize'; startBeat: number; orig: Map<number, Note> }
  | { mode: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: Set<number> }
  | { mode: 'erase' }
  | { mode: 'velocity' }
  | { mode: 'pan'; x: number; y: number; sx: number; sy: number };

interface Settings {
  snap: string;
  chord: ChordMode;
  scaleLock: boolean;
  ghosts: boolean;
  lane: NoteLane;
}

/** What the lane under the piano roll edits for each note. */
type NoteLane = 'vel' | 'cutoff' | 'res' | 'pan' | 'chance' | 'cond';

interface LaneDef {
  label: string;
  min: number;
  max: number;
  step: number;
  bipolar?: boolean;
  /** Current value, falling back to the patch/default when not locked. */
  get: (n: Note, t: SynthTrack) => number;
  locked: (n: Note) => boolean;
  /** Write a value; `undefined` (or the default) removes the lock. */
  set: (n: Note, v: number | undefined, t: SynthTrack) => void;
  fmt: (v: number) => string;
}

const NOTE_LANES: Record<Exclude<NoteLane, 'cond'>, LaneDef> = {
  vel: {
    label: 'VELOCITY', min: 0.05, max: 1, step: 0.01,
    get: (n) => n.vel, locked: () => true,
    set: (n, v) => (n.vel = v ?? 0.8), fmt: (v) => `${Math.round(v * 100)}`,
  },
  cutoff: {
    label: 'CUTOFF', min: -4, max: 4, step: 0.1, bipolar: true,
    get: (n) => n.cutoff ?? 0, locked: (n) => n.cutoff !== undefined,
    set: (n, v) => (v === undefined || Math.abs(v) < 0.05 ? delete n.cutoff : (n.cutoff = v)), fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
  },
  res: {
    label: 'RESO', min: 0.1, max: 20, step: 0.1,
    get: (n, t) => n.res ?? t.patch.filter.res, locked: (n) => n.res !== undefined,
    set: (n, v, t) => (v === undefined || Math.abs(v - t.patch.filter.res) < 0.05 ? delete n.res : (n.res = v)), fmt: (v) => v.toFixed(1),
  },
  pan: {
    label: 'PAN', min: -1, max: 1, step: 0.05, bipolar: true,
    get: (n) => n.pan ?? 0, locked: (n) => n.pan !== undefined,
    set: (n, v) => (v === undefined || Math.abs(v) < 0.03 ? delete n.pan : (n.pan = v)), fmt: (v) => (Math.abs(v) < 0.03 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
  },
  chance: {
    label: 'CHANCE', min: 0, max: 100, step: 5,
    get: (n) => n.chance ?? 100, locked: (n) => n.chance !== undefined,
    set: (n, v) => (v === undefined || v >= 100 ? delete n.chance : (n.chance = v)), fmt: (v) => `${Math.round(v)}%`,
  },
};

const LANE_OPTIONS: [NoteLane, string][] = [
  ['vel', 'Velocity'],
  ['cutoff', 'Cutoff'],
  ['res', 'Resonance'],
  ['pan', 'Pan'],
  ['chance', 'Chance'],
  ['cond', 'Condition'],
];

export class PianoRoll {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly vel: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly vg: CanvasRenderingContext2D;
  private w = 0;
  private hgt = 0;
  private scrollX = 0;
  private scrollY = (HIGH - 79) * ROW_H;
  private zoom = 1;
  private selected = new Set<number>();
  private drag: Drag | null = null;
  private dirty = true;
  private clipboard: Note[] = [];
  private pasteOffset = 0;
  private drawLen = 0.5;
  private hoverCursor = 'default';
  private hover: { pitch: number; beat: number; x: number; y: number } | null = null;
  private readonly toolbarControls: { refresh(): void }[] = [];
  private settings: Settings = { snap: '1/16', chord: 'off', scaleLock: true, ghosts: true, lane: 'vel' };
  private dragChanged = false;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('loopforge.roll') ?? 'null');
      if (saved) this.settings = { ...this.settings, ...saved };
    } catch {
      /* ignore */
    }

    this.canvas = h('canvas', { class: 'roll-canvas', tabindex: 0, 'aria-label': 'Piano roll' });
    this.vel = h('canvas', { class: 'vel-canvas', 'aria-label': 'Note velocity' });
    this.g = this.canvas.getContext('2d')!;
    this.vg = this.vel.getContext('2d')!;

    const save = () => {
      try {
        localStorage.setItem('loopforge.roll', JSON.stringify(this.settings));
      } catch {
        /* ignore */
      }
      this.invalidate();
    };
    const snapSel = select(
      Object.keys(SNAP_OPTIONS),
      () => this.settings.snap,
      (v) => {
        this.settings.snap = v;
        save();
      },
      { title: 'Grid snap', 'aria-label': 'Grid snap' },
    );
    const chordSel = select(
      (Object.keys(CHORD_LABELS) as ChordMode[]).map((k) => [k, CHORD_LABELS[k]] as [ChordMode, string]),
      () => this.settings.chord,
      (v) => {
        this.settings.chord = v;
        save();
      },
      { title: 'Chord tool: one click places a whole chord that fits the key', 'aria-label': 'Chord tool' },
    );
    const lock = toggle(
      'Scale lock',
      () => this.settings.scaleLock,
      (v) => {
        this.settings.scaleLock = v;
        save();
      },
      { title: 'New and moved notes snap to the selected scale' },
    );
    const ghosts = toggle(
      'Ghost notes',
      () => this.settings.ghosts,
      (v) => {
        this.settings.ghosts = v;
        save();
      },
      { title: 'Show notes of the other tracks faintly' },
    );
    const laneSel = select(
      LANE_OPTIONS,
      () => this.settings.lane,
      (v) => {
        this.settings.lane = v;
        save();
      },
      { title: 'What the lane under the notes edits: velocity, or a per-note sound lock / trig condition', 'aria-label': 'Note lane' },
    );
    this.toolbarControls.push(snapSel, chordSel, lock, ghosts, laneSel);

    const toolbar = h(
      'div',
      { class: 'editor-toolbar' },
      h('label', { class: 'tb-field' }, h('span', {}, 'Grid'), snapSel),
      h('label', { class: 'tb-field' }, h('span', {}, 'Draw'), chordSel),
      lock,
      ghosts,
      h('label', { class: 'tb-field' }, h('span', {}, 'Lane'), laneSel),
      h('div', { class: 'tb-sep' }),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => this.quantize(), title: 'Snap selected notes (or all) to the grid' }, 'Quantize'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => this.duplicate(), title: 'Duplicate selection (Ctrl/Cmd+D)' }, 'Duplicate'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => this.clearAll(), title: 'Delete every note on this track' }, 'Clear'),
      h(
        'div',
        { class: 'tb-hint' },
        'Click — draw · Drag — length · Right-click — delete · Shift+drag — select · Alt+drag — copy · Wheel — scroll · Ctrl+wheel — zoom',
      ),
    );

    this.el = h('div', { class: 'roll' }, toolbar, h('div', { class: 'roll-body' }, this.canvas), h('div', { class: 'vel-body' }, this.vel));

    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement!);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.invalidate();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.vel.addEventListener('pointerdown', (e) => this.onVelDown(e));
    this.vel.addEventListener('pointermove', (e) => this.onVelMove(e));
    this.vel.addEventListener('pointerup', (e) => this.onVelUp(e));
    this.vel.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.vel.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.clearLaneAt(e);
    });
    this.vel.addEventListener('dblclick', (e) => this.clearLaneAt(e));

    const loop = () => {
      if (this.dirty || transport.playing) this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  refresh(): void {
    for (const c of this.toolbarControls) c.refresh();
    // Drop selections that no longer exist (undo, track switch)
    const ids = new Set(this.track()?.notes.map((n) => n.id) ?? []);
    for (const id of [...this.selected]) if (!ids.has(id)) this.selected.delete(id);
    this.clampScroll();
    this.invalidate();
  }

  /** Scroll vertically so `pitch` sits in the middle of the view. */
  scrollToPitch(pitch: number): void {
    this.scrollY = (HIGH - pitch) * ROW_H - (this.hgt - RULER_H) / 2;
    this.clampScroll();
    this.invalidate();
  }

  setChordMode(mode: ChordMode): void {
    this.settings.chord = mode;
    this.refresh();
  }

  /** Pick what the lane under the notes edits (used by the tutorial). */
  setLane(lane: NoteLane): void {
    this.settings.lane = lane;
    this.refresh();
  }

  setSnap(snap: string): void {
    this.settings.snap = snap;
    this.refresh();
  }

  invalidate(): void {
    this.dirty = true;
  }

  focus(): void {
    this.canvas.focus({ preventScroll: true });
  }

  // ── Geometry ──────────────────────────────────────────────────────────

  private track(): SynthTrack | null {
    const t = store.track;
    return t.kind === 'synth' ? t : null;
  }
  private get beats(): number {
    return store.project.bars * 4;
  }
  private get ppb(): number {
    const fit = (this.w - KEY_W) / this.beats;
    return Math.max(18, fit) * this.zoom;
  }
  private get snap(): number {
    return SNAP_OPTIONS[this.settings.snap] ?? 0.25;
  }
  private xOf(beat: number): number {
    return KEY_W + beat * this.ppb - this.scrollX;
  }
  private yOf(pitch: number): number {
    return RULER_H + (HIGH - pitch) * ROW_H - this.scrollY;
  }
  private beatAt(x: number): number {
    return (x - KEY_W + this.scrollX) / this.ppb;
  }
  private pitchAt(y: number): number {
    return HIGH - Math.floor((y - RULER_H + this.scrollY) / ROW_H);
  }
  private snapBeat(b: number, mode: 'floor' | 'round' = 'floor'): number {
    const s = this.snap;
    if (!s) return b;
    return (mode === 'floor' ? Math.floor(b / s + 1e-6) : Math.round(b / s)) * s;
  }
  private fitPitch(p: number): number {
    const pp = Math.max(LOW, Math.min(HIGH, p));
    return this.settings.scaleLock ? snapToScale(pp, store.project.key, store.project.scale) : pp;
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const body = this.canvas.parentElement!;
    this.w = body.clientWidth;
    this.hgt = body.clientHeight;
    for (const [c, ht] of [
      [this.canvas, this.hgt],
      [this.vel, VEL_H],
    ] as const) {
      c.width = Math.max(1, Math.floor(this.w * dpr));
      c.height = Math.max(1, Math.floor(ht * dpr));
      c.style.width = `${this.w}px`;
      c.style.height = `${ht}px`;
    }
    this.clampScroll();
    this.invalidate();
  }

  private clampScroll(): void {
    const contentW = this.beats * this.ppb;
    const viewW = this.w - KEY_W;
    this.scrollX = Math.max(0, Math.min(this.scrollX, Math.max(0, contentW - viewW)));
    const contentH = (HIGH - LOW + 1) * ROW_H;
    const viewH = this.hgt - RULER_H;
    this.scrollY = Math.max(0, Math.min(this.scrollY, Math.max(0, contentH - viewH)));
  }

  // ── Hit testing ───────────────────────────────────────────────────────

  private noteAt(x: number, y: number): { note: Note; edge: boolean } | null {
    const t = this.track();
    if (!t) return null;
    const pitch = this.pitchAt(y);
    for (let i = t.notes.length - 1; i >= 0; i--) {
      const n = t.notes[i];
      if (n.pitch !== pitch) continue;
      const x0 = this.xOf(n.start);
      const x1 = this.xOf(n.start + n.dur);
      if (x >= x0 && x <= x1) {
        const edgeW = Math.min(8, (x1 - x0) / 3);
        return { note: n, edge: x >= x1 - edgeW };
      }
    }
    return null;
  }

  private local(e: PointerEvent | MouseEvent | WheelEvent, el: HTMLElement = this.canvas): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ── Pointer interaction ───────────────────────────────────────────────

  private onDown(e: PointerEvent): void {
    const t = this.track();
    if (!t) return;
    this.canvas.focus({ preventScroll: true });
    const { x, y } = this.local(e);
    this.dragChanged = false;

    if (e.button === 1) {
      this.drag = { mode: 'pan', x, y, sx: this.scrollX, sy: this.scrollY };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (y < RULER_H) return;
    if (x < KEY_W) {
      previewNote(store.selected, this.pitchAt(y));
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const hit = this.noteAt(x, y);

    if (e.button === 2) {
      this.drag = { mode: 'erase' };
      if (hit) this.removeNotes([hit.note.id]);
      return;
    }

    if (hit) {
      const id = hit.note.id;
      if (e.shiftKey) {
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
      } else if (!this.selected.has(id)) {
        this.selected = new Set([id]);
      }
      if (e.altKey) {
        // Alt+drag duplicates the selection and drags the copies
        const copies = t.notes.filter((n) => this.selected.has(n.id)).map((n) => ({ ...n, id: newNoteId() }));
        t.notes.push(...copies);
        const anchorIdx = t.notes.filter((n) => this.selected.has(n.id)).findIndex((n) => n.id === id);
        this.selected = new Set(copies.map((n) => n.id));
        hit.note = copies[Math.max(0, anchorIdx)];
        this.dragChanged = true;
      }
      const orig = new Map(t.notes.filter((n) => this.selected.has(n.id)).map((n) => [n.id, { ...n }]));
      if (hit.edge) {
        this.drag = { mode: 'resize', startBeat: this.beatAt(x), orig };
      } else {
        this.drag = { mode: 'move', startBeat: this.beatAt(x), startPitch: this.pitchAt(y), orig, anchor: hit.note, lastPitch: hit.note.pitch };
        previewNote(store.selected, hit.note.pitch, hit.note.vel, 0.25);
      }
      this.invalidate();
      return;
    }

    if (e.shiftKey) {
      this.drag = { mode: 'marquee', x0: x, y0: y, x1: x, y1: y, base: new Set(this.selected) };
      return;
    }

    // Draw a new note (or chord)
    const beat = this.snapBeat(this.beatAt(x));
    if (beat < 0 || beat >= this.beats) return;
    const root = this.fitPitch(this.pitchAt(y));
    const { key, scale } = store.project;
    const pitches = buildChord(root, this.settings.chord, key, scale).filter((p) => p >= LOW && p <= HIGH);
    const len = Math.min(this.drawLen, this.beats - beat);
    const notes: Note[] = pitches.map((pitch) => ({ id: newNoteId(), pitch, start: beat, dur: len, vel: 0.8 }));
    t.notes.push(...notes);
    this.selected = new Set(notes.map((n) => n.id));
    previewChord(store.selected, pitches, 0.8, 0.3);
    this.drag = { mode: 'resize', startBeat: beat + len, orig: new Map(notes.map((n) => [n.id, { ...n }])) };
    this.dragChanged = true;
    changed('notes');
  }

  private onMove(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const t = this.track();
    const d = this.drag;
    // Show which note/position is under the cursor (helps beginners)
    const inGrid = x > KEY_W && y > RULER_H;
    this.hover = inGrid || x <= KEY_W ? { pitch: this.pitchAt(y), beat: Math.max(0, this.beatAt(x)), x, y } : null;
    if (!inGrid && this.hover) this.hover.beat = -1;
    this.invalidate();
    if (!d || !t) {
      // Hover cursor
      let cur = 'default';
      if (x > KEY_W && y > RULER_H) {
        const hit = this.noteAt(x, y);
        cur = hit ? (hit.edge ? 'ew-resize' : 'grab') : 'crosshair';
      } else if (x <= KEY_W) cur = 'pointer';
      if (cur !== this.hoverCursor) {
        this.hoverCursor = cur;
        this.canvas.style.cursor = cur;
      }
      return;
    }
    switch (d.mode) {
      case 'pan':
        this.scrollX = d.sx - (x - d.x);
        this.scrollY = d.sy - (y - d.y);
        this.clampScroll();
        this.invalidate();
        return;
      case 'erase': {
        const hit = this.noteAt(x, y);
        if (hit) this.removeNotes([hit.note.id]);
        return;
      }
      case 'marquee': {
        d.x1 = x;
        d.y1 = y;
        const b0 = this.beatAt(Math.min(d.x0, x));
        const b1 = this.beatAt(Math.max(d.x0, x));
        const p0 = this.pitchAt(Math.max(d.y0, y));
        const p1 = this.pitchAt(Math.min(d.y0, y));
        this.selected = new Set(d.base);
        for (const n of t.notes) {
          if (n.pitch >= p0 && n.pitch <= p1 && n.start < b1 && n.start + n.dur > b0) this.selected.add(n.id);
        }
        this.invalidate();
        return;
      }
      case 'move': {
        this.canvas.style.cursor = 'grabbing';
        const s = this.snap;
        let db = this.beatAt(x) - d.startBeat;
        if (s) db = Math.round(db / s) * s;
        const dp = this.pitchAt(y) - d.startPitch;
        // Keep the whole selection inside the loop
        let minStart = Infinity;
        for (const o of d.orig.values()) minStart = Math.min(minStart, o.start);
        db = Math.max(db, -minStart);
        for (const n of t.notes) {
          const o = d.orig.get(n.id);
          if (!o) continue;
          n.start = Math.min(this.beats - Math.max(s, 0.0625), o.start + db);
          n.pitch = this.settings.scaleLock && dp !== 0 ? this.fitPitch(o.pitch + dp) : Math.max(LOW, Math.min(HIGH, o.pitch + dp));
        }
        if (d.anchor.pitch !== d.lastPitch) {
          d.lastPitch = d.anchor.pitch;
          previewNote(store.selected, d.anchor.pitch, d.anchor.vel, 0.2);
        }
        this.dragChanged = true;
        changed('notes');
        return;
      }
      case 'resize': {
        const s = this.snap;
        const delta = this.beatAt(x) - d.startBeat;
        for (const n of t.notes) {
          const o = d.orig.get(n.id);
          if (!o) continue;
          let end = o.start + o.dur + delta;
          if (s) end = Math.round(end / s) * s;
          const minLen = s || 0.0625;
          n.dur = Math.max(minLen, Math.min(this.beats + 4 - o.start, end - o.start));
          this.drawLen = n.dur;
        }
        this.dragChanged = true;
        changed('notes');
        return;
      }
    }
  }

  private onUp(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const d = this.drag;
    this.drag = null;
    this.canvas.style.cursor = this.hoverCursor;
    if (d?.mode === 'move' || d?.mode === 'resize' || d?.mode === 'erase') {
      if (this.dragChanged) commit('notes');
    }
    this.invalidate();
  }

  private onDouble(e: MouseEvent): void {
    const { x, y } = this.local(e);
    const hit = this.noteAt(x, y);
    if (hit) {
      this.removeNotes([hit.note.id]);
      commit('notes');
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const { x } = this.local(e);
      const beat = this.beatAt(x);
      this.zoom = Math.max(1, Math.min(8, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.scrollX = KEY_W + beat * this.ppb - x;
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.scrollX += e.shiftKey ? e.deltaY : e.deltaX;
    } else {
      this.scrollY += e.deltaY;
    }
    this.clampScroll();
    this.invalidate();
  }

  // ── Note lane: velocity, per-note locks and trig conditions ──────────

  /** Notes whose start is under x in the lane (only selected ones if any). */
  private notesAt(x: number): Note[] {
    const t = this.track();
    if (!t) return [];
    const pool = this.selected.size ? t.notes.filter((n) => this.selected.has(n.id)) : t.notes;
    return pool.filter((n) => Math.abs(this.xOf(n.start) - x) <= Math.max(5, this.snap * this.ppb * 0.4));
  }

  private setLaneAt(e: PointerEvent): void {
    const t = this.track();
    if (!t || this.settings.lane === 'cond') return;
    const def = NOTE_LANES[this.settings.lane];
    const { x, y } = this.local(e, this.vel);
    const norm = Math.max(0, Math.min(1, 1 - (y - 6) / (VEL_H - 12)));
    const v = +(Math.round((def.min + norm * (def.max - def.min)) / def.step) * def.step).toFixed(3);
    const hits = this.notesAt(x);
    for (const n of hits) def.set(n, v, t);
    if (hits.length) {
      this.dragChanged = true;
      changed('notes');
    }
  }

  private clearLaneAt(e: MouseEvent): void {
    const t = this.track();
    if (!t) return;
    const hits = this.notesAt(this.local(e, this.vel).x);
    for (const n of hits) {
      if (this.settings.lane === 'cond') delete n.cond;
      else NOTE_LANES[this.settings.lane].set(n, undefined, t);
    }
    if (hits.length) commit('notes');
  }

  private onVelDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (this.settings.lane === 'cond') {
      // Click cycles the condition of the notes under the cursor
      const hits = this.notesAt(this.local(e, this.vel).x);
      if (!hits.length) return;
      const next = nextCond(hits[0].cond, e.shiftKey ? -1 : 1);
      for (const n of hits) {
        if (next) n.cond = next;
        else delete n.cond;
      }
      commit('notes');
      return;
    }
    this.vel.setPointerCapture(e.pointerId);
    this.drag = { mode: 'velocity' };
    this.dragChanged = false;
    this.setLaneAt(e);
  }
  private onVelMove(e: PointerEvent): void {
    if (this.drag?.mode === 'velocity') this.setLaneAt(e);
  }
  private onVelUp(e: PointerEvent): void {
    if (this.vel.hasPointerCapture(e.pointerId)) this.vel.releasePointerCapture(e.pointerId);
    if (this.drag?.mode === 'velocity' && this.dragChanged) commit('notes');
    this.drag = null;
  }

  // ── Editing commands (also used by keyboard shortcuts) ───────────────

  private removeNotes(ids: number[]): void {
    const t = this.track();
    if (!t) return;
    const set = new Set(ids);
    const before = t.notes.length;
    t.notes = t.notes.filter((n) => !set.has(n.id));
    for (const id of ids) this.selected.delete(id);
    if (t.notes.length !== before) {
      this.dragChanged = true;
      changed('notes');
    }
  }

  deleteSelected(): void {
    if (!this.selected.size) return;
    this.removeNotes([...this.selected]);
    commit('notes');
  }

  selectAll(): void {
    const t = this.track();
    if (!t) return;
    this.selected = new Set(t.notes.map((n) => n.id));
    this.invalidate();
  }

  deselect(): void {
    this.selected.clear();
    this.invalidate();
  }

  copy(): void {
    const t = this.track();
    if (!t) return;
    const sel = t.notes.filter((n) => this.selected.has(n.id));
    if (!sel.length) return;
    this.clipboard = sel.map((n) => ({ ...n }));
    this.pasteOffset = 0;
  }

  paste(): void {
    const t = this.track();
    if (!t || !this.clipboard.length) return;
    const min = Math.min(...this.clipboard.map((n) => n.start));
    const max = Math.max(...this.clipboard.map((n) => n.start + n.dur));
    const span = Math.max(1, Math.ceil((max - min) / 1 - 1e-6));
    this.pasteOffset += span;
    const notes = this.clipboard
      .map((n) => ({ ...n, id: newNoteId(), start: n.start + this.pasteOffset }))
      .filter((n) => n.start < this.beats);
    if (!notes.length) {
      this.pasteOffset = 0;
      return;
    }
    t.notes.push(...notes);
    this.selected = new Set(notes.map((n) => n.id));
    commit('notes');
  }

  duplicate(): void {
    this.copy();
    this.paste();
  }

  transpose(semis: number): void {
    const t = this.track();
    if (!t || !this.selected.size) return;
    for (const n of t.notes) {
      if (!this.selected.has(n.id)) continue;
      let p = n.pitch + semis;
      if (this.settings.scaleLock && Math.abs(semis) === 1) {
        // Step through scale degrees instead of semitones
        p = n.pitch;
        do p += semis;
        while (!inScale(p, store.project.key, store.project.scale) && Math.abs(p - n.pitch) < 12);
      }
      n.pitch = Math.max(LOW, Math.min(HIGH, p));
    }
    const first = t.notes.find((n) => this.selected.has(n.id));
    if (first) previewNote(store.selected, first.pitch, first.vel, 0.2);
    commit('notes');
  }

  nudge(dir: number): void {
    const t = this.track();
    if (!t || !this.selected.size) return;
    const s = this.snap || 0.25;
    for (const n of t.notes) if (this.selected.has(n.id)) n.start = Math.max(0, Math.min(this.beats - s, n.start + dir * s));
    commit('notes');
  }

  quantize(): void {
    const t = this.track();
    if (!t) return;
    const s = this.snap || 0.25;
    const pool = this.selected.size ? t.notes.filter((n) => this.selected.has(n.id)) : t.notes;
    for (const n of pool) {
      n.start = Math.round(n.start / s) * s;
      n.dur = Math.max(s, Math.round(n.dur / s) * s);
    }
    commit('notes');
  }

  clearAll(): void {
    const t = this.track();
    if (!t || !t.notes.length) return;
    t.notes = [];
    this.selected.clear();
    commit('notes');
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  private draw(): void {
    this.dirty = false;
    const g = this.g;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = (n: string) => css.getPropertyValue(n).trim();
    const W = this.w;
    const H = this.hgt;
    const t = this.track();
    const { key, scale } = store.project;
    const beats = this.beats;
    const ppb = this.ppb;
    const accent = t?.color ?? col('--accent');

    g.fillStyle = col('--roll-bg');
    g.fillRect(0, 0, W, H);

    // Rows
    const pTop = this.pitchAt(RULER_H + 1);
    const pBot = Math.max(LOW, this.pitchAt(H - 1));
    for (let p = Math.min(HIGH, pTop); p >= pBot; p--) {
      const y = this.yOf(p);
      const isIn = inScale(p, key, scale);
      const isRoot = (((p - key) % 12) + 12) % 12 === 0;
      g.fillStyle = isRoot ? col('--roll-root') : isIn ? col('--roll-in') : col('--roll-out');
      g.fillRect(KEY_W, y, W - KEY_W, ROW_H);
      g.fillStyle = col('--roll-line');
      g.fillRect(KEY_W, y + ROW_H - 1, W - KEY_W, 1);
    }

    // Vertical grid
    const s = this.snap;
    const sub = s && s * ppb >= 7 ? s : ppb * 0.25 >= 7 ? 0.25 : 1;
    for (let b = 0; b <= beats + 1e-6; b += sub) {
      const x = Math.round(this.xOf(b)) + 0.5;
      if (x < KEY_W || x > W) continue;
      const isBar = Math.abs(b / 4 - Math.round(b / 4)) < 1e-6;
      const isBeat = Math.abs(b - Math.round(b)) < 1e-6;
      g.strokeStyle = isBar ? col('--roll-bar') : isBeat ? col('--roll-beat') : col('--roll-sub');
      g.beginPath();
      g.moveTo(x, RULER_H);
      g.lineTo(x, H);
      g.stroke();
    }
    // Area after the loop end
    const endX = this.xOf(beats);
    if (endX < W) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(endX, RULER_H, W - endX, H - RULER_H);
    }

    // Ghost notes from other tracks
    if (this.settings.ghosts) {
      store.project.tracks.forEach((tr, i) => {
        if (tr.kind !== 'synth' || i === store.selected) return;
        g.strokeStyle = hexA(tr.color, 0.45);
        g.lineWidth = 1;
        for (const n of tr.notes) {
          const x = this.xOf(n.start);
          const y = this.yOf(n.pitch);
          if (y < RULER_H - ROW_H || y > H || x > W) continue;
          g.strokeRect(x + 0.5, y + 2.5, Math.max(2, n.dur * ppb - 1), ROW_H - 5);
        }
      });
    }

    // Notes
    if (t) {
      g.font = '600 9px Inter, system-ui, sans-serif';
      g.textBaseline = 'middle';
      for (const n of t.notes) {
        const x = this.xOf(n.start);
        const y = this.yOf(n.pitch);
        const w = Math.max(3, n.dur * ppb - 1);
        if (y < RULER_H - ROW_H || y > H || x + w < KEY_W || x > W) continue;
        const sel = this.selected.has(n.id);
        g.fillStyle = hexA(accent, 0.45 + n.vel * 0.55);
        roundRect(g, x, y + 1, w, ROW_H - 2, 3);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x + 1, y + 2, Math.max(1, w - 2), 2);
        if (sel) {
          g.strokeStyle = '#fff';
          g.lineWidth = 1.5;
          roundRect(g, x + 0.75, y + 1.75, w - 1.5, ROW_H - 3.5, 3);
          g.stroke();
        } else if (hasTrig(n)) {
          // Notes that don't play on every pass get a dashed outline
          g.save();
          g.setLineDash([3, 2]);
          g.strokeStyle = 'rgba(255,255,255,0.85)';
          g.lineWidth = 1;
          roundRect(g, x + 0.5, y + 1.5, w - 1, ROW_H - 3, 3);
          g.stroke();
          g.restore();
        }
        if (w > 26) {
          g.fillStyle = 'rgba(10,12,16,0.85)';
          g.fillText(NOTE_NAMES[n.pitch % 12] + (Math.floor(n.pitch / 12) - 1), x + 4, y + ROW_H / 2 + 0.5);
        }
      }
    }

    // Hovered row
    const hv = this.hover;
    if (hv) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(KEY_W, this.yOf(hv.pitch), W - KEY_W, ROW_H);
    }

    // Marquee
    const d = this.drag;
    if (d?.mode === 'marquee') {
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = 1;
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      g.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }

    // Playhead
    const pos = transport.position();
    if (pos !== null) {
      const x = this.xOf(pos);
      if (x >= KEY_W && x <= W) {
        g.fillStyle = col('--playhead');
        g.fillRect(Math.round(x), 0, 2, H);
      }
    }

    // Ruler
    g.fillStyle = col('--panel-2');
    g.fillRect(KEY_W, 0, W - KEY_W, RULER_H);
    g.fillStyle = col('--muted');
    g.font = '600 10px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (let bar = 0; bar < store.project.bars; bar++) {
      const x = this.xOf(bar * 4);
      if (x > W) break;
      if (x + 4 * ppb < KEY_W) continue;
      g.fillText(String(bar + 1), x + 5, RULER_H / 2);
      for (let b = 1; b < 4; b++) {
        const bx = Math.round(this.xOf(bar * 4 + b)) + 0.5;
        g.fillStyle = col('--roll-beat');
        g.fillRect(bx, RULER_H - 6, 1, 6);
        g.fillStyle = col('--muted');
      }
      g.fillStyle = col('--roll-bar');
      g.fillRect(Math.round(x), 0, 1, RULER_H);
      g.fillStyle = col('--muted');
    }
    g.fillStyle = col('--border');
    g.fillRect(KEY_W, RULER_H - 1, W - KEY_W, 1);

    // Keyboard
    g.fillStyle = col('--panel');
    g.fillRect(0, 0, KEY_W, H);
    for (let p = Math.min(HIGH, pTop); p >= pBot; p--) {
      const y = this.yOf(p);
      const black = [1, 3, 6, 8, 10].includes(p % 12);
      const isIn = inScale(p, key, scale);
      g.fillStyle = black ? '#262a33' : '#d9dce3';
      g.fillRect(0, y, KEY_W - 2, ROW_H - 1);
      if (isIn && scale !== 'chromatic') {
        g.fillStyle = accent;
        g.fillRect(KEY_W - 6, y + 1, 4, ROW_H - 3);
      }
      if (hv && hv.pitch === p) {
        g.fillStyle = hexA(accent, 0.55);
        g.fillRect(0, y, KEY_W - 2, ROW_H - 1);
      }
      // Every key is labelled so beginners can find notes by name
      g.fillStyle = black ? '#aeb3bf' : '#3a3f4b';
      g.font = p % 12 === 0 ? '700 9px Inter, system-ui, sans-serif' : '500 8.5px Inter, system-ui, sans-serif';
      g.fillText(NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1), 5, y + ROW_H / 2);
    }
    g.fillStyle = col('--panel-2');
    g.fillRect(0, 0, KEY_W, RULER_H);

    // Cursor readout: note name and bar.beat position
    if (hv && hv.pitch >= LOW && hv.pitch <= HIGH) {
      const label =
        hv.beat >= 0
          ? `${NOTE_NAMES[hv.pitch % 12]}${Math.floor(hv.pitch / 12) - 1} · bar ${Math.floor(hv.beat / 4) + 1}.${Math.floor(hv.beat % 4) + 1}`
          : `${NOTE_NAMES[hv.pitch % 12]}${Math.floor(hv.pitch / 12) - 1}`;
      g.font = '600 10px Inter, system-ui, sans-serif';
      const tw = g.measureText(label).width + 12;
      let lx = hv.x + 14;
      let ly = hv.y - 24;
      if (lx + tw > W) lx = hv.x - tw - 8;
      if (ly < RULER_H) ly = hv.y + 14;
      g.fillStyle = 'rgba(12,14,18,0.92)';
      roundRect(g, lx, ly, tw, 18, 4);
      g.fill();
      g.fillStyle = '#fff';
      g.fillText(label, lx + 6, ly + 9.5);
    }

    this.drawVelocity(accent, col);
  }

  private drawVelocity(accent: string, col: (n: string) => string): void {
    const g = this.vg;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = this.w;
    const lane = this.settings.lane;
    g.fillStyle = col('--panel');
    g.fillRect(0, 0, W, VEL_H);
    g.fillStyle = col('--muted');
    g.font = '600 9px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(lane === 'cond' ? 'COND' : NOTE_LANES[lane].label, 6, 12);
    g.fillStyle = col('--dim');
    g.font = '500 8px Inter, system-ui, sans-serif';
    g.fillText(lane === 'cond' ? 'click' : 'drag', 6, 26);
    const tip =
      lane === 'vel'
        ? 'Drag to set how hard each note plays'
        : lane === 'cond'
          ? 'Click a note to choose on which passes it plays (A:B = pass A of every B). Right-click clears.'
          : `Drag to lock ${NOTE_LANES[lane].label.toLowerCase()} per note. Right-click or double-click resets to the patch.`;
    if (this.vel.title !== tip) this.vel.title = tip;
    g.fillStyle = col('--roll-line');
    g.fillRect(KEY_W, VEL_H / 2, W - KEY_W, 1);
    const t = this.track();
    if (!t) return;
    g.save();
    g.beginPath();
    g.rect(KEY_W, 0, W - KEY_W, VEL_H);
    g.clip();
    const span = VEL_H - 12;
    for (const n of t.notes) {
      const x = this.xOf(n.start);
      if (x < KEY_W - 4 || x > W) continue;
      const sel = this.selected.has(n.id);
      if (lane === 'cond') {
        if (!n.cond && !sel) continue;
        g.fillStyle = sel ? '#fff' : hexA(accent, 0.9);
        g.font = '700 10px JetBrains Mono, monospace';
        g.fillText(condLabel(n.cond).replace('Always', '·'), x + 2, VEL_H / 2 + 0.5);
        continue;
      }
      const def = NOTE_LANES[lane];
      const v = def.get(n, t);
      const norm = (v - def.min) / (def.max - def.min);
      const locked = def.locked(n);
      const top = 6 + (1 - norm) * span;
      const base = def.bipolar ? 6 + (1 - (0 - def.min) / (def.max - def.min)) * span : VEL_H - 6;
      g.fillStyle = sel ? '#fff' : hexA(accent, locked ? 0.9 : 0.3);
      g.fillRect(Math.round(x), Math.min(top, base), 2, Math.max(1, Math.abs(base - top)));
      g.beginPath();
      g.arc(x + 1, top, locked ? 3 : 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

export function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

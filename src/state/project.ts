// Project defaults, the demo song, and the global store with undo/redo and
// autosave.

import type { DrumSound, DrumTrack, DrumVoice, Note, Patch, Project, SynthTrack, Track } from './types';
import { defaultFx, findPreset, initPatch } from './presets';

export const TRACK_COLORS = ['#ff7a45', '#36cfc9', '#9b7bff', '#ffc53d', '#f759ab'];
const DRUM_KEYS: DrumVoice[] = ['kick', 'snare', 'clap', 'chh', 'ohh', 'tom', 'rim', 'perc'];

let nextNoteId = 1;
export function newNoteId(): number {
  return nextNoteId++;
}

function synthTrack(name: string, color: string, preset: string, notes: Omit<Note, 'id'>[] = []): SynthTrack {
  return {
    kind: 'synth',
    name,
    color,
    patch: findPreset(preset),
    notes: notes.map((n) => ({ ...n, id: newNoteId() })),
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
  };
}

function emptyPattern(steps: number): Record<DrumVoice, number[]> {
  const out = {} as Record<DrumVoice, number[]>;
  for (const k of DRUM_KEYS) out[k] = new Array(steps).fill(0);
  return out;
}

function drumTrack(pattern?: Partial<Record<DrumVoice, number[]>>): DrumTrack {
  const sounds = {} as Record<DrumVoice, DrumSound>;
  for (const k of DRUM_KEYS) sounds[k] = { tune: 0, decay: 1, level: 0.8 };
  const fx = defaultFx();
  fx.reverb = { on: true, size: 0.25, damp: 0.6, mix: 0.08 };
  return {
    kind: 'drums',
    name: 'Drums',
    color: TRACK_COLORS[4],
    steps: 16,
    pattern: { ...emptyPattern(16), ...pattern },
    sounds,
    fx,
    volume: 0.85,
    pan: 0,
    mute: false,
    solo: false,
  };
}

/** Turn a list of step indices into a 16-step row (accent = 2). */
function row(on: number[], accents: number[] = []): number[] {
  const r = new Array(16).fill(0);
  for (const i of on) r[i] = 1;
  for (const i of accents) r[i] = 2;
  return r;
}

export function blankProject(): Project {
  return {
    version: 1,
    name: 'Untitled loop',
    bpm: 100,
    bars: 4,
    swing: 0,
    key: 9,
    scale: 'minor',
    tracks: [
      synthTrack('Lead', TRACK_COLORS[0], 'Soft Sine Lead'),
      synthTrack('Bass', TRACK_COLORS[1], 'Analog Bass'),
      synthTrack('Pad', TRACK_COLORS[2], 'Warm Pad'),
      synthTrack('Keys', TRACK_COLORS[3], 'Electric Piano'),
      drumTrack(),
    ],
    master: { volume: 0.8, glue: 0.3 },
  };
}

export function demoProject(): Project {
  const chords = [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [55, 60, 64], // C
    [55, 59, 62], // G
  ];
  const roots = [45, 41, 48, 43];
  const arps = [
    [69, 72, 76, 72, 69, 72, 76, 79],
    [65, 69, 72, 69, 65, 69, 72, 77],
    [67, 72, 76, 72, 67, 72, 76, 79],
    [67, 71, 74, 71, 67, 71, 74, 79],
  ];
  const pad: Omit<Note, 'id'>[] = [];
  const bass: Omit<Note, 'id'>[] = [];
  const arp: Omit<Note, 'id'>[] = [];
  chords.forEach((c, bar) => {
    for (const pitch of c) pad.push({ pitch, start: bar * 4, dur: 4, vel: 0.7 });
    const r = roots[bar];
    const bassLine: [number, number, number][] = [
      [0, 0.75, 0],
      [1.5, 0.5, 0],
      [2, 0.75, 0],
      [3, 0.5, 0],
      [3.5, 0.5, 12],
    ];
    for (const [s, d, o] of bassLine) bass.push({ pitch: r + o, start: bar * 4 + s, dur: d, vel: s === 0 ? 0.9 : 0.7 });
    arps[bar].forEach((pitch, i) => arp.push({ pitch, start: bar * 4 + i * 0.5, dur: 0.45, vel: i % 2 ? 0.6 : 0.8 }));
  });
  const p = blankProject();
  p.name = 'Demo loop';
  p.bpm = 92;
  p.tracks = [
    synthTrack('Arp', TRACK_COLORS[0], 'Classic Pluck', arp),
    synthTrack('Bass', TRACK_COLORS[1], 'Analog Bass', bass),
    synthTrack('Pad', TRACK_COLORS[2], 'Warm Pad', pad),
    synthTrack('Lead', TRACK_COLORS[3], 'Soft Sine Lead'),
    drumTrack({
      kick: row([0, 7, 8], [0, 8]),
      snare: row([4, 12], [4, 12]),
      chh: row([0, 2, 4, 6, 8, 10, 12], [2, 6, 10]),
      ohh: row([14]),
      rim: row([15]),
    }),
  ];
  (p.tracks[0] as SynthTrack).volume = 0.6;
  (p.tracks[2] as SynthTrack).volume = 0.7;
  return p;
}

// ── Loading old/foreign files safely ────────────────────────────────────

function fill<T>(base: T, value: unknown): T {
  if (value === undefined || value === null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return (typeof value === typeof base ? value : base) as T;
  }
  const out = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(out)) out[k] = fill(out[k], (value as Record<string, unknown>)[k]);
  return out as T;
}

export function normalizePatch(raw: unknown): Patch {
  return fill(initPatch(), raw);
}

export function normalizeProject(raw: unknown): Project {
  const r = raw as Partial<Project>;
  if (!r || !Array.isArray(r.tracks)) throw new Error('Not a LoopForge project file');
  const base = blankProject();
  const tracks: Track[] = r.tracks.map((t, i) => {
    if (t.kind === 'drums') {
      const d = fill(drumTrack(), t);
      d.steps = t.steps === 32 ? 32 : 16;
      for (const k of DRUM_KEYS) {
        const src = (t as DrumTrack).pattern?.[k] ?? [];
        d.pattern[k] = Array.from({ length: d.steps }, (_, j) => (src[j] === 2 ? 2 : src[j] ? 1 : 0));
      }
      return d;
    }
    const s = fill(synthTrack('Track', TRACK_COLORS[i % 5], 'Init'), t);
    s.patch = normalizePatch((t as SynthTrack).patch);
    s.notes = ((t as SynthTrack).notes ?? []).map((n) => ({
      id: newNoteId(),
      pitch: Math.round(n.pitch),
      start: +n.start,
      dur: Math.max(0.01, +n.dur),
      vel: Math.min(1, Math.max(0, +n.vel)),
    }));
    return s;
  });
  return {
    ...fill(base, { ...r, tracks: undefined }),
    version: 1,
    tracks,
  };
}

// ── Store ────────────────────────────────────────────────────────────────

export type ChangeKind = 'all' | 'notes' | 'params' | 'mixer' | 'transport' | 'select';
type Listener = (kind: ChangeKind) => void;

const LS_PROJECT = 'loopforge.project.v1';
const LS_PRESETS = 'loopforge.userPresets.v1';

class Store {
  project: Project;
  selected = 0;
  private listeners = new Set<Listener>();
  private history: string[] = [];
  private index = 0;
  private saveTimer: number | null = null;

  constructor() {
    this.project = this.restore() ?? demoProject();
    this.history = [JSON.stringify(this.project)];
  }

  get track(): Track {
    return this.project.tracks[this.selected] ?? this.project.tracks[0];
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind: ChangeKind): void {
    for (const fn of this.listeners) fn(kind);
  }

  select(i: number): void {
    this.selected = Math.max(0, Math.min(this.project.tracks.length - 1, i));
    this.emit('select');
  }

  /** Record the current state as an undo step (call after an edit finishes). */
  commit(): void {
    const snap = JSON.stringify(this.project);
    if (snap === this.history[this.index]) return;
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(snap);
    if (this.history.length > 200) this.history.shift();
    this.index = this.history.length - 1;
    this.scheduleSave();
  }

  canUndo(): boolean {
    return this.index > 0;
  }
  canRedo(): boolean {
    return this.index < this.history.length - 1;
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.index--;
    this.project = JSON.parse(this.history[this.index]);
    this.afterRestore();
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.index++;
    this.project = JSON.parse(this.history[this.index]);
    this.afterRestore();
  }

  /** Replace the whole project (new / open file). Undoable. */
  load(p: Project): void {
    this.project = p;
    this.selected = 0;
    this.commit();
    this.emit('all');
  }

  private afterRestore(): void {
    this.reseedIds();
    this.selected = Math.min(this.selected, this.project.tracks.length - 1);
    this.scheduleSave();
    this.emit('all');
  }

  private reseedIds(): void {
    let max = 0;
    for (const t of this.project.tracks) if (t.kind === 'synth') for (const n of t.notes) max = Math.max(max, n.id);
    nextNoteId = Math.max(nextNoteId, max + 1);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_PROJECT, JSON.stringify(this.project));
      } catch {
        /* storage unavailable or full: autosave is best effort */
      }
    }, 400);
  }

  private restore(): Project | null {
    try {
      const raw = localStorage.getItem(LS_PROJECT);
      if (raw) return normalizeProject(JSON.parse(raw));
    } catch {
      /* corrupt or unavailable */
    }
    return null;
  }

  // User presets live in the browser, shared by all projects.
  userPresets(): Patch[] {
    try {
      const raw = localStorage.getItem(LS_PRESETS);
      if (raw) return (JSON.parse(raw) as unknown[]).map(normalizePatch);
    } catch {
      /* ignore */
    }
    return [];
  }

  saveUserPreset(patch: Patch): boolean {
    const list = this.userPresets().filter((x) => x.name !== patch.name);
    list.push(structuredClone(patch));
    try {
      localStorage.setItem(LS_PRESETS, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  }

  deleteUserPreset(name: string): void {
    const list = this.userPresets().filter((x) => x.name !== name);
    try {
      localStorage.setItem(LS_PRESETS, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }
}

export const store = new Store();

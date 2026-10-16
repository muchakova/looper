// Data model for a LoopForge project. Everything here is plain JSON so it can be
// saved, loaded and snapshotted for undo/redo.

export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'pulse';
export type LfoWave = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type LfoTarget = 'off' | 'pitch' | 'cutoff' | 'volume' | 'pan';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export interface Osc {
  on: boolean;
  wave: Wave;
  octave: number; // -3..3
  semi: number; // -12..12
  fine: number; // cents -100..100
  level: number; // 0..1
  pw: number; // pulse width 0.05..0.95 (pulse wave only)
}

export interface Env {
  a: number; // seconds
  d: number;
  s: number; // 0..1
  r: number;
}

export interface Lfo {
  wave: LfoWave;
  rate: string; // tempo division, see LFO_RATES
  target: LfoTarget;
  amount: number; // 0..1
}

export interface Fx {
  drive: { on: boolean; amount: number; tone: number; mix: number };
  chorus: { on: boolean; rate: number; depth: number; mix: number };
  delay: { on: boolean; time: string; feedback: number; mix: number; pingpong: boolean };
  reverb: { on: boolean; size: number; damp: number; mix: number };
  eq: { low: number; mid: number; high: number }; // dB
}

export interface Patch {
  name: string;
  category: string;
  osc1: Osc;
  osc2: Osc;
  sub: { level: number; octave: number; wave: 'sine' | 'square' };
  noise: { level: number };
  unison: { voices: number; detune: number; width: number };
  filter: {
    type: FilterType;
    slope: 12 | 24;
    cutoff: number; // Hz
    res: number; // Q 0.1..20
    drive: number; // 0..1
    envAmt: number; // octaves -6..6
    keyTrack: number; // 0..1
  };
  ampEnv: Env;
  filtEnv: Env;
  lfo1: Lfo;
  lfo2: Lfo;
  voice: { mode: 'poly' | 'mono'; glide: number; velSens: number };
  gain: number; // 0..1
  fx: Fx;
}

/**
 * Trig condition: play on pass A of every B passes through the loop
 * (Elektron style, e.g. [2, 4] = the 2nd of every 4 repetitions).
 */
export type Cond = [number, number];

/** Settings shared by drum steps and synth notes that decide if they play. */
export interface TrigParams {
  chance?: number; // 0..100 %, default 100
  cond?: Cond;
}

export interface Note extends TrigParams {
  id: number;
  pitch: number; // MIDI note number
  start: number; // beats from loop start
  dur: number; // beats
  vel: number; // 0..1
  // Per-note sound overrides ("parameter locks")
  cutoff?: number; // octaves relative to the patch cutoff, -4..4
  res?: number; // filter Q 0.1..20, replaces the patch value
  pan?: number; // -1..1
}

/** Per-step overrides for a drum hit ("parameter locks" + trig settings). */
export interface StepParams extends TrigParams {
  tune?: number; // semitones -24..24
  decay?: number; // multiplier 0.2..3
  level?: number; // 0..1
  pan?: number; // -1..1
  ratchet?: number; // 1..4 hits inside the step
  nudge?: number; // -0.45..0.45 of a step (micro-timing)
}

export interface Channel {
  volume: number; // 0..1.2
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
}

export interface SynthTrack extends Channel {
  kind: 'synth';
  name: string;
  color: string;
  patch: Patch;
  notes: Note[];
}

export type DrumVoice = 'kick' | 'snare' | 'clap' | 'chh' | 'ohh' | 'tom' | 'rim' | 'perc';

export interface DrumSound {
  tune: number; // semitones -12..12
  decay: number; // multiplier 0.2..3
  level: number; // 0..1
}

export interface DrumTrack extends Channel {
  kind: 'drums';
  name: string;
  color: string;
  steps: number; // pattern length in 16th steps: 16, 32, 64 … 512
  pattern: Record<DrumVoice, number[]>; // 0 off, 1 normal, 2 accent
  /** Sparse per-step overrides: voice → step index → params. */
  locks?: Partial<Record<DrumVoice, Record<number, StepParams>>>;
  sounds: Record<DrumVoice, DrumSound>;
  fx: Fx;
}

export type Track = SynthTrack | DrumTrack;

export interface Project {
  version: 1;
  name: string;
  bpm: number;
  bars: number; // loop length 1, 2, 4, 8
  swing: number; // 0..1
  key: number; // 0 = C .. 11 = B
  scale: string; // see SCALES
  tracks: Track[];
  master: { volume: number; glue: number };
}

// Factory presets. Each preset is a set of overrides on top of the init patch.

import type { Fx, Patch } from './types';

export function defaultFx(): Fx {
  return {
    drive: { on: false, amount: 0.3, tone: 0.7, mix: 1 },
    chorus: { on: false, rate: 0.6, depth: 0.5, mix: 0.4 },
    delay: { on: false, time: '1/8.', feedback: 0.35, mix: 0.25, pingpong: true },
    reverb: { on: false, size: 0.4, damp: 0.5, mix: 0.25 },
    eq: { low: 0, mid: 0, high: 0 },
  };
}

export function initPatch(): Patch {
  return {
    name: 'Init',
    category: 'Init',
    osc1: { on: true, wave: 'sawtooth', octave: 0, semi: 0, fine: 0, level: 0.8, pw: 0.5 },
    osc2: { on: false, wave: 'square', octave: 0, semi: 0, fine: 7, level: 0.5, pw: 0.5 },
    sub: { level: 0, octave: -1, wave: 'sine' },
    noise: { level: 0 },
    unison: { voices: 1, detune: 15, width: 0.6 },
    filter: { type: 'lowpass', slope: 24, cutoff: 6000, res: 0.8, drive: 0, envAmt: 0, keyTrack: 0.3 },
    ampEnv: { a: 0.005, d: 0.3, s: 0.8, r: 0.2 },
    filtEnv: { a: 0.005, d: 0.3, s: 0.3, r: 0.3 },
    lfo1: { wave: 'sine', rate: '1/4', target: 'off', amount: 0.3 },
    lfo2: { wave: 'triangle', rate: '1 bar', target: 'off', amount: 0.3 },
    voice: { mode: 'poly', glide: 0.08, velSens: 0.5 },
    gain: 0.7,
    fx: defaultFx(),
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T>(base: T, over: DeepPartial<T>): T {
  const out = structuredClone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = merge(out[k] as object, v as DeepPartial<object>);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

function p(name: string, category: string, over: DeepPartial<Patch>): Patch {
  return merge(initPatch(), { ...over, name, category });
}

export const CATEGORIES = ['Bass', 'Lead', 'Pad', 'Pluck', 'Keys', 'Brass & Strings', 'Rock', 'Lo-fi', 'Ambient & FX'];

export const FACTORY_PRESETS: Patch[] = [
  // ── Bass ────────────────────────────────────────────────────────────
  p('Deep Sub', 'Bass', {
    osc1: { wave: 'sine', level: 0.9 },
    sub: { level: 0.4, wave: 'sine' },
    filter: { cutoff: 900, res: 0.5, keyTrack: 0 },
    ampEnv: { a: 0.004, d: 0.4, s: 0.9, r: 0.12 },
    voice: { mode: 'mono', glide: 0.03, velSens: 0.3 },
    gain: 0.85,
  }),
  p('Analog Bass', 'Bass', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'square', octave: -1, fine: 0, level: 0.5 },
    filter: { cutoff: 380, res: 3, envAmt: 2.6, keyTrack: 0.4, drive: 0.25 },
    filtEnv: { a: 0.002, d: 0.22, s: 0.15, r: 0.15 },
    ampEnv: { a: 0.003, d: 0.3, s: 0.85, r: 0.1 },
    voice: { mode: 'mono', glide: 0.04, velSens: 0.5 },
    gain: 0.8,
  }),
  p('Acid 303', 'Bass', {
    osc1: { wave: 'sawtooth', level: 0.9 },
    filter: { slope: 24, cutoff: 300, res: 11, envAmt: 3.4, keyTrack: 0.5, drive: 0.5 },
    filtEnv: { a: 0.002, d: 0.18, s: 0.05, r: 0.1 },
    ampEnv: { a: 0.002, d: 0.3, s: 0.8, r: 0.06 },
    voice: { mode: 'mono', glide: 0.07, velSens: 0.8 },
    fx: { delay: { on: true, time: '1/8.', feedback: 0.3, mix: 0.15 } },
    gain: 0.7,
  }),
  p('Reese', 'Bass', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'sawtooth', fine: 18, level: 0.8 },
    unison: { voices: 3, detune: 22, width: 0.3 },
    sub: { level: 0.5 },
    filter: { cutoff: 700, res: 1.5, keyTrack: 0.2 },
    lfo1: { target: 'cutoff', rate: '1/2', amount: 0.25, wave: 'sine' },
    voice: { mode: 'mono', glide: 0.05 },
    gain: 0.65,
  }),
  p('Pluck Bass', 'Bass', {
    osc1: { wave: 'square', level: 0.8, pw: 0.35 },
    sub: { level: 0.45 },
    filter: { cutoff: 220, res: 2, envAmt: 3.5, keyTrack: 0.5 },
    filtEnv: { a: 0.001, d: 0.14, s: 0, r: 0.1 },
    ampEnv: { a: 0.002, d: 0.35, s: 0.25, r: 0.1 },
    voice: { mode: 'mono', glide: 0.0 },
    gain: 0.85,
  }),
  p('Synthwave Bass', 'Bass', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'sawtooth', octave: -1, fine: -6, level: 0.5 },
    filter: { cutoff: 500, res: 2.5, envAmt: 2.2, keyTrack: 0.3 },
    filtEnv: { a: 0.002, d: 0.16, s: 0.2, r: 0.1 },
    ampEnv: { a: 0.002, d: 0.2, s: 0.7, r: 0.08 },
    fx: { chorus: { on: true, mix: 0.25 } },
    gain: 0.75,
  }),

  // ── Lead ────────────────────────────────────────────────────────────
  p('Supersaw Lead', 'Lead', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'sawtooth', octave: 1, level: 0.3 },
    unison: { voices: 7, detune: 28, width: 0.9 },
    filter: { cutoff: 7000, res: 0.7, keyTrack: 0.3 },
    ampEnv: { a: 0.01, d: 0.3, s: 0.85, r: 0.3 },
    fx: { delay: { on: true, time: '1/8.', feedback: 0.35, mix: 0.2 }, reverb: { on: true, size: 0.5, mix: 0.2 } },
    gain: 0.65,
  }),
  p('Square Lead', 'Lead', {
    osc1: { wave: 'square', level: 0.8 },
    osc2: { on: true, wave: 'square', fine: 8, level: 0.4 },
    filter: { cutoff: 3500, res: 1.2, envAmt: 1, keyTrack: 0.4 },
    filtEnv: { a: 0.01, d: 0.4, s: 0.5, r: 0.3 },
    lfo1: { target: 'pitch', rate: '1/8', amount: 0.18, wave: 'sine' },
    voice: { mode: 'mono', glide: 0.06 },
    fx: { delay: { on: true, time: '1/4', feedback: 0.3, mix: 0.2 } },
    gain: 0.65,
  }),
  p('Sync-ish Lead', 'Lead', {
    osc1: { wave: 'sawtooth', level: 0.7 },
    osc2: { on: true, wave: 'pulse', octave: 1, semi: 7, pw: 0.2, level: 0.45 },
    filter: { cutoff: 2400, res: 4, envAmt: 2, keyTrack: 0.5, drive: 0.3 },
    filtEnv: { a: 0.005, d: 0.25, s: 0.4, r: 0.2 },
    voice: { mode: 'mono', glide: 0.05 },
    fx: { delay: { on: true, time: '1/8', feedback: 0.25, mix: 0.18 } },
    gain: 0.55,
  }),
  p('Soft Sine Lead', 'Lead', {
    osc1: { wave: 'sine', level: 0.9 },
    osc2: { on: true, wave: 'triangle', octave: 1, level: 0.2 },
    ampEnv: { a: 0.03, d: 0.3, s: 0.8, r: 0.35 },
    lfo1: { target: 'pitch', rate: '1/8T', amount: 0.15 },
    voice: { mode: 'mono', glide: 0.09, velSens: 0.4 },
    fx: { delay: { on: true, time: '1/4.', feedback: 0.35, mix: 0.25 }, reverb: { on: true, size: 0.55, mix: 0.25 } },
    gain: 0.7,
  }),
  p('Chip Lead', 'Lead', {
    osc1: { wave: 'pulse', pw: 0.25, level: 0.8 },
    filter: { cutoff: 12000, res: 0.5, keyTrack: 0 },
    ampEnv: { a: 0.001, d: 0.1, s: 0.8, r: 0.05 },
    lfo1: { target: 'pitch', rate: '1/16', amount: 0.12, wave: 'square' },
    voice: { mode: 'mono', glide: 0, velSens: 0.2 },
    gain: 0.7,
  }),

  // ── Pad ─────────────────────────────────────────────────────────────
  p('Warm Pad', 'Pad', {
    osc1: { wave: 'sawtooth', level: 0.7 },
    osc2: { on: true, wave: 'sawtooth', fine: -9, level: 0.6 },
    unison: { voices: 3, detune: 18, width: 0.8 },
    filter: { cutoff: 1600, res: 0.8, envAmt: 1, keyTrack: 0.2 },
    filtEnv: { a: 1.2, d: 1.5, s: 0.5, r: 1.5 },
    ampEnv: { a: 0.9, d: 1, s: 0.85, r: 1.6 },
    lfo1: { target: 'cutoff', rate: '2 bars', amount: 0.2 },
    fx: { chorus: { on: true, mix: 0.35 }, reverb: { on: true, size: 0.7, mix: 0.35 } },
    gain: 0.45,
  }),
  p('Glass Pad', 'Pad', {
    osc1: { wave: 'triangle', level: 0.7 },
    osc2: { on: true, wave: 'pulse', octave: 1, pw: 0.15, level: 0.3, fine: 6 },
    unison: { voices: 3, detune: 12, width: 0.9 },
    filter: { cutoff: 5000, res: 1.5, keyTrack: 0.4 },
    ampEnv: { a: 0.6, d: 1.2, s: 0.7, r: 2 },
    lfo1: { target: 'volume', rate: '1/8', amount: 0.15 },
    fx: { delay: { on: true, time: '1/4.', feedback: 0.4, mix: 0.2 }, reverb: { on: true, size: 0.8, mix: 0.4 } },
    gain: 0.6,
  }),
  p('Dark Strings Pad', 'Pad', {
    osc1: { wave: 'sawtooth', level: 0.7 },
    unison: { voices: 5, detune: 20, width: 1 },
    filter: { cutoff: 900, res: 0.6, keyTrack: 0.3 },
    ampEnv: { a: 1.5, d: 1, s: 0.9, r: 2.2 },
    lfo1: { target: 'pitch', rate: '1/4T', amount: 0.08 },
    fx: { chorus: { on: true, mix: 0.3 }, reverb: { on: true, size: 0.85, damp: 0.7, mix: 0.4 }, eq: { low: -2 } },
    gain: 0.7,
  }),
  p('Breathing Pad', 'Pad', {
    osc1: { wave: 'sawtooth', level: 0.6 },
    osc2: { on: true, wave: 'square', octave: -1, level: 0.4 },
    noise: { level: 0.1 },
    unison: { voices: 3, detune: 16, width: 0.8 },
    filter: { cutoff: 700, res: 2, keyTrack: 0.2 },
    ampEnv: { a: 0.5, d: 1, s: 0.9, r: 1.5 },
    lfo1: { target: 'cutoff', rate: '1 bar', amount: 0.45, wave: 'triangle' },
    lfo2: { target: 'pan', rate: '2 bars', amount: 0.4 },
    fx: { reverb: { on: true, size: 0.7, mix: 0.35 } },
    gain: 0.5,
  }),

  // ── Pluck ───────────────────────────────────────────────────────────
  p('Classic Pluck', 'Pluck', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'square', octave: 1, level: 0.25 },
    unison: { voices: 3, detune: 14, width: 0.7 },
    filter: { cutoff: 600, res: 1.5, envAmt: 3.5, keyTrack: 0.5 },
    filtEnv: { a: 0.001, d: 0.22, s: 0, r: 0.2 },
    ampEnv: { a: 0.002, d: 0.45, s: 0, r: 0.35 },
    fx: { delay: { on: true, time: '1/8.', feedback: 0.35, mix: 0.25 }, reverb: { on: true, size: 0.5, mix: 0.25 } },
    gain: 0.8,
  }),
  p('Kalimba', 'Pluck', {
    osc1: { wave: 'sine', level: 0.9 },
    osc2: { on: true, wave: 'sine', octave: 2, semi: 7, level: 0.15 },
    filter: { cutoff: 9000, keyTrack: 0 },
    ampEnv: { a: 0.001, d: 0.6, s: 0, r: 0.5 },
    fx: { reverb: { on: true, size: 0.45, mix: 0.25 } },
    gain: 0.75,
  }),
  p('Marimba', 'Pluck', {
    osc1: { wave: 'triangle', level: 0.9 },
    osc2: { on: true, wave: 'sine', octave: 2, level: 0.2 },
    filter: { cutoff: 2500, envAmt: 2, keyTrack: 0.5 },
    filtEnv: { a: 0.001, d: 0.08, s: 0, r: 0.1 },
    ampEnv: { a: 0.001, d: 0.35, s: 0, r: 0.25 },
    fx: { reverb: { on: true, size: 0.35, mix: 0.2 } },
    gain: 0.8,
  }),
  p('Future Pluck', 'Pluck', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    unison: { voices: 7, detune: 24, width: 1 },
    filter: { cutoff: 800, res: 2, envAmt: 4, keyTrack: 0.4 },
    filtEnv: { a: 0.001, d: 0.3, s: 0.05, r: 0.2 },
    ampEnv: { a: 0.002, d: 0.5, s: 0.1, r: 0.3 },
    fx: { delay: { on: true, time: '1/8', feedback: 0.3, mix: 0.2 }, reverb: { on: true, size: 0.6, mix: 0.3 } },
    gain: 0.8,
  }),
  p('Harp-ish', 'Pluck', {
    osc1: { wave: 'triangle', level: 0.8 },
    osc2: { on: true, wave: 'sawtooth', level: 0.25, fine: 4 },
    filter: { cutoff: 1500, res: 1, envAmt: 2.5, keyTrack: 0.6 },
    filtEnv: { a: 0.001, d: 0.4, s: 0, r: 0.6 },
    ampEnv: { a: 0.001, d: 1.4, s: 0, r: 1 },
    fx: { reverb: { on: true, size: 0.6, mix: 0.3 } },
    gain: 0.7,
  }),

  // ── Keys ────────────────────────────────────────────────────────────
  p('Electric Piano', 'Keys', {
    osc1: { wave: 'sine', level: 0.9 },
    osc2: { on: true, wave: 'triangle', octave: 1, level: 0.25 },
    filter: { cutoff: 3000, envAmt: 1.5, keyTrack: 0.5 },
    filtEnv: { a: 0.001, d: 0.5, s: 0.2, r: 0.4 },
    ampEnv: { a: 0.002, d: 1.4, s: 0.35, r: 0.4 },
    lfo1: { target: 'volume', rate: '1/8', amount: 0.25 },
    fx: { chorus: { on: true, mix: 0.3 }, reverb: { on: true, size: 0.4, mix: 0.2 } },
    gain: 0.65,
  }),
  p('Organ', 'Keys', {
    osc1: { wave: 'sine', level: 0.8 },
    osc2: { on: true, wave: 'sine', octave: 1, level: 0.5 },
    sub: { level: 0.4, wave: 'sine' },
    filter: { cutoff: 8000, keyTrack: 0 },
    ampEnv: { a: 0.005, d: 0.1, s: 1, r: 0.08 },
    lfo1: { target: 'pitch', rate: '1/16', amount: 0.1 },
    fx: { chorus: { on: true, rate: 1.5, depth: 0.6, mix: 0.4 }, drive: { on: true, amount: 0.2, mix: 0.6 } },
    gain: 0.45,
  }),
  p('Soft Piano Pad', 'Keys', {
    osc1: { wave: 'triangle', level: 0.8 },
    osc2: { on: true, wave: 'sawtooth', level: 0.2, fine: 5 },
    filter: { cutoff: 1800, envAmt: 1.2, keyTrack: 0.5 },
    filtEnv: { a: 0.002, d: 0.8, s: 0.2, r: 0.8 },
    ampEnv: { a: 0.003, d: 2, s: 0.2, r: 0.9 },
    fx: { reverb: { on: true, size: 0.55, mix: 0.3 } },
    gain: 0.7,
  }),
  p('Clavinet', 'Keys', {
    osc1: { wave: 'pulse', pw: 0.2, level: 0.8 },
    filter: { type: 'bandpass', slope: 12, cutoff: 1400, res: 2, envAmt: 1.5, keyTrack: 0.6 },
    filtEnv: { a: 0.001, d: 0.15, s: 0.2, r: 0.1 },
    ampEnv: { a: 0.001, d: 0.5, s: 0.4, r: 0.08 },
    fx: { drive: { on: true, amount: 0.2, mix: 0.5 } },
    gain: 1.0,
  }),

  // ── Brass & Strings ─────────────────────────────────────────────────
  p('Synth Brass', 'Brass & Strings', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'sawtooth', fine: 8, level: 0.7 },
    filter: { cutoff: 700, res: 1, envAmt: 2.4, keyTrack: 0.4 },
    filtEnv: { a: 0.08, d: 0.5, s: 0.5, r: 0.3 },
    ampEnv: { a: 0.04, d: 0.4, s: 0.85, r: 0.25 },
    fx: { reverb: { on: true, size: 0.45, mix: 0.2 } },
    gain: 0.55,
  }),
  p('String Ensemble', 'Brass & Strings', {
    osc1: { wave: 'sawtooth', level: 0.7 },
    unison: { voices: 5, detune: 14, width: 1 },
    filter: { cutoff: 3200, res: 0.6, keyTrack: 0.3 },
    ampEnv: { a: 0.35, d: 0.5, s: 0.9, r: 0.9 },
    lfo1: { target: 'pitch', rate: '1/8T', amount: 0.1 },
    fx: { chorus: { on: true, mix: 0.4 }, reverb: { on: true, size: 0.65, mix: 0.3 }, eq: { high: -3 } },
    gain: 0.5,
  }),
  p('Stab', 'Brass & Strings', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'square', fine: -7, level: 0.5 },
    unison: { voices: 3, detune: 15, width: 0.7 },
    filter: { cutoff: 1200, res: 1.5, envAmt: 2.8, keyTrack: 0.3 },
    filtEnv: { a: 0.001, d: 0.2, s: 0.1, r: 0.15 },
    ampEnv: { a: 0.002, d: 0.25, s: 0.1, r: 0.2 },
    fx: { reverb: { on: true, size: 0.5, mix: 0.25 } },
    gain: 0.8,
  }),

  // ── Rock ────────────────────────────────────────────────────────────
  p('Distorted Lead', 'Rock', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'square', fine: 6, level: 0.5 },
    filter: { cutoff: 3200, res: 1.2, keyTrack: 0.3 },
    ampEnv: { a: 0.003, d: 0.5, s: 0.8, r: 0.15 },
    lfo1: { target: 'pitch', rate: '1/8T', amount: 0.15 },
    voice: { mode: 'mono', glide: 0.03 },
    fx: { drive: { on: true, amount: 0.75, tone: 0.45, mix: 1 }, delay: { on: true, time: '1/4', feedback: 0.25, mix: 0.15 }, reverb: { on: true, size: 0.35, mix: 0.15 }, eq: { mid: 3, low: -2 } },
    gain: 0.6,
  }),
  p('Power Chords', 'Rock', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'sawtooth', octave: -1, fine: 5, level: 0.5 },
    filter: { cutoff: 2800, res: 0.8, keyTrack: 0.2 },
    ampEnv: { a: 0.002, d: 0.6, s: 0.7, r: 0.12 },
    fx: { drive: { on: true, amount: 0.85, tone: 0.4, mix: 1 }, eq: { low: 2, mid: 2, high: -3 }, reverb: { on: true, size: 0.3, mix: 0.12 } },
    gain: 0.5,
  }),
  p('Palm Mute Chug', 'Rock', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'square', octave: -1, level: 0.4 },
    filter: { cutoff: 500, res: 1, envAmt: 2.5, keyTrack: 0.3 },
    filtEnv: { a: 0.001, d: 0.09, s: 0.05, r: 0.05 },
    ampEnv: { a: 0.001, d: 0.18, s: 0.1, r: 0.05 },
    fx: { drive: { on: true, amount: 0.8, tone: 0.35, mix: 1 }, eq: { low: 3, mid: 1 } },
    gain: 0.6,
  }),
  p('Rock Organ', 'Rock', {
    osc1: { wave: 'sine', level: 0.7 },
    osc2: { on: true, wave: 'square', octave: 1, level: 0.25 },
    sub: { level: 0.5, wave: 'sine' },
    ampEnv: { a: 0.004, d: 0.1, s: 1, r: 0.06 },
    fx: { drive: { on: true, amount: 0.5, tone: 0.55, mix: 0.8 }, chorus: { on: true, rate: 5, depth: 0.4, mix: 0.45 } },
    gain: 0.45,
  }),
  p('Fuzz Bass', 'Rock', {
    osc1: { wave: 'square', level: 0.8 },
    sub: { level: 0.5 },
    filter: { cutoff: 1400, res: 1, keyTrack: 0.2 },
    ampEnv: { a: 0.002, d: 0.3, s: 0.9, r: 0.08 },
    voice: { mode: 'mono', glide: 0.02 },
    fx: { drive: { on: true, amount: 0.9, tone: 0.3, mix: 0.9 }, eq: { low: 3, high: -4 } },
    gain: 0.55,
  }),

  // ── Lo-fi ───────────────────────────────────────────────────────────
  p('Lo-fi Keys', 'Lo-fi', {
    osc1: { wave: 'triangle', level: 0.8 },
    osc2: { on: true, wave: 'sine', octave: 1, level: 0.3, fine: -12 },
    noise: { level: 0.04 },
    filter: { cutoff: 1800, res: 0.8, keyTrack: 0.3 },
    ampEnv: { a: 0.004, d: 1.2, s: 0.3, r: 0.5 },
    lfo1: { target: 'pitch', rate: '1 bar', amount: 0.15, wave: 'sine' },
    fx: { chorus: { on: true, rate: 0.4, depth: 0.7, mix: 0.4 }, drive: { on: true, amount: 0.25, tone: 0.3, mix: 0.6 }, reverb: { on: true, size: 0.45, mix: 0.25 }, eq: { high: -6, low: 1 } },
    gain: 0.65,
  }),
  p('Dusty Pad', 'Lo-fi', {
    osc1: { wave: 'sawtooth', level: 0.6 },
    osc2: { on: true, wave: 'triangle', fine: 10, level: 0.6 },
    noise: { level: 0.06 },
    unison: { voices: 3, detune: 12, width: 0.6 },
    filter: { cutoff: 1100, res: 0.6, keyTrack: 0.2 },
    ampEnv: { a: 0.4, d: 1, s: 0.8, r: 1.2 },
    lfo1: { target: 'pitch', rate: '2 bars', amount: 0.18 },
    fx: { chorus: { on: true, mix: 0.4 }, reverb: { on: true, size: 0.6, damp: 0.8, mix: 0.3 }, eq: { high: -6 } },
    gain: 0.5,
  }),
  p('Tape Lead', 'Lo-fi', {
    osc1: { wave: 'square', level: 0.7 },
    filter: { cutoff: 2000, res: 1, keyTrack: 0.4 },
    ampEnv: { a: 0.01, d: 0.4, s: 0.7, r: 0.3 },
    lfo1: { target: 'pitch', rate: '1/2', amount: 0.2 },
    voice: { mode: 'mono', glide: 0.08 },
    fx: { drive: { on: true, amount: 0.3, tone: 0.3, mix: 0.7 }, delay: { on: true, time: '1/4.', feedback: 0.45, mix: 0.3 }, eq: { high: -5 } },
    gain: 0.6,
  }),

  // ── Ambient & FX ────────────────────────────────────────────────────
  p('Cinematic Drone', 'Ambient & FX', {
    osc1: { wave: 'sawtooth', level: 0.6 },
    osc2: { on: true, wave: 'sawtooth', octave: -1, fine: 4, level: 0.6 },
    sub: { level: 0.3 },
    noise: { level: 0.05 },
    unison: { voices: 5, detune: 25, width: 1 },
    filter: { cutoff: 500, res: 3, keyTrack: 0.1 },
    ampEnv: { a: 2.5, d: 2, s: 1, r: 3 },
    lfo1: { target: 'cutoff', rate: '4 bars', amount: 0.5, wave: 'triangle' },
    lfo2: { target: 'pan', rate: '2 bars', amount: 0.3 },
    fx: { reverb: { on: true, size: 1, damp: 0.6, mix: 0.5 } },
    gain: 0.6,
  }),
  p('Shimmer Bells', 'Ambient & FX', {
    osc1: { wave: 'sine', level: 0.8 },
    osc2: { on: true, wave: 'sine', octave: 2, semi: 4, fine: 14, level: 0.35 },
    filter: { cutoff: 10000, keyTrack: 0 },
    ampEnv: { a: 0.001, d: 2, s: 0, r: 2 },
    fx: { delay: { on: true, time: '1/4.', feedback: 0.5, mix: 0.3 }, reverb: { on: true, size: 0.9, mix: 0.45 } },
    gain: 0.55,
  }),
  p('Riser Noise', 'Ambient & FX', {
    osc1: { on: false },
    noise: { level: 1 },
    filter: { type: 'bandpass', slope: 12, cutoff: 600, res: 3, envAmt: 4, keyTrack: 0 },
    filtEnv: { a: 3, d: 0.5, s: 1, r: 0.5 },
    ampEnv: { a: 2.5, d: 0.5, s: 1, r: 0.8 },
    fx: { reverb: { on: true, size: 0.8, mix: 0.4 } },
    gain: 1.0,
  }),
  p('Wobble', 'Ambient & FX', {
    osc1: { wave: 'sawtooth', level: 0.8 },
    osc2: { on: true, wave: 'square', octave: -1, level: 0.5 },
    unison: { voices: 3, detune: 12, width: 0.5 },
    filter: { cutoff: 300, res: 6, keyTrack: 0.2, drive: 0.5 },
    lfo1: { target: 'cutoff', rate: '1/8', amount: 0.75, wave: 'sine' },
    voice: { mode: 'mono', glide: 0.05 },
    gain: 0.6,
  }),
  p('Space Arp', 'Ambient & FX', {
    osc1: { wave: 'pulse', pw: 0.3, level: 0.7 },
    osc2: { on: true, wave: 'sawtooth', octave: 1, level: 0.25, fine: -8 },
    filter: { cutoff: 1500, res: 4, envAmt: 2.5, keyTrack: 0.5 },
    filtEnv: { a: 0.001, d: 0.2, s: 0.1, r: 0.2 },
    ampEnv: { a: 0.002, d: 0.3, s: 0.2, r: 0.3 },
    lfo1: { target: 'cutoff', rate: '2 bars', amount: 0.35, wave: 'triangle' },
    fx: { delay: { on: true, time: '1/8.', feedback: 0.55, mix: 0.35 }, reverb: { on: true, size: 0.75, mix: 0.35 } },
    gain: 0.7,
  }),
];

export function findPreset(name: string): Patch {
  const found = FACTORY_PRESETS.find((x) => x.name === name);
  return structuredClone(found ?? initPatch());
}

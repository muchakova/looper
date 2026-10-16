// Trig conditions: decide whether a note or drum step plays on a given pass
// through the loop. Everything is deterministic (seeded), so live playback
// and the exported file always agree, and the pattern of variations repeats
// exactly after `cycleLength` passes — which is what keeps exports seamless.

import { mulberry32 } from '../audio/dsp';
import type { Cond, Project, StepParams, TrigParams } from './types';

/** Conditions offered in the editors (null = always). */
export const COND_OPTIONS: (Cond | null)[] = [
  null,
  [1, 2], [2, 2],
  [1, 3], [2, 3], [3, 3],
  [1, 4], [2, 4], [3, 4], [4, 4],
  [1, 8], [8, 8],
];

export function condLabel(c?: Cond | null): string {
  return c ? `${c[0]}:${c[1]}` : 'Always';
}

export function nextCond(c?: Cond | null, dir = 1): Cond | null {
  const i = COND_OPTIONS.findIndex((o) => (o === null ? !c : !!c && o[0] === c[0] && o[1] === c[1]));
  const n = COND_OPTIONS.length;
  return COND_OPTIONS[(((i < 0 ? 0 : i) + dir) % n + n) % n];
}

/** Passes over which chance-based variations repeat. */
const CHANCE_CYCLE = 4;
const MAX_CYCLE = 16;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Number of loop passes after which every condition repeats. 1 means each
 * pass is identical (no conditions in the project).
 */
export function cycleLength(p: Project): number {
  let cycle = 1;
  const add = (t: TrigParams) => {
    if (t.cond) cycle = (cycle * t.cond[1]) / gcd(cycle, t.cond[1]);
    if (t.chance !== undefined && t.chance < 100) cycle = (cycle * CHANCE_CYCLE) / gcd(cycle, CHANCE_CYCLE);
  };
  for (const t of p.tracks) {
    if (t.kind === 'synth') t.notes.forEach(add);
    else for (const steps of Object.values(t.locks ?? {})) Object.values(steps ?? {}).forEach(add);
  }
  return Math.min(MAX_CYCLE, cycle);
}

export function shouldPlay(t: TrigParams | undefined, pass: number, seed: number, cycle: number): boolean {
  if (!t) return true;
  if (t.cond) {
    const [a, b] = t.cond;
    if ((((pass % b) + b) % b) !== a - 1) return false;
  }
  if (t.chance !== undefined && t.chance < 100) {
    const k = ((pass % cycle) + cycle) % cycle;
    const r = mulberry32(((seed >>> 0) * 2654435761 + k * 97 + 7) >>> 0)();
    if (r * 100 >= t.chance) return false;
  }
  return true;
}

/** Is anything set on a step besides "play normally"? */
export function hasLocks(s?: StepParams): boolean {
  if (!s) return false;
  return ['tune', 'decay', 'level', 'pan', 'ratchet', 'nudge'].some((k) => s[k as keyof StepParams] !== undefined);
}

export function hasTrig(s?: TrigParams): boolean {
  return !!s && (!!s.cond || (s.chance !== undefined && s.chance < 100));
}

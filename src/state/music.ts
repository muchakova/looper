// Music theory helpers: note names, scales, chords and tempo divisions.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES: Record<string, { label: string; steps: number[] }> = {
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  harmonic: { label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  pentaMajor: { label: 'Pentatonic major', steps: [0, 2, 4, 7, 9] },
  pentaMinor: { label: 'Pentatonic minor', steps: [0, 3, 5, 7, 10] },
  blues: { label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  chromatic: { label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export function noteName(pitch: number): string {
  return NOTE_NAMES[((pitch % 12) + 12) % 12] + (Math.floor(pitch / 12) - 1);
}

export function inScale(pitch: number, key: number, scale: string): boolean {
  const steps = SCALES[scale]?.steps ?? SCALES.chromatic.steps;
  return steps.includes((((pitch - key) % 12) + 12) % 12);
}

/** Nearest pitch that belongs to the scale (ties go down). */
export function snapToScale(pitch: number, key: number, scale: string): number {
  for (let d = 0; d < 12; d++) {
    if (inScale(pitch - d, key, scale)) return pitch - d;
    if (inScale(pitch + d, key, scale)) return pitch + d;
  }
  return pitch;
}

export type ChordMode = 'off' | 'triad' | 'seventh' | 'power' | 'sus2' | 'sus4' | 'octave';

export const CHORD_LABELS: Record<ChordMode, string> = {
  off: 'Single note',
  triad: 'Triad',
  seventh: '7th chord',
  power: 'Power chord',
  sus2: 'Sus2',
  sus4: 'Sus4',
  octave: 'Octave',
};

/**
 * Builds a chord on `root`. Triads and 7ths are diatonic: thirds are stacked
 * inside the current scale, so every chord fits the key automatically.
 */
export function buildChord(root: number, mode: ChordMode, key: number, scale: string): number[] {
  switch (mode) {
    case 'off':
      return [root];
    case 'power':
      return [root, root + 7, root + 12];
    case 'octave':
      return [root, root + 12];
    case 'sus2':
      return [root, root + 2, root + 7];
    case 'sus4':
      return [root, root + 5, root + 7];
  }
  const steps = SCALES[scale]?.steps ?? SCALES.major.steps;
  if (steps.length !== 7) {
    // Non-heptatonic scales: fall back to a minor/major triad by ear.
    const third = inScale(root + 4, key, scale) ? 4 : 3;
    const notes = [root, root + third, root + 7];
    if (mode === 'seventh') notes.push(root + 10);
    return notes;
  }
  const r = snapToScale(root, key, scale);
  const idx = steps.indexOf((((r - key) % 12) + 12) % 12);
  const count = mode === 'seventh' ? 4 : 3;
  const notes: number[] = [];
  for (let i = 0; i < count; i++) {
    const k = idx + i * 2;
    notes.push(r + steps[k % 7] + Math.floor(k / 7) * 12 - steps[idx]);
  }
  return notes;
}

// Tempo divisions expressed in beats (quarter notes).
export const LFO_RATES: Record<string, number> = {
  '8 bars': 32,
  '4 bars': 16,
  '2 bars': 8,
  '1 bar': 4,
  '1/2': 2,
  '1/4': 1,
  '1/4T': 2 / 3,
  '1/8': 0.5,
  '1/8T': 1 / 3,
  '1/16': 0.25,
  '1/32': 0.125,
};

export const DELAY_TIMES: Record<string, number> = {
  '1/4': 1,
  '1/4.': 1.5,
  '1/4T': 2 / 3,
  '1/8': 0.5,
  '1/8.': 0.75,
  '1/8T': 1 / 3,
  '1/16': 0.25,
};

export const SNAP_OPTIONS: Record<string, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/16': 0.25,
  '1/32': 0.125,
  '1/8T': 1 / 3,
  '1/16T': 1 / 6,
  Off: 0,
};

export function midiToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

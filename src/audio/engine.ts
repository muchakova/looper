// The audio engine: builds one synth/drum engine per track, the master bus
// (glue compressor → limiter → soft clip) and schedules notes for a beat range.
// It works with any BaseAudioContext, so live playback and offline WAV export
// share exactly the same code.

import type { DrumTrack, Note, Project, SynthTrack } from '../state/types';
import { cycleLength, shouldPlay } from '../state/conditions';
import { fxTail, type Timing } from './channel';
import { DrumEngine, DRUM_VOICES } from './drums';
import { softClipCurve } from './dsp';
import { SynthEngine } from './synth';

export const SWING_MAX = 1 / 12; // beats; full swing = triplet feel

type TrackEngine = { kind: 'synth'; eng: SynthEngine } | { kind: 'drums'; eng: DrumEngine };

export class Engine {
  readonly input: GainNode;
  readonly analyser: AnalyserNode;
  private readonly masterVol: GainNode;
  private readonly glue: DynamicsCompressorNode;
  private readonly glueMakeup: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly limiterTrim: GainNode;
  private engines: TrackEngine[] = [];
  private signature = '';

  constructor(
    readonly ctx: BaseAudioContext,
    private readonly getProject: () => Project,
    dest: AudioNode = ctx.destination,
  ) {
    const c = ctx;
    this.input = c.createGain();
    this.masterVol = c.createGain();
    this.glue = c.createDynamicsCompressor();
    this.glue.attack.value = 0.015;
    this.glue.release.value = 0.25;
    this.glue.knee.value = 8;
    this.glueMakeup = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.limiterTrim = c.createGain();
    // The built-in makeup gain of DynamicsCompressorNode is cancelled here.
    this.limiterTrim.gain.value = dbToGain(-makeupDb(-3, 20));
    const clip = c.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '4x';
    // The soft-clip curve covers inputs of ±1.5, so scale into its domain;
    // below the knee the overall gain stays at unity.
    const pre = c.createGain();
    pre.gain.value = 1 / 1.5;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.75;
    this.input
      .connect(this.masterVol)
      .connect(this.glue)
      .connect(this.glueMakeup)
      .connect(this.limiter)
      .connect(this.limiterTrim)
      .connect(pre)
      .connect(clip);
    clip.connect(this.analyser).connect(dest);
    this.sync();
  }

  get project(): Project {
    return this.getProject();
  }

  timing(): Timing {
    const p = this.project;
    return { bpm: p.bpm, loopSec: (p.bars * 4 * 60) / p.bpm };
  }

  /** Rebuild track engines if the track layout changed, then apply params. */
  sync(): void {
    const p = this.project;
    const sig = p.tracks.map((t) => t.kind).join(',');
    if (sig !== this.signature) {
      this.signature = sig;
      this.engines = p.tracks.map((t, i) =>
        t.kind === 'synth'
          ? { kind: 'synth', eng: new SynthEngine(this.ctx, () => this.project.tracks[i] as SynthTrack, this.input) }
          : { kind: 'drums', eng: new DrumEngine(this.ctx, () => this.project.tracks[i] as DrumTrack, this.input) },
      );
    }
    this.apply();
  }

  apply(): void {
    const p = this.project;
    const timing = this.timing();
    const anySolo = p.tracks.some((t) => t.solo);
    p.tracks.forEach((t, i) => {
      const audible = !t.mute && (!anySolo || t.solo);
      this.engines[i]?.eng.apply(timing, audible);
    });
    this.masterVol.gain.value = p.master.volume;
    const g = p.master.glue;
    const thr = -4 - g * 20;
    const ratio = 1.5 + g * 2.5;
    this.glue.threshold.value = thr;
    this.glue.ratio.value = ratio;
    this.glueMakeup.gain.value = dbToGain(-makeupDb(thr, ratio) + g * 5);
  }

  synth(i: number): SynthEngine | null {
    const e = this.engines[i];
    return e && e.kind === 'synth' ? e.eng : null;
  }

  drums(i: number): DrumEngine | null {
    const e = this.engines[i];
    return e && e.kind === 'drums' ? e.eng : null;
  }

  restartModulation(t: number): void {
    for (const e of this.engines) e.eng.restartModulation(t);
  }

  allOff(t: number): void {
    for (const e of this.engines) if (e.kind === 'synth') e.eng.allOff(t);
  }

  /**
   * Schedule every event whose (swung) start lies in [from, to) beats, where
   * beats count continuously from the transport start across loop repeats.
   */
  scheduleRange(from: number, to: number, beatToTime: (b: number) => number): void {
    const p = this.project;
    const L = p.bars * 4;
    const swing = p.swing * SWING_MAX;
    const swung = (b: number) => b + (isOdd16th(b) ? swing : 0);

    // Re-sync every LFO at each loop start. Free-running oscillators drift a
    // little per repetition, which would make repeats differ and the loop seam
    // audible; restarting keeps every repetition identical (live and export).
    for (let k = Math.max(1, Math.ceil(from / L)); k * L < to; k++) {
      this.restartModulation(beatToTime(k * L));
    }

    const cycle = cycleLength(p);

    p.tracks.forEach((t, ti) => {
      if (t.kind === 'synth') {
        const eng = this.synth(ti)!;
        const ordered = t.notes.filter((n) => n.start < L).sort((x, y) => x.start - y.start || x.pitch - y.pitch);
        // Chance seeds come from the note's position, so they survive save/load.
        const trigSeed = (n: Note) => Math.round(n.start * 96) * 131 + n.pitch * 7 + ti * 1009;
        const plays = (n: Note, pass: number) => shouldPlay(n, pass, trigSeed(n), cycle);
        // The first note that plays in a pass starts a fresh mono voice, so a
        // voice never runs across the loop point (seamless repeats).
        const firstOf = new Map<number, Note | undefined>();
        const firstIn = (pass: number) => {
          if (!firstOf.has(pass)) firstOf.set(pass, ordered.find((n) => plays(n, pass)));
          return firstOf.get(pass);
        };
        const events: { at: number; end: number; n: Note; fresh: boolean }[] = [];
        const k0 = Math.floor((from - SWING_MAX) / L);
        const k1 = Math.floor(to / L);
        for (let k = k0; k <= k1; k++) {
          for (const n of ordered) {
            const at = k * L + swung(n.start);
            if (at < from || at >= to || !plays(n, k)) continue;
            events.push({ at, end: k * L + n.start + n.dur, n, fresh: firstIn(k) === n });
          }
        }
        events.sort((a, b) => a.at - b.at || a.n.pitch - b.n.pitch);
        for (const e of events) {
          const { n } = e;
          const mods = n.cutoff !== undefined || n.res !== undefined || n.pan !== undefined ? { cutoff: n.cutoff, res: n.res, pan: n.pan } : undefined;
          // Voice phases are seeded from the note's position too, so the same
          // project renders bit-identically every time, even after reloading.
          eng.playNote(n.pitch, n.vel, beatToTime(e.at), beatToTime(Math.max(e.end, e.at + 0.02)), trigSeed(n) * 7919 + ti, e.fresh, mods);
        }
      } else {
        const eng = this.drums(ti)!;
        const stepLen = 0.25;
        // Look one step further back: micro-timing can pull a hit earlier.
        const i0 = Math.floor((from - SWING_MAX) / stepLen) - 1;
        const i1 = Math.ceil(to / stepLen) + 1;
        for (let i = i0; i <= i1; i++) {
          if (i < 0) continue;
          const base = i * stepLen;
          const pass = Math.floor(base / L + 1e-9);
          const inLoop = base - pass * L;
          const step = Math.round(inLoop / stepLen) % t.steps;
          DRUM_VOICES.forEach((v, vi) => {
            const val = t.pattern[v][step];
            if (!val) return;
            const lock = t.locks?.[v]?.[step];
            const seed = step * 101 + vi * 7 + 1;
            const at = swung(base) + (lock?.nudge ?? 0) * stepLen;
            if (at < from || at >= to || !shouldPlay(lock, pass, seed, cycle)) return;
            const vel = val === 2 ? 1 : 0.72;
            const hits = lock?.ratchet ?? 1;
            for (let j = 0; j < hits; j++) {
              // Ratchet: repeat the hit inside its step, slightly softer each time
              eng.trigger(v, vel * (1 - 0.18 * (j / hits)), beatToTime(at + (j * stepLen) / hits), seed + j * 13, lock);
            }
          });
        }
      }
    });
  }
}

/** Longest tail (release + fx) in seconds, used to size export warm-up. */
export function projectTail(p: Project): number {
  let tail = 0.5;
  for (const t of p.tracks) {
    const fx = t.kind === 'synth' ? t.patch.fx : t.fx;
    tail = Math.max(tail, fxTail(fx, p.bpm) + (t.kind === 'synth' ? t.patch.ampEnv.r : 0.5));
  }
  return tail;
}

function isOdd16th(b: number): boolean {
  const x = b / 0.25;
  const r = Math.round(x);
  return Math.abs(x - r) < 0.02 && r % 2 !== 0;
}

/** Automatic makeup gain applied by DynamicsCompressorNode (per spec). */
function makeupDb(threshold: number, ratio: number): number {
  const fullRange = threshold * (1 - 1 / ratio);
  return -0.6 * fullRange;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

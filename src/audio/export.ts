// Offline WAV export. Seamless mode renders warm-up loops first and keeps only
// the following repetitions: reverb/delay tails and long releases from the end
// of the loop are already present at its start, so the file repeats with no
// click or gap in a video editor.

import type { Project } from '../state/types';
import { cycleLength } from '../state/conditions';
import { Engine, projectTail } from './engine';

export interface ExportOptions {
  sampleRate: 44100 | 48000;
  bitDepth: 16 | 24;
  repeats: number;
  seamless: boolean;
  normalize: boolean;
}

export async function renderProject(
  project: Project,
  opts: ExportOptions,
  onProgress?: (p: number) => void,
): Promise<AudioBuffer> {
  const proj = structuredClone(project);
  const sr = opts.sampleRate;
  const L = proj.bars * 4;
  const loopSec = (L * 60) / proj.bpm;
  // Web Audio processes in blocks of 128 frames, and some timing lands on
  // block boundaries. If every repetition starts on a block boundary, every
  // repetition renders identically, so seamless loops are rounded to whole
  // blocks (at most ±1.3 ms per loop — far below anything audible).
  const block = 128 / sr;
  const loopLen = opts.seamless ? Math.max(block, Math.round(loopSec / block) * block) : loopSec;
  // A short pre-roll lets the first notes start slightly early (free-running
  // oscillator phase) exactly like every later repetition does.
  const PRE = Math.ceil(0.25 / block) * block;
  const beatToTime = (b: number) => {
    const k = Math.floor(b / L + 1e-9);
    return PRE + k * loopLen + ((b - k * L) * 60) / proj.bpm;
  };

  const tail = projectTail(proj);

  // At least two warm-up loops: the very first pass through the loop can
  // differ slightly from the following ones (modulation start-up), so the
  // kept repetitions always come after a pass that itself repeated.
  //
  // With trig conditions the loop only repeats exactly after `cycle` passes,
  // so warm-up and kept repetitions are whole cycles: the file then starts on
  // pass 1 of the cycle and its end flows straight back into its start.
  const cycle = opts.seamless ? cycleLength(proj) : 1;
  const warmMin = Math.min(8, Math.max(2, Math.ceil(tail / loopLen) + 1));
  const warm = opts.seamless ? Math.ceil(warmMin / cycle) * cycle : 0;
  const repeats = opts.seamless ? Math.ceil(opts.repeats / cycle) * cycle : opts.repeats;
  const loops = warm + repeats;
  const renderSec = PRE + loops * loopLen + (opts.seamless ? 0.05 : tail + 0.2);
  const ctx = new OfflineAudioContext(2, Math.ceil(renderSec * sr), sr);
  const engine = new Engine(ctx, () => proj);
  engine.restartModulation(PRE);

  // Schedule one bar at a time using suspend/resume: only the notes about to
  // play exist in the graph, which keeps long pieces fast and memory low.
  const totalBeats = loops * L;
  const chunk = Math.min(4, L);
  const chunks = Math.ceil(totalBeats / chunk);
  engine.scheduleRange(0, chunk, beatToTime);
  let chunked = typeof ctx.suspend === 'function' && chunks > 1;
  if (chunked) {
    let rejected = false;
    const chunkSec = (chunk * 60) / proj.bpm;
    for (let k = 1; k < chunks; k++) {
      const at = beatToTime(k * chunk) - Math.min(0.5, chunkSec / 2);
      ctx
        .suspend(at)
        .then(() => {
          engine.scheduleRange(k * chunk, Math.min(totalBeats, (k + 1) * chunk), beatToTime);
          onProgress?.(k / chunks);
          return ctx.resume();
        })
        .catch(() => {
          rejected = true;
        });
    }
    // Some browsers (Firefox) refuse suspend() on offline contexts. That shows
    // up as an immediate rejection, before rendering starts, so check for it
    // and fall back to scheduling everything up front.
    await new Promise((r) => setTimeout(r, 0));
    if (rejected) chunked = false;
  }
  if (!chunked) engine.scheduleRange(chunk, totalBeats, beatToTime);

  const full = await ctx.startRendering();
  onProgress?.(1);

  const start = Math.round((PRE + warm * loopLen) * sr);
  const len = opts.seamless ? Math.round(repeats * loopLen * sr) : full.length - start;
  const out = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
  for (let c = 0; c < 2; c++) {
    out.copyToChannel(full.getChannelData(c).subarray(start, start + len), c);
  }
  if (opts.normalize) normalize(out, -0.3);
  return out;
}

function normalize(buf: AudioBuffer, dbfs: number): void {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak < 1e-6) return;
  const g = Math.pow(10, dbfs / 20) / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
}

export function peakDb(buf: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  return 20 * Math.log10(peak || 1e-9);
}

/** Encode as PCM WAV; 16-bit gets TPDF dither. */
export function encodeWav(buf: AudioBuffer, bitDepth: 16 | 24): Blob {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const bytes = bitDepth / 8;
  const dataSize = len * ch * bytes;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, bitDepth, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);

  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const dither = (Math.random() - Math.random()) / 32768;
        const s = Math.max(-1, Math.min(1, chans[c][i] + dither));
        v.setInt16(o, Math.round(s * 32767), true);
        o += 2;
      }
    }
  } else {
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        const x = Math.round(s * 8388607);
        v.setUint8(o, x & 0xff);
        v.setUint8(o + 1, (x >> 8) & 0xff);
        v.setUint8(o + 2, (x >> 16) & 0xff);
        o += 3;
      }
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

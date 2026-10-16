// Offline WAV export. Seamless mode renders warm-up loops first and keeps only
// the following repetitions: reverb/delay tails and long releases from the end
// of the loop are already present at its start, so the file repeats with no
// click or gap in a video editor.

import type { Project } from '../state/types';
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
  const beatToTime = (b: number) => (b * 60) / proj.bpm;

  const tail = projectTail(proj);

  const warm = opts.seamless ? Math.min(8, Math.max(1, Math.ceil(tail / loopSec))) : 0;
  const loops = warm + opts.repeats;
  const renderSec = loops * loopSec + (opts.seamless ? 0.05 : tail + 0.2);
  const ctx = new OfflineAudioContext(2, Math.ceil(renderSec * sr), sr);
  const engine = new Engine(ctx, () => proj);
  engine.restartModulation(0);

  // Schedule one bar at a time using suspend/resume: only the notes about to
  // play exist in the graph, which keeps long pieces fast and memory low.
  const canSuspend = typeof ctx.suspend === 'function';
  const totalBeats = loops * L;
  const chunk = Math.min(4, L);
  const chunks = Math.ceil(totalBeats / chunk);
  engine.scheduleRange(0, chunk, beatToTime);
  if (canSuspend && chunks > 1) {
    const chunkSec = beatToTime(chunk);
    for (let k = 1; k < chunks; k++) {
      const at = k * chunkSec - Math.min(0.5, chunkSec / 2);
      ctx
        .suspend(at)
        .then(() => {
          engine.scheduleRange(k * chunk, Math.min(totalBeats, (k + 1) * chunk), beatToTime);
          onProgress?.(k / chunks);
          return ctx.resume();
        })
        .catch(() => {
          /* suspend rejected (unsupported): handled below */
        });
    }
  } else {
    engine.scheduleRange(chunk, totalBeats, beatToTime);
  }

  const full = await ctx.startRendering();
  onProgress?.(1);

  const start = Math.round(warm * loopSec * sr);
  const len = opts.seamless ? Math.round(opts.repeats * loopSec * sr) : full.length - start;
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

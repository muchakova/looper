// App-wide audio objects and the small set of actions the UI uses to talk to
// the engine.

import { Engine } from './audio/engine';
import { Transport } from './audio/transport';
import { store, type ChangeKind } from './state/project';

const ctx = new AudioContext({ latencyHint: 'interactive' });
export const engine = new Engine(ctx, () => store.project);
export const transport = new Transport(ctx, engine);
export const audioCtx = ctx;

let applyQueued = false;

/** A parameter changed: push it to the audio graph (once per frame). */
export function changed(kind: ChangeKind = 'params'): void {
  if (!applyQueued) {
    applyQueued = true;
    requestAnimationFrame(() => {
      applyQueued = false;
      engine.apply();
    });
  }
  store.emit(kind);
}

/** Finish an edit: apply and record an undo step. */
export function commit(kind: ChangeKind = 'params'): void {
  store.commit();
  changed(kind);
}

export async function ensureAudio(): Promise<void> {
  if (ctx.state !== 'running') await ctx.resume();
}

export async function togglePlay(): Promise<void> {
  if (transport.playing) transport.stop();
  else await transport.start();
  store.emit('transport');
}

/** Audition a note on a synth track right now. */
export function previewNote(trackIndex: number, pitch: number, vel = 0.8, dur = 0.35): void {
  void ensureAudio().then(() => {
    const s = engine.synth(trackIndex);
    if (!s) return;
    const t = ctx.currentTime + 0.01;
    s.playNote(pitch, vel, t, t + dur);
  });
}

export function previewChord(trackIndex: number, pitches: number[], vel = 0.8, dur = 0.5): void {
  for (const p of pitches) previewNote(trackIndex, p, vel, dur);
}

// Rebuild/apply engine state whenever the project is replaced.
store.on((kind) => {
  if (kind === 'all') {
    engine.sync();
    transport.setBpm(store.project.bpm);
  }
});

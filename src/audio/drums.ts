// Synthesized drum kit (808/909-inspired) feeding its own channel strip.

import type { DrumSound, DrumTrack, DrumVoice } from '../state/types';
import { ChannelStrip, type Timing } from './channel';
import { mulberry32, noiseBuffer } from './dsp';

export const DRUM_VOICES: DrumVoice[] = ['kick', 'snare', 'clap', 'chh', 'ohh', 'tom', 'rim', 'perc'];

export const DRUM_LABELS: Record<DrumVoice, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  chh: 'Closed hat',
  ohh: 'Open hat',
  tom: 'Tom',
  rim: 'Rim',
  perc: 'Cowbell',
};

const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

export class DrumEngine {
  readonly strip: ChannelStrip;
  private openHat: GainNode | null = null;
  private rand = mulberry32(99);

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly getTrack: () => DrumTrack,
    dest: AudioNode,
  ) {
    this.strip = new ChannelStrip(ctx, dest);
  }

  apply(timing: Timing, audible: boolean): void {
    const t = this.getTrack();
    this.strip.applyFx(t.fx, timing);
    this.strip.applyChannel(t, audible);
  }

  restartModulation(t: number): void {
    this.strip.restartModulation(t);
  }

  /** `seed` makes noise identical on every loop repetition (seamless export). */
  trigger(voice: DrumVoice, vel: number, t: number, seed = Math.random() * 1e9): void {
    const s = this.getTrack().sounds[voice];
    const g = vel * s.level;
    if (g <= 0) return;
    this.rand = mulberry32(seed);
    switch (voice) {
      case 'kick':
        return this.kick(s, g, t);
      case 'snare':
        return this.snare(s, g, t);
      case 'clap':
        return this.clap(s, g, t);
      case 'chh':
        return this.hat(s, g, t, false);
      case 'ohh':
        return this.hat(s, g, t, true);
      case 'tom':
        return this.tom(s, g, t);
      case 'rim':
        return this.rim(s, g, t);
      case 'perc':
        return this.cowbell(s, g, t);
    }
  }

  private out(gain: number, t: number, decay: number): GainNode {
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.001);
    amp.gain.setTargetAtTime(0, t + 0.001, decay / 5);
    amp.connect(this.strip.input);
    return amp;
  }

  private noise(t: number, dur: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx);
    src.loop = true;
    src.start(t, this.rand() * 1.5);
    src.stop(t + dur);
    return src;
  }

  private kick(s: DrumSound, g: number, t: number): void {
    const ctx = this.ctx;
    const tune = Math.pow(2, s.tune / 12);
    const decay = 0.45 * s.decay;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160 * tune, t);
    osc.frequency.exponentialRampToValueAtTime(48 * tune, t + 0.07);
    osc.frequency.exponentialRampToValueAtTime(42 * tune, t + decay);
    const sat = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8);
    }
    sat.curve = curve;
    const amp = this.out(g * 1.0, t, decay);
    osc.connect(sat).connect(amp);
    osc.start(t);
    osc.stop(t + decay * 1.3 + 0.05);
    // Beater click
    const click = this.noise(t, 0.01);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    click.connect(hp).connect(this.out(g * 0.25, t, 0.008));
  }

  private snare(s: DrumSound, g: number, t: number): void {
    const ctx = this.ctx;
    const tune = Math.pow(2, s.tune / 12);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(240 * tune, t);
    body.frequency.exponentialRampToValueAtTime(170 * tune, t + 0.06);
    body.connect(this.out(g * 0.55, t, 0.12 * s.decay));
    body.start(t);
    body.stop(t + 0.3 * s.decay + 0.05);
    const dur = 0.28 * s.decay;
    const n = this.noise(t, dur * 1.3 + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 1500 * tune;
    const pk = ctx.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 5000;
    pk.gain.value = 4;
    n.connect(bp).connect(pk).connect(this.out(g * 0.6, t, dur));
  }

  private clap(s: DrumSound, g: number, t: number): void {
    const ctx = this.ctx;
    const tune = Math.pow(2, s.tune / 12);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300 * tune;
    bp.Q.value = 1.4;
    const amp = ctx.createGain();
    amp.connect(this.strip.input);
    bp.connect(amp);
    const dur = 0.3 * s.decay;
    const n = this.noise(t, dur * 1.3 + 0.08);
    n.connect(bp);
    const p = amp.gain;
    p.setValueAtTime(0, t);
    // Three quick hand claps, then the room tail
    for (let i = 0; i < 3; i++) {
      const ti = t + i * 0.011;
      p.setValueAtTime(g * 0.9, ti);
      p.setTargetAtTime(0.05 * g, ti + 0.001, 0.004);
    }
    p.setValueAtTime(g * 0.7, t + 0.034);
    p.setTargetAtTime(0, t + 0.035, dur / 5);
  }

  private hat(s: DrumSound, g: number, t: number, open: boolean): void {
    const ctx = this.ctx;
    const tune = Math.pow(2, s.tune / 12);
    const decay = (open ? 0.45 : 0.06) * s.decay;
    // Choke: a closed hat (or new open hat) cuts the ringing open hat
    if (this.openHat) {
      const og = this.openHat.gain;
      og.cancelScheduledValues(t);
      og.setTargetAtTime(0, t, 0.008);
      this.openHat = null;
    }
    const mix = ctx.createGain();
    mix.gain.value = 0.18;
    for (const r of HAT_RATIOS) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 40 * r * tune * 1.4;
      o.connect(mix);
      o.start(t);
      o.stop(t + decay * 1.4 + 0.05);
    }
    const n = this.noise(t, decay * 1.4 + 0.05);
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    n.connect(ng).connect(mix);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 10000;
    bp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const amp = this.out(g * 0.55, t, decay);
    mix.connect(bp).connect(hp).connect(amp);
    if (open) this.openHat = amp;
  }

  private tom(s: DrumSound, g: number, t: number): void {
    const ctx = this.ctx;
    const tune = Math.pow(2, s.tune / 12);
    const decay = 0.35 * s.decay;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150 * tune, t);
    osc.frequency.exponentialRampToValueAtTime(95 * tune, t + decay);
    osc.connect(this.out(g * 0.8, t, decay));
    osc.start(t);
    osc.stop(t + decay * 1.3 + 0.05);
  }

  private rim(s: DrumSound, g: number, t: number): void {
    const ctx = this.ctx;
    const tune = Math.pow(2, s.tune / 12);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 820 * tune;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700 * tune;
    bp.Q.value = 3;
    osc.connect(bp).connect(this.out(g * 0.7, t, 0.04 * s.decay));
    osc.start(t);
    osc.stop(t + 0.1 * s.decay + 0.05);
  }

  private cowbell(s: DrumSound, g: number, t: number): void {
    const ctx = this.ctx;
    const tune = Math.pow(2, s.tune / 12);
    const decay = 0.25 * s.decay;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2640 * tune;
    bp.Q.value = 1.5;
    const amp = this.out(g * 0.45, t, decay);
    bp.connect(amp);
    for (const f of [540, 800]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * tune;
      o.connect(bp);
      o.start(t);
      o.stop(t + decay * 1.3 + 0.05);
    }
  }
}

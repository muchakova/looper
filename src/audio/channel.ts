// A mixer channel strip: tremolo → drive → EQ → chorus → delay → reverb →
// volume → pan. Synth tracks and the drum track both feed one of these.

import type { Channel, Fx } from '../state/types';
import { DELAY_TIMES } from '../state/music';
import { driveCurve, reverbImpulse } from './dsp';

export interface Timing {
  bpm: number;
  loopSec: number;
}

export function setParam(ctx: BaseAudioContext, p: AudioParam, v: number, tc = 0.015): void {
  if (!Number.isFinite(v)) return;
  if (ctx instanceof OfflineAudioContext || ctx.state !== 'running') {
    p.cancelScheduledValues(0);
    p.value = v;
  } else {
    p.setTargetAtTime(v, ctx.currentTime, tc);
  }
}

export class ChannelStrip {
  readonly input: GainNode;
  /** Gain whose `.gain` LFOs modulate for tremolo. */
  readonly tremolo: GainNode;
  readonly panner: StereoPannerNode;
  private readonly volume: GainNode;

  private readonly driveDry: GainNode;
  private readonly driveWet: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly driveTone: BiquadFilterNode;
  private lastDrive = -1;

  private readonly eqLow: BiquadFilterNode;
  private readonly eqMid: BiquadFilterNode;
  private readonly eqHigh: BiquadFilterNode;

  private readonly chorusWet: GainNode;
  private readonly chorusDelays: DelayNode[];
  private readonly chorusDepth: GainNode[];
  private chorusLfo: OscillatorNode | null = null;
  private chorusRate = 0.6;

  private readonly delayWet: GainNode;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly fbL: GainNode;
  private readonly fbR: GainNode;
  private readonly delayPanL: StereoPannerNode;
  private readonly delayPanR: StereoPannerNode;

  private readonly reverbWet: GainNode;
  private readonly convolver: ConvolverNode;
  private reverbKey = '';

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode) {
    const c = ctx;
    this.input = c.createGain();
    this.tremolo = c.createGain();
    this.input.connect(this.tremolo);

    // Drive (parallel dry/wet so the mix knob blends)
    this.driveDry = c.createGain();
    this.driveWet = c.createGain();
    this.shaper = c.createWaveShaper();
    this.shaper.oversample = '4x';
    this.driveTone = c.createBiquadFilter();
    this.driveTone.type = 'lowpass';
    const driveOut = c.createGain();
    this.tremolo.connect(this.driveDry).connect(driveOut);
    this.tremolo.connect(this.shaper).connect(this.driveTone).connect(this.driveWet).connect(driveOut);

    // 3-band EQ
    this.eqLow = c.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 220;
    this.eqMid = c.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1200;
    this.eqMid.Q.value = 0.8;
    this.eqHigh = c.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 5000;
    driveOut.connect(this.eqLow).connect(this.eqMid).connect(this.eqHigh);

    // Stereo chorus: two modulated delay lines panned hard left/right
    const chorusOut = c.createGain();
    this.eqHigh.connect(chorusOut);
    this.chorusWet = c.createGain();
    this.chorusDelays = [];
    this.chorusDepth = [];
    for (const side of [-1, 1]) {
      const d = c.createDelay(0.1);
      d.delayTime.value = side < 0 ? 0.012 : 0.017;
      const pan = c.createStereoPanner();
      pan.pan.value = side;
      const depth = c.createGain();
      this.eqHigh.connect(d).connect(pan).connect(this.chorusWet);
      depth.connect(d.delayTime);
      this.chorusDelays.push(d);
      this.chorusDepth.push(depth);
    }
    this.chorusWet.connect(chorusOut);

    // Tempo-synced (ping-pong) delay with a darkening feedback filter
    const delayOut = c.createGain();
    chorusOut.connect(delayOut);
    this.delayWet = c.createGain();
    this.delayL = c.createDelay(4);
    this.delayR = c.createDelay(4);
    this.fbL = c.createGain();
    this.fbR = c.createGain();
    const fbTone = c.createBiquadFilter();
    fbTone.type = 'lowpass';
    fbTone.frequency.value = 5500;
    const fbHp = c.createBiquadFilter();
    fbHp.type = 'highpass';
    fbHp.frequency.value = 180;
    this.delayPanL = c.createStereoPanner();
    this.delayPanR = c.createStereoPanner();
    chorusOut.connect(fbHp).connect(fbTone).connect(this.delayL);
    this.delayL.connect(this.delayPanL).connect(this.delayWet);
    this.delayL.connect(this.fbL).connect(this.delayR);
    this.delayR.connect(this.delayPanR).connect(this.delayWet);
    this.delayR.connect(this.fbR).connect(this.delayL);
    this.delayWet.connect(delayOut);

    // Convolution reverb
    const reverbOut = c.createGain();
    delayOut.connect(reverbOut);
    this.convolver = c.createConvolver();
    this.reverbWet = c.createGain();
    delayOut.connect(this.convolver).connect(this.reverbWet).connect(reverbOut);

    this.volume = c.createGain();
    this.panner = c.createStereoPanner();
    reverbOut.connect(this.volume).connect(this.panner).connect(dest);
  }

  applyChannel(ch: Channel, audible: boolean): void {
    setParam(this.ctx, this.volume.gain, audible ? ch.volume : 0);
    setParam(this.ctx, this.panner.pan, ch.pan);
  }

  applyFx(fx: Fx, timing: Timing, tremoloBase = 1): void {
    const ctx = this.ctx;
    setParam(ctx, this.tremolo.gain, tremoloBase);

    // Drive
    const d = fx.drive;
    if (d.on && Math.abs(d.amount - this.lastDrive) > 0.001) {
      this.shaper.curve = driveCurve(d.amount);
      this.lastDrive = d.amount;
    }
    const wet = d.on ? d.mix : 0;
    setParam(ctx, this.driveDry.gain, 1 - wet);
    setParam(ctx, this.driveWet.gain, wet * (0.9 - d.amount * 0.45));
    setParam(ctx, this.driveTone.frequency, 800 * Math.pow(2, d.tone * 4.4));

    // EQ
    setParam(ctx, this.eqLow.gain, fx.eq.low);
    setParam(ctx, this.eqMid.gain, fx.eq.mid);
    setParam(ctx, this.eqHigh.gain, fx.eq.high);

    // Chorus: the rate is rounded to whole cycles per loop so exported loops
    // repeat without a modulation jump at the seam.
    const ch = fx.chorus;
    const cycles = Math.max(1, Math.round(ch.rate * timing.loopSec));
    this.chorusRate = cycles / timing.loopSec;
    if (this.chorusLfo) setParam(ctx, this.chorusLfo.frequency, this.chorusRate);
    else this.restartModulation(0);
    const depth = ch.depth * 0.005;
    setParam(ctx, this.chorusDepth[0].gain, depth);
    setParam(ctx, this.chorusDepth[1].gain, -depth);
    setParam(ctx, this.chorusWet.gain, ch.on ? ch.mix : 0);

    // Delay
    const dl = fx.delay;
    const secs = Math.min(3.9, (DELAY_TIMES[dl.time] ?? 0.5) * (60 / timing.bpm));
    setParam(ctx, this.delayL.delayTime, secs, 0.05);
    setParam(ctx, this.delayR.delayTime, secs, 0.05);
    const fb = dl.on ? Math.min(0.92, dl.feedback) : 0;
    setParam(ctx, this.fbL.gain, fb);
    setParam(ctx, this.fbR.gain, fb);
    setParam(ctx, this.delayPanL.pan, dl.pingpong ? -0.85 : 0);
    setParam(ctx, this.delayPanR.pan, dl.pingpong ? 0.85 : 0);
    setParam(ctx, this.delayWet.gain, dl.on ? dl.mix : 0);

    // Reverb: an idle convolver with no buffer costs (almost) nothing
    const rv = fx.reverb;
    const key = rv.on ? `${rv.size.toFixed(2)}:${rv.damp.toFixed(2)}` : 'off';
    if (key !== this.reverbKey) {
      this.reverbKey = key;
      this.convolver.buffer = rv.on ? reverbImpulse(ctx, 0.4 + rv.size * 5.6, rv.damp) : null;
    }
    setParam(ctx, this.reverbWet.gain, rv.on ? rv.mix : 0);
  }

  /** Restart the chorus LFO at `t` so its phase lines up with the loop. */
  restartModulation(t: number): void {
    if (this.chorusLfo) {
      try {
        this.chorusLfo.stop(t);
      } catch {
        /* already stopped */
      }
    }
    const lfo = this.ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = this.chorusRate;
    for (const g of this.chorusDepth) lfo.connect(g);
    lfo.start(t);
    this.chorusLfo = lfo;
  }
}

/** Seconds of tail (reverb/delay) a strip can ring after its input stops. */
export function fxTail(fx: Fx, bpm: number): number {
  let tail = 0;
  if (fx.reverb.on && fx.reverb.mix > 0) tail = Math.max(tail, 0.4 + fx.reverb.size * 5.6);
  if (fx.delay.on && fx.delay.mix > 0) {
    const secs = (DELAY_TIMES[fx.delay.time] ?? 0.5) * (60 / bpm);
    const fb = Math.min(0.92, Math.max(0.01, fx.delay.feedback));
    tail = Math.max(tail, secs * (Math.log(0.001) / Math.log(fb) + 1));
  }
  return tail;
}

// Subtractive polyphonic synthesizer: 2 oscillators + sub + noise, unison,
// 12/24 dB filter with drive and envelope, amp/filter ADSR, 2 tempo-synced LFOs,
// poly or mono/glide voice modes.

import type { Env, Lfo, Osc, Patch, SynthTrack } from '../state/types';
import { LFO_RATES, midiToFreq } from '../state/music';
import { ChannelStrip, setParam, type Timing } from './channel';
import { driveCurve, holdAt, mulberry32, noiseBuffer, pulseWave } from './dsp';

const MAX_VOICES = 12;
const MIN_GAIN = 0.0001;

interface OscUnit {
  osc: OscillatorNode;
  semis: number; // pitch offset of this oscillator relative to the note
}

class Voice {
  readonly oscs: OscUnit[] = [];
  readonly sources: AudioScheduledSourceNode[] = [];
  readonly filters: BiquadFilterNode[] = [];
  readonly amp: GainNode;
  readonly levels: { gain: GainNode; key: 'osc1' | 'osc2' | 'sub' | 'noise'; scale: number }[] = [];
  pitch: number;
  startTime: number;
  releaseTime = Infinity;
  endTime = Infinity;
  private filterBase = 1000;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly synth: SynthEngine,
    patch: Patch,
    pitch: number,
    t: number,
    seed: number,
  ) {
    this.pitch = pitch;
    this.startTime = t;
    const rand = mulberry32(seed);
    const f = patch.filter;

    // Filter section: drive → filter (→ second filter for 24 dB)
    const mix = ctx.createGain();
    let tail: AudioNode = mix;
    if (f.drive > 0.01) {
      const pre = ctx.createGain();
      pre.gain.value = 1 + f.drive * 3;
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(f.drive * 0.8);
      shaper.oversample = '2x';
      const post = ctx.createGain();
      post.gain.value = 1 / (1 + f.drive * 1.2);
      mix.connect(pre).connect(shaper).connect(post);
      tail = post;
    }
    const stages = f.slope === 24 ? 2 : 1;
    for (let i = 0; i < stages; i++) {
      const bf = ctx.createBiquadFilter();
      bf.type = f.type;
      // Two cascaded resonant stages ring too much; soften the first one.
      bf.Q.value = stages === 2 && i === 0 ? Math.min(f.res, 0.707) : f.res;
      tail.connect(bf);
      tail = bf;
      this.filters.push(bf);
    }
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    tail.connect(this.amp).connect(synth.strip.input);
    this.setFilterBase(patch);

    // Oscillators (each with unison copies)
    const uni = Math.max(1, Math.min(7, Math.round(patch.unison.voices)));
    const uniNorm = 1 / Math.sqrt(uni);
    const addOsc = (o: Osc, key: 'osc1' | 'osc2') => {
      if (!o.on || o.level <= 0) return;
      const lvl = ctx.createGain();
      lvl.gain.value = o.level * uniNorm * 0.5;
      lvl.connect(mix);
      this.levels.push({ gain: lvl, key, scale: uniNorm * 0.5 });
      for (let u = 0; u < uni; u++) {
        const spread = uni === 1 ? 0 : (u / (uni - 1)) * 2 - 1; // -1..1
        const osc = ctx.createOscillator();
        if (o.wave === 'pulse') osc.setPeriodicWave(pulseWave(ctx, o.pw));
        else osc.type = o.wave;
        const semis = o.octave * 12 + o.semi + o.fine / 100;
        osc.detune.value = spread * patch.unison.detune;
        this.oscs.push({ osc, semis });
        let out: AudioNode = osc;
        if (uni > 1 && patch.unison.width > 0) {
          const pan = ctx.createStereoPanner();
          pan.pan.value = spread * patch.unison.width;
          osc.connect(pan);
          out = pan;
        }
        out.connect(lvl);
        // Free-running phase: start a fraction of a cycle early (seeded).
        const freq = midiToFreq(pitch + semis);
        osc.frequency.value = freq;
        const early = rand() / freq;
        osc.start(Math.max(ctx.currentTime, t - early));
        this.sources.push(osc);
      }
    };
    addOsc(patch.osc1, 'osc1');
    addOsc(patch.osc2, 'osc2');

    if (patch.sub.level > 0) {
      const lvl = ctx.createGain();
      lvl.gain.value = patch.sub.level * 0.5;
      lvl.connect(mix);
      this.levels.push({ gain: lvl, key: 'sub', scale: 0.5 });
      const osc = ctx.createOscillator();
      osc.type = patch.sub.wave;
      const semis = patch.sub.octave * 12;
      osc.frequency.value = midiToFreq(pitch + semis);
      osc.connect(lvl);
      osc.start(t);
      this.oscs.push({ osc, semis });
      this.sources.push(osc);
    }

    if (patch.noise.level > 0) {
      const lvl = ctx.createGain();
      lvl.gain.value = patch.noise.level * 0.35;
      lvl.connect(mix);
      this.levels.push({ gain: lvl, key: 'noise', scale: 0.35 });
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      src.connect(lvl);
      src.start(t, rand() * 1.9);
      this.sources.push(src);
    }

    // Modulation buses from the track LFOs
    for (const { osc } of this.oscs) synth.pitchBus.connect(osc.detune);
    for (const bf of this.filters) synth.cutoffBus.connect(bf.detune);
  }

  setFilterBase(patch: Patch): void {
    const f = patch.filter;
    const nyq = this.ctx.sampleRate / 2 - 100;
    this.filterBase = Math.min(nyq, f.cutoff * Math.pow(2, ((this.pitch - 60) / 12) * f.keyTrack));
    for (const bf of this.filters) setParam(this.ctx, bf.frequency, this.filterBase);
  }

  /** Live param updates while the note is sounding. */
  update(patch: Patch): void {
    this.setFilterBase(patch);
    this.filters.forEach((bf, i) => {
      const q = this.filters.length === 2 && i === 0 ? Math.min(patch.filter.res, 0.707) : patch.filter.res;
      setParam(this.ctx, bf.Q, q);
    });
    for (const l of this.levels) {
      const lv =
        l.key === 'osc1' ? patch.osc1.level : l.key === 'osc2' ? patch.osc2.level : l.key === 'sub' ? patch.sub.level : patch.noise.level;
      setParam(this.ctx, l.gain.gain, lv * l.scale);
    }
  }

  /** Start (or retrigger) the envelopes at `t`. */
  trigger(patch: Patch, vel: number, t: number, legato: boolean): void {
    const vs = patch.voice.velSens;
    const peak = (1 - vs + vs * vel) * patch.gain;
    if (!legato) {
      envAttack(this.amp.gain, patch.ampEnv, peak, t, true);
      const amt = patch.filter.envAmt * 1200 * (1 - vs * 0.5 + vs * 0.5 * vel);
      for (const bf of this.filters) envAttack(bf.detune, patch.filtEnv, amt, t, false);
    }
  }

  /** Mono legato: drop the pending release and settle at the sustain level. */
  continueLegato(patch: Patch, vel: number, t: number): void {
    const vs = patch.voice.velSens;
    const peak = (1 - vs + vs * vel) * patch.gain;
    holdAt(this.amp.gain, t);
    this.amp.gain.setTargetAtTime(Math.max(MIN_GAIN, peak * patch.ampEnv.s), t, 0.02);
    const amt = patch.filter.envAmt * 1200 * patch.filtEnv.s;
    for (const bf of this.filters) {
      holdAt(bf.detune, t);
      bf.detune.setTargetAtTime(amt, t, Math.max(0.005, patch.filtEnv.d) / 4);
    }
  }

  glideTo(pitch: number, t: number, glide: number): void {
    this.pitch = pitch;
    for (const { osc, semis } of this.oscs) {
      const f = midiToFreq(pitch + semis);
      holdAt(osc.frequency, t);
      if (glide > 0.001) osc.frequency.setTargetAtTime(f, t, glide / 3);
      else osc.frequency.setValueAtTime(f, t);
    }
  }

  release(patch: Patch, t: number): void {
    this.releaseTime = t;
    const r = Math.max(0.005, patch.ampEnv.r);
    holdAt(this.amp.gain, t);
    this.amp.gain.setTargetAtTime(0, t, r / 6);
    const fr = Math.max(0.005, patch.filtEnv.r);
    for (const bf of this.filters) {
      holdAt(bf.detune, t);
      bf.detune.setTargetAtTime(0, t, fr / 6);
    }
    this.stopAt(t + r * 1.15 + 0.03);
  }

  /** Fast fade used for voice stealing and transport stop. */
  kill(t: number): void {
    holdAt(this.amp.gain, t);
    this.amp.gain.setTargetAtTime(0, t, 0.006);
    this.stopAt(t + 0.05);
  }

  /** Reopen a voice whose stop is pending (mono legato / retrigger). */
  revive(): void {
    this.releaseTime = Infinity;
    this.endTime = Infinity;
    for (const s of this.sources) s.stop(1e9);
  }

  private stopAt(t: number): void {
    this.endTime = t;
    for (const s of this.sources) s.stop(Math.max(t, this.ctx.currentTime));
    const main = this.sources[0];
    if (main) {
      main.onended = () => {
        // A revived (mono) voice gets a later stop time; only dispose when
        // the latest scheduled stop has actually passed.
        if (this.endTime <= this.ctx.currentTime + 0.05) this.dispose();
      };
    }
  }

  dispose(): void {
    try {
      for (const { osc } of this.oscs) this.synth.pitchBus.disconnect(osc.detune);
      for (const bf of this.filters) this.synth.cutoffBus.disconnect(bf.detune);
    } catch {
      /* already disconnected */
    }
    this.amp.disconnect();
    this.synth.forget(this);
  }
}

function envAttack(param: AudioParam, env: Env, peak: number, t: number, fromZeroish: boolean): void {
  holdAt(param, t);
  const a = Math.max(0.002, env.a);
  const d = Math.max(0.005, env.d);
  if (fromZeroish && a <= 0.003) param.setValueAtTime(MIN_GAIN, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(peak * env.s, t + a, d / 4);
}

export interface LfoState {
  osc: OscillatorNode | null;
  amount: GainNode;
  target: string;
}

export class SynthEngine {
  readonly strip: ChannelStrip;
  readonly pitchBus: GainNode;
  readonly cutoffBus: GainNode;
  private readonly volumeBus: GainNode;
  private readonly panBus: GainNode;
  private voices: Voice[] = [];
  private mono: Voice | null = null;
  private readonly lfos: LfoState[];
  private seed = 1;
  private timing: Timing = { bpm: 120, loopSec: 8 };

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly getTrack: () => SynthTrack,
    dest: AudioNode,
  ) {
    this.strip = new ChannelStrip(ctx, dest);
    this.pitchBus = ctx.createGain();
    this.cutoffBus = ctx.createGain();
    this.volumeBus = ctx.createGain();
    this.panBus = ctx.createGain();
    this.volumeBus.connect(this.strip.tremolo.gain);
    this.panBus.connect(this.strip.panner.pan);
    this.lfos = [0, 1].map(() => ({ osc: null, amount: ctx.createGain(), target: 'off' }));
  }

  get patch(): Patch {
    return this.getTrack().patch;
  }

  /** Push all patch/channel settings into the audio graph. */
  apply(timing: Timing, audible: boolean): void {
    this.timing = timing;
    const track = this.getTrack();
    const p = track.patch;
    let tremDepth = 0;
    [p.lfo1, p.lfo2].forEach((cfg, i) => {
      const st = this.lfos[i];
      if (st.target !== cfg.target) {
        st.amount.disconnect();
        const bus = this.busFor(cfg.target);
        if (bus) st.amount.connect(bus);
        st.target = cfg.target;
      }
      if (cfg.target === 'volume') tremDepth += cfg.amount / 2;
      setParam(this.ctx, st.amount.gain, lfoScale(cfg));
      if (st.osc) {
        setParam(this.ctx, st.osc.frequency, this.lfoFreq(cfg));
        if (st.osc.type !== cfg.wave) st.osc.type = cfg.wave;
      }
    });
    this.strip.applyFx(p.fx, timing, Math.max(0, 1 - Math.min(1, tremDepth)));
    this.strip.applyChannel(track, audible);
    for (const v of this.voices) v.update(p);
  }

  /** (Re)start LFOs and chorus at `t` so modulation is phase-locked to the loop. */
  restartModulation(t: number): void {
    const p = this.patch;
    [p.lfo1, p.lfo2].forEach((cfg, i) => {
      const st = this.lfos[i];
      if (st.osc) {
        try {
          st.osc.stop(t);
        } catch {
          /* ignore */
        }
      }
      const osc = this.ctx.createOscillator();
      osc.type = cfg.wave;
      osc.frequency.value = this.lfoFreq(cfg);
      osc.connect(st.amount);
      osc.start(t);
      st.osc = osc;
    });
    this.strip.restartModulation(t);
  }

  private lfoFreq(cfg: Lfo): number {
    const beats = LFO_RATES[cfg.rate] ?? 1;
    return this.timing.bpm / 60 / beats;
  }

  private busFor(target: string): AudioNode | null {
    switch (target) {
      case 'pitch':
        return this.pitchBus;
      case 'cutoff':
        return this.cutoffBus;
      case 'volume':
        return this.volumeBus;
      case 'pan':
        return this.panBus;
    }
    return null;
  }

  /** Schedule a note with a known length (sequencer / export). */
  playNote(pitch: number, vel: number, t: number, tOff: number, seed?: number): void {
    const v = this.noteOn(pitch, vel, t, seed);
    if (v) this.noteOff(v, tOff);
  }

  /**
   * `seed` fixes the oscillator phases of a voice. The sequencer passes the
   * note id so every loop repetition renders identically (seamless export).
   */
  noteOn(pitch: number, vel: number, t: number, seed?: number): Voice | null {
    const p = this.patch;
    if (p.voice.mode === 'mono') {
      const cur = this.mono;
      if (cur && cur.endTime > t + 0.005) {
        // Overlapping notes play legato: glide without restarting envelopes.
        const legato = cur.releaseTime > t;
        cur.revive();
        cur.glideTo(pitch, t, p.voice.glide);
        if (legato) cur.continueLegato(p, vel, t);
        else cur.trigger(p, vel, t, false);
        return cur;
      }
    }
    // Voice stealing
    const live = this.voices.filter((v) => v.endTime > t);
    if (live.length >= MAX_VOICES) {
      live.sort((a, b) => a.startTime - b.startTime);
      live[0].kill(t);
    }
    const v = new Voice(this.ctx, this, p, pitch, t, seed ?? 1e6 + this.seed++);
    v.trigger(p, vel, t, false);
    this.voices.push(v);
    if (p.voice.mode === 'mono') {
      if (this.mono && this.mono !== v) this.mono.kill(t);
      this.mono = v;
    }
    return v;
  }

  noteOff(v: Voice, t: number): void {
    v.release(this.patch, t);
  }

  /** Release live-played voices for a pitch (computer keyboard). */
  releasePitch(pitch: number, t: number): void {
    for (const v of this.voices) if (v.pitch === pitch && v.releaseTime === Infinity) v.release(this.patch, t);
  }

  allOff(t: number): void {
    for (const v of this.voices) v.kill(t);
    this.mono = null;
  }

  forget(v: Voice): void {
    this.voices = this.voices.filter((x) => x !== v);
    if (this.mono === v) this.mono = null;
  }
}

function lfoScale(cfg: Lfo): number {
  switch (cfg.target) {
    case 'pitch':
      return cfg.amount * cfg.amount * 400; // cents, squared for fine control
    case 'cutoff':
      return cfg.amount * 3600; // cents (3 octaves)
    case 'volume':
      return cfg.amount / 2;
    case 'pan':
      return cfg.amount;
  }
  return 0;
}

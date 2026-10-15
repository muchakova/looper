// Shared DSP building blocks: deterministic noise, shaping curves, impulse
// responses and band-limited pulse waves. Everything is seeded so the live
// engine and the offline WAV render produce identical audio.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of stereo white noise, cached per context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    const rand = mulberry32(1234);
    buf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    }
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** tanh saturation curve; `amount` 0..1 sets the input gain. */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + amount * 24;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/** Transparent below -1 dBFS, then rounds off smoothly to a 0 dBFS ceiling. */
export function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  const knee = 0.89;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 1.5;
    const ax = Math.abs(x);
    let y = ax;
    if (ax > knee) {
      const over = (ax - knee) / (1 - knee);
      y = knee + (1 - knee) * Math.tanh(over);
    }
    curve[i] = Math.sign(x) * Math.min(y, 1);
  }
  return curve;
}

/**
 * Synthetic stereo hall impulse response: decorrelated noise with an
 * exponential decay and progressive high-frequency damping.
 */
export function reverbImpulse(ctx: BaseAudioContext, seconds: number, damp: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  const preDelay = Math.floor(sr * 0.012);
  for (let c = 0; c < 2; c++) {
    const rand = mulberry32(777 + c * 31);
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      if (i < preDelay) continue;
      const t = (i - preDelay) / (len - preDelay);
      const env = Math.pow(1 - t, 2) * Math.exp(-t * 3);
      // One-pole low-pass whose coefficient closes over time = darker tail.
      const coef = 1 - Math.min(0.97, damp * 0.9 * t + 0.05);
      lp += coef * ((rand() * 2 - 1) - lp);
      d[i] = lp * env;
    }
    // Early reflections give the space a sense of size.
    for (let e = 0; e < 8; e++) {
      const pos = preDelay + Math.floor(sr * (0.005 + rand() * 0.06));
      if (pos < len) d[pos] += (rand() * 2 - 1) * 0.5 * (1 - e / 8);
    }
  }
  // Normalize energy so different sizes sit at a similar loudness.
  let sum = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) sum += d[i] * d[i];
  }
  const g = 1 / Math.sqrt(sum / 2 + 1e-9) * 0.9;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}

const pulseCache = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();

/** Band-limited pulse wave of the given duty cycle (Fourier series). */
export function pulseWave(ctx: BaseAudioContext, pw: number): PeriodicWave {
  const key = Math.round(Math.min(0.95, Math.max(0.05, pw)) * 100);
  let map = pulseCache.get(ctx);
  if (!map) pulseCache.set(ctx, (map = new Map()));
  let wave = map.get(key);
  if (!wave) {
    const w = key / 100;
    const n = 256;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      real[k] = Math.sin(2 * Math.PI * k * w) / (k * Math.PI);
      imag[k] = (1 - Math.cos(2 * Math.PI * k * w)) / (k * Math.PI);
    }
    wave = ctx.createPeriodicWave(real, imag);
    map.set(key, wave);
  }
  return wave;
}

/** Freeze a param's current automation at `t` (Firefox lacks cancelAndHold). */
export function holdAt(param: AudioParam, t: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (p.cancelAndHoldAtTime) {
    p.cancelAndHoldAtTime(t);
  } else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
  }
}

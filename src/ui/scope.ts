// Master oscilloscope + spectrum analyzer + peak meter.

import { engine } from '../app';
import { h } from './dom';

export class Scope {
  readonly el: HTMLElement;
  private readonly wave: HTMLCanvasElement;
  private readonly spec: HTMLCanvasElement;
  private readonly meter: HTMLElement;
  private readonly time: Float32Array<ArrayBuffer>;
  private readonly freq: Float32Array<ArrayBuffer>;
  private peakHold = -60;

  constructor() {
    this.wave = h('canvas', { class: 'scope-wave', 'aria-label': 'Oscilloscope' });
    this.spec = h('canvas', { class: 'scope-spec', 'aria-label': 'Spectrum analyzer' });
    this.meter = h('div', { class: 'meter-fill' });
    this.el = h(
      'div',
      { class: 'scope', title: 'Master output: waveform, spectrum and peak level' },
      this.wave,
      this.spec,
      h('div', { class: 'meter' }, this.meter),
    );
    const a = engine.analyser;
    this.time = new Float32Array(a.fftSize);
    this.freq = new Float32Array(a.frequencyBinCount);
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private fit(c: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const ht = c.clientHeight;
    if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(ht * dpr)) {
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(ht * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, ht);
    return [g, w, ht];
  }

  private draw(): void {
    if (document.hidden) return;
    const a = engine.analyser;
    a.getFloatTimeDomainData(this.time);
    a.getFloatFrequencyData(this.freq);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim();
    const accent2 = css.getPropertyValue('--accent-2').trim();

    // Waveform: trigger on a rising zero crossing for a stable picture
    let [g, w, ht] = this.fit(this.wave);
    const d = this.time;
    let start = 0;
    for (let i = 1; i < d.length / 2; i++) {
      if (d[i - 1] < 0 && d[i] >= 0) {
        start = i;
        break;
      }
    }
    const n = Math.min(1024, d.length - start);
    g.strokeStyle = accent;
    g.lineWidth = 1.5;
    g.beginPath();
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = d[start + i];
      const x = (i / (n - 1)) * w;
      const y = ht / 2 - v * (ht / 2 - 2);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    g.stroke();

    // Spectrum on a log frequency axis
    [g, w, ht] = this.fit(this.spec);
    const sr = engine.ctx.sampleRate;
    const bins = this.freq.length;
    const fMin = 30;
    const fMax = 18000;
    g.beginPath();
    g.moveTo(0, ht);
    for (let x = 0; x <= w; x += 2) {
      const f = fMin * Math.pow(fMax / fMin, x / w);
      const bin = Math.min(bins - 1, Math.round((f / (sr / 2)) * bins));
      const db = this.freq[bin];
      const y = ht - Math.max(0, Math.min(1, (db + 100) / 80)) * ht;
      g.lineTo(x, y);
    }
    g.lineTo(w, ht);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, ht);
    grad.addColorStop(0, accent2);
    grad.addColorStop(1, accent2 + '10');
    g.fillStyle = grad;
    g.fill();

    // Peak meter (-48..0 dBFS)
    const db = 20 * Math.log10(peak || 1e-6);
    this.peakHold = Math.max(db, this.peakHold - 0.6);
    const pct = Math.max(0, Math.min(1, (this.peakHold + 48) / 48));
    this.meter.style.height = `${pct * 100}%`;
    this.meter.classList.toggle('hot', this.peakHold > -1);
  }
}

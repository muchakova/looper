// Live transport: a lookahead scheduler that feeds the engine a few hundred
// milliseconds ahead of the audio clock, so timing is sample-accurate even
// though the JS timer itself is jittery.

import type { Engine } from './engine';

export class Transport {
  playing = false;
  private anchorTime = 0;
  private anchorBeat = 0;
  private bpm = 120;
  private scheduledTo = 0;
  private timer: number | null = null;
  private reported = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly engine: Engine,
  ) {}

  async start(): Promise<void> {
    if (this.playing) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.engine.apply();
    this.bpm = this.engine.project.bpm;
    this.anchorTime = this.ctx.currentTime + 0.1;
    this.anchorBeat = 0;
    this.scheduledTo = 0;
    this.engine.restartModulation(this.anchorTime);
    this.playing = true;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.engine.allOff(this.ctx.currentTime);
  }

  /** Keep the playhead continuous when the tempo changes mid-play. */
  setBpm(bpm: number): void {
    if (this.playing) {
      const now = this.ctx.currentTime;
      this.anchorBeat = this.timeToBeat(Math.max(now, this.anchorTime));
      this.anchorTime = Math.max(now, this.anchorTime);
    }
    this.bpm = bpm;
  }

  /** Current position in beats inside the loop (null when stopped). */
  position(): number | null {
    if (!this.playing) return null;
    const b = this.timeToBeat(this.ctx.currentTime - (this.ctx.outputLatency || 0));
    if (b < 0) return 0;
    const L = this.engine.project.bars * 4;
    return b % L;
  }

  /** Which pass through the loop is playing (0-based), or null when stopped. */
  pass(): number | null {
    if (!this.playing) return null;
    const b = this.timeToBeat(this.ctx.currentTime - (this.ctx.outputLatency || 0));
    return Math.max(0, Math.floor(b / (this.engine.project.bars * 4)));
  }

  private beatToTime = (b: number): number => this.anchorTime + ((b - this.anchorBeat) * 60) / this.bpm;

  private timeToBeat(t: number): number {
    return this.anchorBeat + ((t - this.anchorTime) * this.bpm) / 60;
  }

  private tick(): void {
    // Background tabs throttle timers to ~1 s, so look further ahead there.
    const lookahead = document.hidden ? 1.6 : 0.16;
    const to = this.timeToBeat(this.ctx.currentTime + lookahead);
    if (to <= this.scheduledTo) return;
    try {
      this.engine.scheduleRange(this.scheduledTo, to, this.beatToTime);
    } catch (err) {
      // Never retry the same range: a repeated error would re-create the same
      // voices every 25 ms and lock up the CPU. Report once and move on.
      if (!this.reported) console.error('LoopForge scheduler error:', err);
      this.reported = true;
    } finally {
      this.scheduledTo = to;
    }
  }
}

// Top bar: transport, song settings (tempo, length, swing, key, scale),
// undo/redo, project files, WAV export and master section.

import { changed, commit, togglePlay, transport } from '../app';
import { encodeWav, peakDb, renderProject, type ExportOptions } from '../audio/export';
import { NOTE_NAMES, SCALES } from '../state/music';
import { BAR_OPTIONS, blankProject, demoProject, normalizeProject, store } from '../state/project';
import { SAMPLES } from '../state/samples';
import { h, icon, segmented, select, toast } from './dom';
import { fmt, knob } from './knob';
import { Scope } from './scope';

type Refreshable = { refresh(): void };

export class TopBar {
  readonly el: HTMLElement;
  private controls: Refreshable[] = [];
  private playBtn: HTMLButtonElement;
  private bpmInput: HTMLInputElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private nameInput: HTMLInputElement;

  constructor() {
    const P = () => store.project;
    const add = <T extends Refreshable>(c: T) => (this.controls.push(c), c);

    this.playBtn = h('button', { class: 'play-btn', type: 'button', title: 'Play / Stop (Space)', 'aria-label': 'Play', onclick: () => void togglePlay() }, icon('play'));

    this.bpmInput = h('input', {
      class: 'num',
      type: 'number',
      min: 40,
      max: 240,
      step: 1,
      'aria-label': 'Tempo (BPM)',
      title: 'Tempo in beats per minute',
    });
    this.bpmInput.addEventListener('change', () => {
      const v = Math.max(40, Math.min(240, Math.round(+this.bpmInput.value || 120)));
      this.bpmInput.value = String(v);
      P().bpm = v;
      transport.setBpm(v);
      commit('transport');
    });
    this.controls.push({ refresh: () => (this.bpmInput.value = String(P().bpm)) });

    const bars = add(
      select(
        BAR_OPTIONS.map((b) => [String(b), String(b)] as [string, string]),
        () => String(P().bars),
        (v) => {
          P().bars = +v;
          commit('all');
        },
        { 'aria-label': 'Length in bars', title: 'Length in bars: 1–8 for short loops, 16–32 for a whole piece' },
      ),
    );

    const swing = add(
      knob({
        label: 'Swing',
        min: 0,
        max: 1,
        def: 0,
        size: 'sm',
        get: () => P().swing,
        set: (v) => {
          P().swing = v;
          changed('transport');
        },
        format: fmt.pct,
        onCommit: () => commit('transport'),
      }),
    );

    const keySel = add(
      select(
        NOTE_NAMES.map((n, i) => [String(i), n] as [string, string]),
        () => String(P().key),
        (v) => {
          P().key = +v;
          commit('notes');
        },
        { 'aria-label': 'Key', title: 'Key (root note)' },
      ),
    );
    const scaleSel = add(
      select(
        Object.entries(SCALES).map(([k, s]) => [k, s.label] as [string, string]),
        () => P().scale,
        (v) => {
          P().scale = v;
          commit('notes');
        },
        { 'aria-label': 'Scale', title: 'Scale: notes outside it are dimmed in the piano roll' },
      ),
    );

    this.undoBtn = h('button', { class: 'btn icon-btn', type: 'button', title: 'Undo (Ctrl/Cmd+Z)', 'aria-label': 'Undo', onclick: () => store.undo() }, icon('undo'));
    this.redoBtn = h('button', { class: 'btn icon-btn', type: 'button', title: 'Redo (Ctrl/Cmd+Shift+Z)', 'aria-label': 'Redo', onclick: () => store.redo() }, icon('redo'));

    this.nameInput = h('input', { class: 'proj-name', type: 'text', 'aria-label': 'Project name', spellcheck: false });
    this.nameInput.addEventListener('change', () => {
      P().name = this.nameInput.value.trim() || 'Untitled loop';
      commit('transport');
    });
    this.controls.push({ refresh: () => (this.nameInput.value = P().name) });

    const fileInput = h('input', { type: 'file', accept: '.json,.loopforge,application/json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (!f) return;
      try {
        const p = normalizeProject(JSON.parse(await f.text()));
        transport.stop();
        store.load(p);
        toast(`Opened “${p.name}”`);
      } catch (err) {
        toast(`Could not open file: ${(err as Error).message}`, 'error');
      }
    });

    const newMenu = h(
      'select',
      { class: 'sel new-sel', 'aria-label': 'New project or sample', title: 'Start a new project or open a ready-made sample' },
      h('option', { value: '' }, 'New…'),
      h('optgroup', { label: 'New' }, h('option', { value: 'blank' }, 'Empty project'), h('option', { value: 'demo' }, 'Demo loop')),
      h('optgroup', { label: 'Samples' }, ...SAMPLES.map((s) => h('option', { value: `sample:${s.id}` }, s.label))),
    );
    newMenu.addEventListener('change', () => {
      const v = newMenu.value;
      newMenu.value = '';
      if (!v) return;
      const sample = SAMPLES.find((s) => `sample:${s.id}` === v);
      if (!confirm(sample ? `Open the sample “${sample.label}”? (You can still undo this.)` : 'Start a new project? (You can still undo this.)')) return;
      transport.stop();
      store.load(sample ? sample.load() : v === 'demo' ? demoProject() : blankProject());
      if (sample) toast(`Opened sample “${store.project.name}”`);
    });

    this.el = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('div', { class: 'logo', 'aria-hidden': 'true' }), h('div', { class: 'brand-text' }, h('strong', {}, 'LoopForge'), this.nameInput)),
      h(
        'div',
        { class: 'tb-group transport' },
        this.playBtn,
        h('label', { class: 'tb-field' }, h('span', {}, 'BPM'), this.bpmInput),
        h('div', { class: 'tb-field' }, h('span', {}, 'Bars'), bars),
        swing,
      ),
      h('div', { class: 'tb-group tb-key' }, h('label', { class: 'tb-field' }, h('span', {}, 'Key'), keySel), h('label', { class: 'tb-field' }, h('span', {}, 'Scale'), scaleSel)),
      h(
        'div',
        { class: 'tb-group tb-file' },
        this.undoBtn,
        this.redoBtn,
        newMenu,
        h('button', { class: 'btn icon-btn', type: 'button', onclick: () => fileInput.click(), title: 'Open a project file', 'aria-label': 'Open project' }, icon('folder')),
        h('button', { class: 'btn icon-btn', type: 'button', onclick: () => saveProject(), title: 'Save the project as a file (Ctrl/Cmd+S)', 'aria-label': 'Save project' }, icon('save')),
        fileInput,
      ),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openExport(), title: 'Render a seamless WAV loop' }, icon('download'), 'Export WAV'),
      h('button', { class: 'btn icon-btn help-btn', type: 'button', title: 'Туториал за начинаещи', 'aria-label': 'Туториал', onclick: () => window.dispatchEvent(new Event('loopforge:tutorial')) }, '?'),
      new Scope().el,
    );
    this.refresh();
  }

  refresh(): void {
    for (const c of this.controls) c.refresh();
    this.refreshTransport();
  }

  refreshTransport(): void {
    const playing = transport.playing;
    this.playBtn.replaceChildren(icon(playing ? 'stop' : 'play'));
    this.playBtn.classList.toggle('on', playing);
    this.playBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
    this.undoBtn.disabled = !store.canUndo();
    this.redoBtn.disabled = !store.canRedo();
  }
}

function fileSafe(name: string): string {
  return name.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().replace(/\s+/g, '-') || 'loop';
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function saveProject(): void {
  const p = store.project;
  download(new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' }), `${fileSafe(p.name)}.loopforge.json`);
  toast('Project saved');
}

// ── Export dialog ─────────────────────────────────────────────────────────

let exportOpts: ExportOptions = { sampleRate: 48000, bitDepth: 24, repeats: 1, seamless: true, normalize: true };

export function openExport(): void {
  const p = store.project;
  const loopSec = (p.bars * 4 * 60) / p.bpm;
  const o = { ...exportOpts };
  const info = h('p', { class: 'dlg-info' });
  const updateInfo = () => {
    info.textContent = `${p.bars} bar${p.bars > 1 ? 's' : ''} × ${o.repeats} = ${(loopSec * o.repeats).toFixed(2)} s at ${p.bpm} BPM`;
  };
  const progress = h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-fill' }));
  const status = h('p', { class: 'dlg-status', role: 'status' });
  const goBtn = h('button', { class: 'btn primary', type: 'button' }, icon('download'), 'Render & download');
  const closeBtn = h('button', { class: 'btn', type: 'button' }, 'Close');

  const field = (label: string, ctrl: Node, hint?: string) =>
    h('div', { class: 'dlg-field' }, h('span', { class: 'dlg-label' }, label), ctrl, hint ? h('small', {}, hint) : null);

  const dlg = h(
    'dialog',
    { class: 'dialog', 'aria-label': 'Export WAV' },
    h('h2', {}, 'Export WAV loop'),
    info,
    field('Sample rate', segmented<number>([[44100, '44.1 kHz'], [48000, '48 kHz']], () => o.sampleRate, (v) => (o.sampleRate = v as 44100 | 48000)), '48 kHz matches most video projects.'),
    field('Bit depth', segmented<number>([[16, '16-bit'], [24, '24-bit']], () => o.bitDepth, (v) => (o.bitDepth = v as 16 | 24))),
    field('Repeats', segmented<number>([[1, '×1'], [2, '×2'], [4, '×4'], [8, '×8']], () => o.repeats, (v) => { o.repeats = v; updateInfo(); }), 'How many times the loop is written into the file.'),
    field(
      'Seamless loop',
      segmented<string>([['on', 'On'], ['off', 'Off (with tail)']], () => (o.seamless ? 'on' : 'off'), (v) => (o.seamless = v === 'on')),
      'On: reverb/delay tails wrap to the start so the file repeats without a click. Off: the file ends with the natural fade-out.',
    ),
    field('Normalize', segmented<string>([['on', 'On (−0.3 dB)'], ['off', 'Off']], () => (o.normalize ? 'on' : 'off'), (v) => (o.normalize = v === 'on'))),
    progress,
    status,
    h('div', { class: 'dlg-actions' }, closeBtn, goBtn),
  );
  updateInfo();
  document.body.append(dlg);
  dlg.showModal();
  closeBtn.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());

  goBtn.addEventListener('click', async () => {
    exportOpts = { ...o };
    goBtn.disabled = true;
    progress.hidden = false;
    const fill = progress.firstElementChild as HTMLElement;
    status.textContent = 'Rendering…';
    try {
      const t0 = performance.now();
      const buf = await renderProject(store.project, o, (x) => (fill.style.width = `${Math.round(x * 100)}%`));
      const blob = encodeWav(buf, o.bitDepth);
      const name = `${fileSafe(store.project.name)}-${store.project.bpm}bpm${o.seamless ? '-loop' : ''}.wav`;
      download(blob, name);
      status.textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s — ${name} (${(blob.size / 1048576).toFixed(1)} MB, peak ${peakDb(buf).toFixed(1)} dBFS)`;
    } catch (err) {
      status.textContent = `Export failed: ${(err as Error).message}`;
    } finally {
      goBtn.disabled = false;
    }
  });
}

import './style.css';
import { engine, ensureAudio } from './app';
import { store, type ChangeKind } from './state/project';
import { h } from './ui/dom';
import { installKeyboard, onOctave } from './ui/keyboard';
import { PianoRoll } from './ui/piano-roll';
import { StepSequencer } from './ui/step-sequencer';
import { FxPanel, SynthPanel } from './ui/synth-panel';
import { TopBar } from './ui/topbar';
import { TrackList } from './ui/tracks';
import { Tutorial } from './ui/tutorial';
import { NOTE_NAMES } from './state/music';
import type { DrumTrack } from './state/types';

const app = document.getElementById('app')!;
const topbar = new TopBar();
const tracks = new TrackList();
const roll = new PianoRoll();
const seq = new StepSequencer();
const editorHost = h('section', { class: 'editor', 'aria-label': 'Editor' });
const soundHost = h('div', { class: 'sound-host' });
const octaveHint = h('span', {});
onOctave((o) => (octaveHint.textContent = `${NOTE_NAMES[0]}${o}`));

let sound: SynthPanel | FxPanel | null = null;
let soundFor = -1;

function mountEditor(): void {
  const isDrums = store.track.kind === 'drums';
  const want = isDrums ? seq.el : roll.el;
  if (editorHost.firstElementChild !== want) editorHost.replaceChildren(want);
  if (isDrums) seq.refresh();
  else roll.refresh();
}

function mountSound(force = false): void {
  if (!force && soundFor === store.selected && sound) {
    sound.refresh();
    return;
  }
  soundFor = store.selected;
  const t = store.track;
  const idx = store.selected;
  sound =
    t.kind === 'synth'
      ? new SynthPanel(idx)
      : new FxPanel(() => (store.project.tracks[idx] as DrumTrack).fx, 'Drum bus effects');
  soundHost.replaceChildren(
    h('div', { class: 'sound-title', style: `--tc:${t.color}` }, h('span', { class: 'dot' }), `${t.name} — sound`),
    sound.el,
  );
}

app.append(
  topbar.el,
  h('main', { class: 'workspace' }, tracks.el, editorHost),
  soundHost,
  h(
    'footer',
    { class: 'statusbar' },
    h('span', {}, 'Computer keyboard: ', h('kbd', {}, 'A'), '–', h('kbd', {}, 'K'), ' play notes · ', h('kbd', {}, 'Z'), '/', h('kbd', {}, 'X'), ' octave (', octaveHint, ') · ', h('kbd', {}, '1'), '–', h('kbd', {}, '5'), ' tracks · ', h('kbd', {}, 'Space'), ' play/stop · ', h('kbd', {}, '↑↓'), ' transpose · ', h('kbd', {}, '←→'), ' move'),
    h('span', { class: 'status-right' }, h('button', { class: 'link-btn', type: 'button', onclick: () => window.dispatchEvent(new Event('loopforge:tutorial')) }, 'Туториал за начинаещи'), ' · Autosaved in this browser'),
  ),
);

mountEditor();
mountSound(true);
installKeyboard(roll);
const tutorial = new Tutorial(roll);
tutorial.offerOnFirstVisit();

store.on((kind: ChangeKind) => {
  switch (kind) {
    case 'all':
      topbar.refresh();
      tracks.refresh();
      mountEditor();
      mountSound(true);
      break;
    case 'select':
      tracks.refresh();
      mountEditor();
      mountSound();
      break;
    case 'notes':
      roll.invalidate();
      topbar.refreshTransport();
      break;
    case 'mixer':
      tracks.refreshKnobs();
      topbar.refreshTransport();
      break;
    case 'transport':
      topbar.refreshTransport();
      roll.invalidate();
      break;
    case 'params':
      topbar.refreshTransport();
      break;
  }
});

// Track list text (preset names, note counts) after edits finish
let listTimer: number | null = null;
store.on((kind) => {
  if (kind === 'notes' || kind === 'params') {
    if (listTimer !== null) clearTimeout(listTimer);
    listTimer = window.setTimeout(() => {
      if (!document.querySelector('.track-name:not([readonly])')) tracks.refresh();
    }, 300);
  }
});

// Browsers only allow audio after a user gesture.
const unlock = () => void ensureAudio();
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

// For debugging and automated checks
(window as unknown as Record<string, unknown>).loopforge = { store, engine };

// Global keyboard: transport/undo shortcuts, piano-roll editing commands and
// "musical typing" (play the selected track from the computer keyboard).
// Physical key codes are used so it works with any layout (e.g. Bulgarian).

import { audioCtx, engine, ensureAudio, togglePlay } from '../app';
import { DRUM_VOICES } from '../audio/drums';
import { store } from '../state/project';
import type { PianoRoll } from './piano-roll';
import { saveProject } from './topbar';

// Two rows like a piano: white keys on A S D F…, black keys on W E T Y U…
const NOTE_KEYS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

let octave = 4;
const held = new Map<string, number>();
const listeners = new Set<(oct: number) => void>();

export function onOctave(fn: (oct: number) => void): void {
  listeners.add(fn);
  fn(octave);
}

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  if (t instanceof HTMLInputElement) return !t.readOnly && t.type !== 'range' && t.type !== 'button';
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}

export function installKeyboard(roll: PianoRoll): void {
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const code = e.code;
    const synth = store.track.kind === 'synth';

    if (code === 'Space') {
      e.preventDefault();
      if (!e.repeat) void togglePlay();
      return;
    }
    if (mod) {
      let handled = true;
      if (code === 'KeyZ' && !e.shiftKey) store.undo();
      else if ((code === 'KeyZ' && e.shiftKey) || code === 'KeyY') store.redo();
      else if (code === 'KeyS') saveProject();
      else if (synth && code === 'KeyA') roll.selectAll();
      else if (synth && code === 'KeyC') roll.copy();
      else if (synth && code === 'KeyV') roll.paste();
      else if (synth && code === 'KeyD') roll.duplicate();
      else if (synth && code === 'KeyX') {
        roll.copy();
        roll.deleteSelected();
      } else handled = false;
      if (handled) e.preventDefault();
      return;
    }
    if (e.altKey) return;

    if (synth) {
      if (code === 'Delete' || code === 'Backspace') {
        e.preventDefault();
        roll.deleteSelected();
        return;
      }
      if (code === 'Escape') return roll.deselect();
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        e.preventDefault();
        roll.transpose((code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
        return;
      }
      if (code === 'ArrowLeft' || code === 'ArrowRight') {
        e.preventDefault();
        roll.nudge(code === 'ArrowRight' ? 1 : -1);
        return;
      }
    }

    const digit = /^Digit([1-9])$/.exec(code);
    if (digit) {
      const i = +digit[1] - 1;
      if (i < store.project.tracks.length) store.select(i);
      return;
    }
    if (code === 'KeyZ' || code === 'KeyX') {
      octave = Math.max(1, Math.min(7, octave + (code === 'KeyZ' ? -1 : 1)));
      for (const fn of listeners) fn(octave);
      return;
    }

    const semi = NOTE_KEYS[code];
    if (semi === undefined || e.repeat || held.has(code)) return;
    e.preventDefault();
    void ensureAudio().then(() => {
      const t = audioCtx.currentTime + 0.005;
      if (store.track.kind === 'drums') {
        const v = DRUM_VOICES[semi % DRUM_VOICES.length];
        engine.drums(store.selected)?.trigger(v, 0.85, t);
        held.set(code, -1);
        return;
      }
      const pitch = (octave + 1) * 12 + semi;
      engine.synth(store.selected)?.noteOn(pitch, 0.8, t);
      held.set(code, pitch);
    });
  });

  window.addEventListener('keyup', (e) => {
    const pitch = held.get(e.code);
    if (pitch === undefined) return;
    held.delete(e.code);
    if (pitch >= 0) engine.synth(store.selected)?.releasePitch(pitch, audioCtx.currentTime + 0.005);
  });

  // Releasing everything when the window loses focus avoids stuck notes.
  window.addEventListener('blur', () => {
    for (const [, pitch] of held) if (pitch >= 0) engine.synth(store.selected)?.releasePitch(pitch, audioCtx.currentTime);
    held.clear();
  });
}

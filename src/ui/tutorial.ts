// Interactive step-by-step tutorial (in Bulgarian) for absolute beginners:
// builds a 4-bar loop from an empty project — drums, bass, chords, melody,
// sound, mix and WAV export. Each step highlights the control it talks about
// and ticks itself off when the task is done.

import { commit, transport } from '../app';
import { blankProject, newNoteId, store } from '../state/project';
import type { DrumTrack, DrumVoice, Note, StepParams, SynthTrack, Track } from '../state/types';
import { h } from './dom';
import type { PianoRoll } from './piano-roll';

interface Action {
  label: string;
  run: () => void;
}

interface Step {
  title: string;
  body: string; // trusted static HTML
  target?: () => Element | null;
  task?: string;
  check?: () => boolean;
  actions?: Action[];
  onEnter?: () => void;
}

const LS_STEP = 'loopforge.tutorialStep';
const LS_SEEN = 'loopforge.tutorialSeen';

function trackIndex(name: string, kind: Track['kind'] = 'synth'): number {
  const tracks = store.project.tracks;
  let i = tracks.findIndex((t) => t.kind === kind && t.name.toLowerCase() === name.toLowerCase());
  if (i < 0 && kind === 'drums') i = tracks.findIndex((t) => t.kind === 'drums');
  return i;
}

function synthTrack(name: string): SynthTrack | null {
  const i = trackIndex(name);
  return i >= 0 ? (store.project.tracks[i] as SynthTrack) : null;
}

function drumTrack(): DrumTrack | null {
  const i = trackIndex('', 'drums');
  return i >= 0 ? (store.project.tracks[i] as DrumTrack) : null;
}

function trackRow(name: string, kind: Track['kind'] = 'synth'): Element | null {
  return document.querySelectorAll('.tracks .track')[trackIndex(name, kind)] ?? null;
}

const q = (sel: string) => () => document.querySelector(sel);

function isSelected(name: string, kind: Track['kind'] = 'synth'): boolean {
  return store.selected === trackIndex(name, kind);
}

function selectTrack(name: string, kind: Track['kind'] = 'synth'): void {
  const i = trackIndex(name, kind);
  if (i >= 0) store.select(i);
}

/** Replace a track's notes with an example (undoable). */
function setNotes(name: string, notes: Omit<Note, 'id'>[]): void {
  const t = synthTrack(name);
  if (!t) return;
  t.notes = notes.map((n) => ({ ...n, id: newNoteId() }));
  commit('notes');
}

export class Tutorial {
  private card: HTMLElement | null = null;
  private ring: HTMLElement;
  private index = 0;
  private steps: Step[];
  private playedOnce = false;
  private exportOpened = false;
  private raf = 0;
  private poll = 0;
  private collapsed = false;
  /** State captured when a step starts, for "did you change something?" checks. */
  private snap = '';
  /** Steps whose task was completed once stay ticked (e.g. Solo on, then off). */
  private latched = new Set<number>();

  constructor(private readonly roll: PianoRoll) {
    this.ring = h('div', { class: 'tut-ring', 'aria-hidden': 'true' });
    this.steps = this.buildSteps();
    window.addEventListener('loopforge:tutorial', () => this.open());
    store.on(() => this.update());
  }

  /** On the very first visit, offer the tutorial. */
  offerOnFirstVisit(): void {
    let seen = false;
    try {
      seen = localStorage.getItem(LS_SEEN) === '1';
    } catch {
      /* storage unavailable: offer anyway */
    }
    if (seen) return;
    const bubble = h(
      'div',
      { class: 'tut-offer', role: 'dialog', 'aria-label': 'Туториал' },
      h('strong', {}, 'За първи път тук?'),
      h('p', {}, 'Туториалът ще те преведе стъпка по стъпка: ще направиш собствен loop от нулата за около 15 минути. Не са нужни музикални познания.'),
      h(
        'div',
        { class: 'tut-actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { markSeen(); bubble.remove(); } }, 'Не сега'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { bubble.remove(); this.open(0); } }, 'Започни туториала'),
      ),
    );
    document.body.append(bubble);
  }

  open(start?: number): void {
    markSeen();
    this.latched.clear();
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(LS_STEP) ?? 0) || 0;
    } catch {
      /* ignore */
    }
    this.index = Math.max(0, Math.min(this.steps.length - 1, start ?? saved));
    if (!this.card) {
      this.card = h('aside', { class: 'tut-card', role: 'dialog', 'aria-label': 'Туториал', 'aria-live': 'polite' });
      document.body.append(this.ring, this.card);
      this.makeDraggable(this.card);
      const follow = () => {
        this.positionRing();
        this.raf = requestAnimationFrame(follow);
      };
      this.raf = requestAnimationFrame(follow);
      // Some tasks (playback, export dialog) are not store changes: poll them.
      this.poll = window.setInterval(() => {
        if (transport.playing) this.playedOnce = true;
        if (document.querySelector('dialog[open]')) this.exportOpened = true;
        this.update();
      }, 400);
    }
    this.enter();
  }

  close(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.poll);
    this.card?.remove();
    this.ring.remove();
    this.card = null;
  }

  private go(delta: number): void {
    this.index = Math.max(0, Math.min(this.steps.length - 1, this.index + delta));
    this.enter();
  }

  private enter(): void {
    try {
      localStorage.setItem(LS_STEP, String(this.index));
    } catch {
      /* ignore */
    }
    const step = this.steps[this.index];
    step.onEnter?.();
    this.collapsed = false;
    this.render();
    const target = step.target?.();
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private update(): void {
    if (!this.card) return;
    const step = this.steps[this.index];
    const done = this.latched.has(this.index) || !!step.check?.();
    if (done) this.latched.add(this.index);
    const taskEl = this.card.querySelector('.tut-task');
    if (taskEl) taskEl.classList.toggle('done', done);
    this.card.querySelector('.tut-next')?.classList.toggle('pulse', done);
  }

  private render(): void {
    const card = this.card;
    if (!card) return;
    const step = this.steps[this.index];
    const n = this.steps.length;
    const last = this.index === n - 1;
    const body = h('div', { class: 'tut-body' });
    body.innerHTML = step.body;
    const children: (Node | null)[] = [
      h(
        'div',
        { class: 'tut-head' },
        h('span', { class: 'tut-count' }, `Стъпка ${this.index + 1} от ${n}`),
        h('button', { class: 'tut-icon', type: 'button', title: this.collapsed ? 'Разгъни' : 'Свий', 'aria-label': 'Свий или разгъни', onclick: () => { this.collapsed = !this.collapsed; card.classList.toggle('collapsed', this.collapsed); } }, '–'),
        h('button', { class: 'tut-icon', type: 'button', title: 'Затвори туториала', 'aria-label': 'Затвори туториала', onclick: () => this.close() }, '×'),
      ),
      h('div', { class: 'tut-progress' }, h('div', { style: `width:${((this.index + 1) / n) * 100}%` })),
      h('h2', { class: 'tut-title' }, step.title),
      body,
      step.task ? h('div', { class: 'tut-task' }, h('span', { class: 'tut-check', 'aria-hidden': 'true' }), h('span', {}, step.task)) : null,
      step.actions?.length
        ? h('div', { class: 'tut-helpers' }, ...step.actions.map((a) => h('button', { class: 'btn ghost', type: 'button', onclick: () => { a.run(); this.update(); } }, a.label)))
        : null,
      h(
        'div',
        { class: 'tut-actions' },
        this.index > 0 ? h('button', { class: 'btn ghost', type: 'button', onclick: () => this.go(-1) }, '← Назад') : h('span', {}),
        last
          ? h('button', { class: 'btn primary', type: 'button', onclick: () => { this.close(); try { localStorage.setItem(LS_STEP, '0'); } catch { /* ignore */ } } }, 'Готово')
          : h('button', { class: 'btn primary tut-next', type: 'button', onclick: () => this.go(1) }, 'Напред →'),
      ),
    ];
    card.replaceChildren(...children.filter((c): c is Node => c !== null));
    card.classList.toggle('collapsed', this.collapsed);
    this.update();
  }

  private positionRing(): void {
    const el = this.card ? this.steps[this.index].target?.() : null;
    if (!el) {
      this.ring.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      this.ring.style.display = 'none';
      return;
    }
    this.ring.style.display = 'block';
    this.ring.style.left = `${r.left - 4}px`;
    this.ring.style.top = `${r.top - 4}px`;
    this.ring.style.width = `${r.width + 8}px`;
    this.ring.style.height = `${r.height + 8}px`;
  }

  private makeDraggable(card: HTMLElement): void {
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    card.addEventListener('pointerdown', (e) => {
      const head = (e.target as HTMLElement).closest('.tut-head');
      if (!head || (e.target as HTMLElement).closest('button')) return;
      const r = card.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
      card.setPointerCapture(e.pointerId);
    });
    card.addEventListener('pointermove', (e) => {
      if (!card.hasPointerCapture(e.pointerId)) return;
      const x = Math.max(0, Math.min(window.innerWidth - 80, ox + e.clientX - sx));
      const y = Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy));
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      card.style.right = 'auto';
      card.style.bottom = 'auto';
    });
    card.addEventListener('pointerup', (e) => {
      if (card.hasPointerCapture(e.pointerId)) card.releasePointerCapture(e.pointerId);
    });
  }

  // ── The lesson ────────────────────────────────────────────────────────

  private buildSteps(): Step[] {
    const roll = this.roll;
    const synths = () => store.project.tracks.filter((t): t is SynthTrack => t.kind === 'synth');
    // "Change something" steps: remember the state on entry, done once it differs.
    const changedSince = (read: () => unknown) => ({
      onEnter: () => {
        this.snap = JSON.stringify(read());
      },
      check: () => this.snap !== '' && JSON.stringify(read()) !== this.snap,
    });
    const notes = (name: string) => synthTrack(name)?.notes.length ?? 0;
    const hits = (v: DrumVoice) => drumTrack()?.pattern[v].filter(Boolean).length ?? 0;

    return [
      {
        title: 'Добре дошъл в LoopForge 👋',
        body: `<p>Ще направим заедно <b>loop</b> — кратка музикална фраза от 4 такта, която се повтаря безкрайно. Точно такава музика се слага под видео.</p>
<p>Ще минем през 4 слоя, както се прави истинска песен:</p>
<ol><li><b>Барабани</b> — ритъмът</li><li><b>Бас</b> — основата</li><li><b>Акорди</b> — настроението</li><li><b>Мелодия</b> — това, което се запомня</li></ol>
<p>После ще изберем звуци, ще ги смесим и ще изнесем WAV файл. Карето може да се мести — хвани го за горната лента.</p>`,
        task: 'Започни с празен проект (текущият се връща с Ctrl+Z).',
        check: () => store.project.tracks.every((t) => t.kind !== 'synth' || t.notes.length === 0),
        actions: [
          {
            label: 'Започни с празен проект',
            run: () => {
              transport.stop();
              const p = blankProject();
              p.name = 'Моят първи loop';
              store.load(p);
            },
          },
        ],
      },
      {
        title: 'Play и Stop',
        body: `<p>Големият кръгъл бутон <b>▶</b> пуска loop-а, а повторно натискане го спира. По-бързо е с клавиша <kbd>Space</kbd>.</p>
<p>Сега проектът е празен, затова ще е тихо — това е нормално. Ще пускаш loop-а често, за да чуваш какво се получава.</p>`,
        target: q('.play-btn'),
        task: 'Натисни Play (или Space), после пак за стоп.',
        check: () => this.playedOnce,
      },
      {
        title: 'Темпо и дължина',
        body: `<p><b>BPM</b> е скоростта — колко удара в минута. Ориентир:</p>
<ul><li><b>70–90</b> — спокойно, lo-fi, кинематографично</li><li><b>90–110</b> — поп, хип-хоп</li><li><b>120–128</b> — танцова музика</li><li><b>140+</b> — енергично, рок</li></ul>
<p><b>Bars</b> е дължината на loop-а в тактове. Един такт е 4 удара (раз-два-три-четири). Остави <b>4</b> — най-удобно е за видео.</p>`,
        target: q('.tb-group.transport'),
        task: 'По желание смени BPM (например 95). Остави Bars на 4.',
        check: () => store.project.bars === 4,
      },
      {
        title: 'Тоналност — настроението',
        body: `<p><b>Key</b> и <b>Scale</b> определят кои ноти „си пасват“.</p>
<ul><li><b>Minor</b> (минор) звучи тъжно, мечтателно, кинематографично.</li><li><b>Major</b> (мажор) звучи весело и светло.</li></ul>
<p>За туториала остави <b>A Minor</b> — примерите по-нататък са в тази тоналност. В piano roll-а нотите от гамата са по-светли, а <b>Scale lock</b> не позволява да сложиш фалшива нота.</p>`,
        target: q('.tb-key'),
        task: 'Провери, че е избрано A и Minor.',
        check: () => store.project.key === 9 && store.project.scale === 'minor',
        actions: [
          {
            label: 'Сложи A Minor вместо мен',
            run: () => {
              store.project.key = 9;
              store.project.scale = 'minor';
              commit('all');
            },
          },
        ],
      },
      {
        title: 'Слой 1: Барабани',
        body: `<p>Вляво са <b>пистите</b> — всяка свири отделен инструмент. Започваме с барабаните, защото те задават ритъма за всичко останало.</p>
<p>Можеш да избираш писти и с клавишите <kbd>1</kbd>–<kbd>5</kbd>.</p>`,
        target: () => trackRow('', 'drums'),
        task: 'Кликни върху пистата Drums.',
        check: () => isSelected('', 'drums'),
        actions: [{ label: 'Избери вместо мен', run: () => selectTrack('', 'drums') }],
      },
      {
        title: 'Направи ритъм',
        body: `<p>Всеки ред е отделен барабан, а всяко квадратче е <b>1/16 от такта</b>. Четири квадратчета правят един удар, а шестнадесет — цял такт, който се повтаря.</p>
<p>Класическият ритъм е:</p>
<ul><li><b>Kick</b> (бас барабан) — квадратче 1 и 9</li><li><b>Snare</b> (малък барабан) — квадратче 5 и 13</li><li><b>Closed hat</b> (чинел) — през едно: 1, 3, 5, 7…</li></ul>
<p>Кликни квадратче, за да го включиш, и пак, за да го махнеш. <b>Shift+клик</b> прави удара по-силен (акцент). Пусни Play, докато кликаш — ще чуваш промените веднага.</p>
<p>💡 От <b>Load pattern…</b> можеш да заредиш и готов ритъм.</p>`,
        target: q('.seq-grid'),
        task: 'Сложи поне 2 удара на Kick и 1 на Snare.',
        check: () => hits('kick') >= 2 && hits('snare') >= 1,
        actions: [
          {
            label: 'Сложи основен ритъм вместо мен',
            run: () => {
              const d = drumTrack();
              if (!d) return;
              const row = (on: number[]) => Array.from({ length: d.steps }, (_, i) => (on.includes(i % 16) ? 1 : 0));
              d.pattern.kick = row([0, 8]);
              d.pattern.snare = row([4, 12]);
              d.pattern.chh = row([0, 2, 4, 6, 8, 10, 12, 14]);
              commit('all');
            },
          },
        ],
      },
      {
        title: 'Слой 2: Бас',
        body: `<p>Басът е ниската линия, която „лепи“ барабаните с хармонията. Сега ще се запознаеш и с <b>piano roll</b> — мястото, където се рисуват нотите.</p>`,
        target: () => trackRow('Bass'),
        task: 'Избери пистата Bass.',
        check: () => isSelected('Bass'),
        actions: [{ label: 'Избери вместо мен', run: () => selectTrack('Bass') }],
      },
      {
        title: 'Как работи piano roll',
        body: `<ul><li><b>Вертикално</b> са нотите. Вляво има клавиатура и колкото по-нагоре, толкова по-висок е тонът.</li>
<li><b>Хоризонтално</b> е времето. Числата 1–4 горе са тактовете.</li>
<li>Когато посочиш с мишката, виждаш името на нотата и позицията, например <b>A2 · bar 1.1</b>.</li>
<li><b>Клик</b> слага нота, а <b>влачене надясно</b> я удължава.</li>
<li><b>Десен клик</b> изтрива нота. За грешка има <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Z</kbd>.</li>
<li>Колелцето на мишката превърта нагоре и надолу.</li></ul>
<p>Кликни на клавиатурата вляво, за да чуеш нотите.</p>`,
        target: q('.roll-body'),
        onEnter: () => {
          if (isSelected('Bass')) roll.scrollToPitch(46);
        },
      },
      {
        title: 'Нарисувай баса',
        body: `<p>Сложи <b>по една дълга нота във всеки такт</b>:</p>
<ol><li>Такт 1 — <b>A2</b></li><li>Такт 2 — <b>F2</b></li><li>Такт 3 — <b>C3</b></li><li>Такт 4 — <b>G2</b></li></ol>
<p>Кликни в началото на такта на правилния ред и влачи надясно до края на такта. Това е прогресията <b>Am – F – C – G</b>, една от най-използваните в поп музиката.</p>
<p>💡 Сложи <b>Grid</b> на <b>1/4</b> — така нотите се подравняват по-лесно.</p>`,
        target: q('.roll-body'),
        task: 'Нарисувай 4 баса ноти.',
        check: () => notes('Bass') >= 4,
        onEnter: () => {
          if (isSelected('Bass')) roll.scrollToPitch(46);
        },
        actions: [
          { label: 'Grid 1/4', run: () => roll.setSnap('1/4') },
          {
            label: 'Покажи ми пример',
            run: () => {
              selectTrack('Bass');
              setNotes('Bass', [45, 41, 48, 43].map((pitch, bar) => ({ pitch, start: bar * 4, dur: 4, vel: 0.85 })));
              roll.scrollToPitch(46);
            },
          },
        ],
      },
      {
        title: 'Слой 3: Акорди',
        body: `<p><b>Акорд</b> са няколко ноти едновременно. Ще ги свирим с меки, разлети звуци на пистата <b>Pad</b>.</p>
<ol><li>Избери пистата <b>Pad</b>.</li><li>В лентата над piano roll смени <b>Draw</b> на <b>Triad</b>. Така един клик слага цял акорд от 3 ноти, винаги в тоналността.</li>
<li>Кликни и влачи до края на такта: <b>A3</b> в такт 1, <b>F3</b> в такт 2, <b>C4</b> в такт 3, <b>G3</b> в такт 4.</li></ol>
<p>Нотите на баса се виждат бледо (ghost notes) и ти помагат да подравниш акордите.</p>`,
        target: () => (isSelected('Pad') ? document.querySelector('.roll-body') : trackRow('Pad')),
        task: 'Нарисувай 4 акорда на Pad.',
        check: () => notes('Pad') >= 9,
        actions: [
          {
            label: 'Избери Pad + Triad',
            run: () => {
              selectTrack('Pad');
              roll.setChordMode('triad');
              roll.scrollToPitch(60);
            },
          },
          {
            label: 'Покажи ми пример',
            run: () => {
              selectTrack('Pad');
              const chords = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]];
              setNotes('Pad', chords.flatMap((c, bar) => c.map((pitch) => ({ pitch, start: bar * 4, dur: 4, vel: 0.7 }))));
              roll.scrollToPitch(60);
            },
          },
        ],
      },
      {
        title: 'Слой 4: Мелодия',
        body: `<p>Сега идва най-творческата част. Избери пистата <b>Lead</b> и върни <b>Draw</b> на <b>Single note</b> (бутонът долу го прави вместо теб).</p>
<p>Съвети за хубава мелодия:</p>
<ul><li>Пусни loop-а и пробвай ноти с клавишите <kbd>A</kbd>–<kbd>K</kbd> на компютъра (<kbd>Z</kbd>/<kbd>X</kbd> сменят октавата). Като намериш нещо хубаво, нарисувай го.</li>
<li><b>По-малко е повече</b> — 3–5 ноти на такт стигат.</li>
<li><b>Повтаряй</b> — една и съща идея два пъти се запомня.</li>
<li>Използвай ноти от акорда на същия такт — те винаги звучат добре.</li>
<li>Със <b>Scale lock</b> няма как да сложиш фалшива нота, така че експериментирай смело.</li></ul>`,
        target: () => (isSelected('Lead') ? document.querySelector('.roll-body') : trackRow('Lead')),
        task: 'Нарисувай поне 4 ноти мелодия на Lead.',
        check: () => notes('Lead') >= 4,
        actions: [
          {
            label: 'Избери Lead + Single note',
            run: () => {
              selectTrack('Lead');
              roll.setChordMode('off');
              roll.scrollToPitch(72);
            },
          },
          {
            label: 'Покажи ми пример',
            run: () => {
              selectTrack('Lead');
              roll.setChordMode('off');
              const m: [number, number, number][] = [
                [72, 0, 1], [76, 1, 1], [69, 2, 2],
                [69, 4, 1], [72, 5, 1], [77, 6, 2],
                [67, 8, 1], [72, 9, 1], [76, 10, 2],
                [74, 12, 1], [71, 13, 1], [67, 14, 2],
              ];
              setNotes('Lead', m.map(([pitch, start, dur]) => ({ pitch, start, dur, vel: 0.8 })));
              roll.scrollToPitch(72);
            },
          },
        ],
      },
      {
        title: 'Сила на нотите (velocity)',
        body: `<p>В лентата <b>VELOCITY</b> под piano roll всяка чертичка е една нота. Колкото по-висока е чертичката, толкова по-силно свири нотата.</p>
<p>Влачи нагоре и надолу върху чертичките. Малки разлики правят мелодията по-жива и „човешка“, например по-силна първа нота във всеки такт.</p>`,
        target: q('.vel-body'),
        task: 'Промени силата на няколко ноти.',
        ...changedSince(() => synths().map((t) => t.notes.map((n) => n.vel))),
      },
      {
        title: 'Избери звук (пресети)',
        body: `<p>Всяка писта има собствен звук. <b>Пресетите</b> са готови звуци, подредени по категории (Bass, Lead, Pad, Pluck, Keys, Rock, Lo-fi…).</p>
<p>Пусни loop-а и натискай стрелките <b>‹ ›</b> до името на пресета. Звукът се сменя веднага. <b>Listen</b> ти пуска кратък акорд за проба.</p>
<p>💡 Пробвай за Lead: <i>Kalimba</i>, <i>Supersaw Lead</i> или <i>Lo-fi Keys</i>.</p>`,
        target: q('.preset-bar'),
        task: 'Смени пресета поне на една писта.',
        ...changedSince(() => synths().map((t) => t.patch.name)),
      },
      {
        title: 'Оформи звука',
        body: `<p>Три копчета, които правят най-голяма разлика:</p>
<ul><li><b>Cutoff</b> (Filter) — наляво е по-тъмно и меко, надясно е по-ярко.</li>
<li><b>Attack / Release</b> (Amp envelope) — голям Attack дава плавно начало, голям Release оставя звука да „заглъхва“ по-дълго.</li>
<li><b>Reverb → Mix</b> (по-надолу при ефектите) — добавя пространство, като в зала.</li></ul>
<p>Копчетата се въртят с <b>влачене нагоре/надолу</b>. <b>Двоен клик</b> връща стойността по подразбиране.</p>`,
        target: q('.panel.filter'),
        task: 'Завърти Cutoff, докато loop-ът свири, и чуй разликата.',
        ...changedSince(() => synths().map((t) => Math.round(t.patch.filter.cutoff))),
      },
      {
        title: 'Смеси пистите (микс)',
        body: `<p>В списъка с писти всяка има:</p>
<ul><li><b>VOL</b> — сила, и <b>PAN</b> — наляво/надясно;</li><li><b>M</b> (mute) — заглушава пистата, а <b>S</b> (solo) пуска само нея.</li></ul>
<p>Добро правило: барабаните и басът са най-силни, акордите са по-тихо отзад, а мелодията е ясно отгоре. Долу при <b>Master</b> копчето <b>Glue</b> „слепва“ всичко и го прави по-плътно.</p>`,
        target: q('.tracks'),
        task: 'Пробвай Solo или промени силата (VOL) на някоя писта.',
        ...changedSince(() => store.project.tracks.map((t) => [t.solo, t.mute, t.volume.toFixed(2), t.pan.toFixed(2)])),
      },
      {
        title: 'Всеки удар — различен (Step lane)',
        body: `<p>Професионалните грувбокси (Elektron, Fors Opal) позволяват <b>всяка стъпка да звучи различно</b>. Това прави ритъма жив, без да добавяш нови писти.</p>
<p>Избери <b>Drums</b> и погледни лентата <b>STEP LANE</b> под мрежата:</p>
<ol><li>Избери барабан (например <b>Closed hat</b>) — или просто кликни името му.</li>
<li>Избери параметър и <b>влачи стълбчетата</b> нагоре/надолу. Десен клик връща стойността.</li></ol>
<ul><li><b>Tune / Pan</b> — всеки хет с различен тон и позиция;</li>
<li><b>Ratchet</b> — 2–4 бързи удара в една стъпка (ролки);</li>
<li><b>Nudge</b> — удар малко по-рано или по-късно;</li>
<li><b>Chance</b> и <b>Condition</b> — ударът свири само понякога (например <b>2:4</b> = на 2-рия от всеки 4 пъти).</li></ul>
<p>Синя точка в клетката = заключена стойност, малко квадратче = условие.</p>`,
        target: () => (isSelected('', 'drums') ? document.querySelector('.seq-lane-row') : trackRow('', 'drums')),
        task: 'Промени поне една стъпка в Step lane.',
        ...changedSince(() => drumTrack()?.locks ?? {}),
        actions: [
          { label: 'Избери Drums', run: () => selectTrack('', 'drums') },
          {
            label: 'Покажи ми пример',
            run: () => {
              selectTrack('', 'drums');
              const d = drumTrack();
              if (!d) return;
              const tunes = [0, 3, -2, 5, 0, 7, -3, 2];
              const chh: Record<number, StepParams> = {};
              d.pattern.chh.forEach((on, i) => {
                if (on) chh[i] = { tune: tunes[i % 8], pan: i % 4 < 2 ? -0.4 : 0.4 };
              });
              // A roll on the last hat, only on every 4th pass
              let last = -1;
              d.pattern.chh.forEach((on, i) => on && (last = i));
              if (last >= 0) chh[last] = { ...chh[last], ratchet: 3, cond: [4, 4] };
              d.locks = { ...(d.locks ?? {}), chh };
              commit('all');
            },
          },
        ],
      },
      {
        title: 'Звук и условие за всяка нота',
        body: `<p>Същото работи и за нотите. В лентата под piano roll-а избери от <b>Lane</b> (над нотите):</p>
<ul><li><b>Cutoff / Resonance</b> — една нота по-ярка, друга по-тъмна (класически „acid“ бас);</li>
<li><b>Pan</b> — нотата отляво или отдясно;</li>
<li><b>Chance</b> — вероятност нотата да прозвучи;</li>
<li><b>Condition</b> — клик върху нотата избира кога свири, например <b>2:2</b> = само на всеки втори път.</li></ul>
<p>Нотите с условие са с <b>пунктирана рамка</b>. Когато loop-ът се променя от повторение на повторение, горе до BPM се появява <b>Pass 1/4</b>, <b>2/4</b>… — броячът на повторенията.</p>`,
        target: () => (store.track.kind === 'synth' ? document.querySelector('[aria-label="Note lane"]') : trackRow('Lead')),
        task: 'Сложи заключване или условие на поне една нота.',
        ...changedSince(() => synths().map((t) => t.notes.map((x) => [x.cutoff, x.res, x.pan, x.chance, x.cond]))),
        actions: [
          {
            label: 'Избери Lead + Condition',
            run: () => {
              selectTrack('Lead');
              roll.setLane('cond');
            },
          },
          {
            label: 'Покажи ми пример',
            run: () => {
              selectTrack('Lead');
              const t = synthTrack('Lead');
              if (!t || !t.notes.length) return;
              const L = store.project.bars * 4;
              // The second half of the melody now only plays every other pass
              for (const n of t.notes) if (n.start >= L / 2) n.cond = [2, 2];
              t.notes.forEach((n, i) => {
                if (i % 3 === 1) n.cutoff = -1.5;
              });
              roll.setLane('cond');
              commit('all');
            },
          },
        ],
      },
      {
        title: 'Запази проекта',
        body: `<p>Проектът се пази <b>автоматично</b> в този браузър. За да имаш файл (резервно копие или за друг компютър), натисни иконата <b>дискета</b> или <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd>. Иконата <b>папка</b> отваря записан проект.</p>`,
        target: q('.tb-file'),
      },
      {
        title: 'Изнеси WAV за видеото',
        body: `<p>Натисни <b>Export WAV</b> и избери:</p>
<ul><li><b>48 kHz</b> и <b>24-bit</b> — стандарт за видео;</li><li><b>Seamless loop: On</b> — файлът се повтаря без щракане;</li><li><b>Repeats ×1</b> — в монтажната програма просто го копираш или зациклиш.</li></ul>
<p>Ако си сложил условия (Chance или Condition), loop-ът се променя през няколко повторения. Тогава файлът автоматично съдържа <b>целия цикъл</b> (например 4 повторения), за да остане безшевен.</p>
<p>Натисни <b>Render &amp; download</b>. В програмата за монтаж сложи WAV-а на аудио писта и го повтори колкото пъти ти трябва.</p>`,
        target: q('.topbar .btn.primary'),
        task: 'Отвори прозореца Export WAV.',
        check: () => this.exportOpened,
      },
      {
        title: 'Готово! 🎉',
        body: `<p>Току-що направи първия си loop от нулата: ритъм, бас, акорди, мелодия, звук, микс и експорт.</p>
<p>Идеи за следващия:</p>
<ul><li>Смени <b>Scale</b> на <b>Major</b> за весело настроение или <b>Dorian</b> за лек джаз.</li>
<li>Завърти <b>Swing</b> горе — ритъмът започва да „люлее“ (страхотно за lo-fi и хип-хоп).</li>
<li>Пробвай другите ритми от <b>Load pattern…</b> и пресетите в категория <b>Rock</b>.</li>
<li>От менюто <b>New… → Samples</b> отвори <b>Step Lock Groove</b> — там всеки хет е различен, а някои удари свирят само понякога.</li>
<li>От менюто <b>New… → Demo loop</b> можеш да разгледаш готов пример.</li></ul>
<p>Туториалът винаги е под бутона <b>?</b> горе.</p>`,
      },
    ];
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(LS_SEEN, '1');
  } catch {
    /* ignore */
  }
}

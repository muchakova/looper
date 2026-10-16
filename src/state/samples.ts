// Ready-made sample projects. Every *.loopforge.json in examples/ is bundled
// into the app and listed under "Samples" in the New… menu, so adding a new
// sample is just a matter of saving its project file into that folder.

import { normalizeProject } from './project';
import type { Project } from './types';

const files = import.meta.glob('../../examples/*.loopforge.json', { eager: true, import: 'default' });

export interface Sample {
  id: string;
  label: string;
  load: () => Project;
}

export const SAMPLES: Sample[] = Object.entries(files)
  .map(([path, data]) => {
    const raw = data as Project;
    const id = path.split('/').pop()!.replace('.loopforge.json', '');
    return {
      id,
      label: `${raw.name} · ${raw.bpm} BPM · ${raw.bars} bars`,
      load: () => normalizeProject(structuredClone(raw)),
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

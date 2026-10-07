/**
 * Chord vocabulary: the set of chord templates the analyzer considers.
 * v0.1 implements triads only (major, minor, diminished, augmented) as agreed —
 * but the structure is modular: adding 7ths/6ths/slash chords later means adding
 * templates here plus a root-detection heuristic in the analyzer. No UI changes.
 */

import type { ChordQualityId } from '../types.ts';

export interface ChordTemplate {
  quality: ChordQualityId;
  /** Intervals above the root, in semitones. */
  intervals: number[];
  symbolSuffix: string;
}

export const TRIAD_TEMPLATES: ChordTemplate[] = [
  { quality: 'major',      intervals: [0, 4, 7],    symbolSuffix: '' },
  { quality: 'minor',      intervals: [0, 3, 7],    symbolSuffix: 'm' },
  { quality: 'diminished', intervals: [0, 3, 6],    symbolSuffix: 'dim' },
  { quality: 'augmented',  intervals: [0, 4, 8],    symbolSuffix: '+' },
];

/** All pitch classes of a chord given its root pc and template. */
export function chordPcs(rootPc: number, template: ChordTemplate): number[] {
  return template.intervals.map((i) => (rootPc + i) % 12);
}

/**
 * Enumerate every candidate chord (12 roots × each template).
 * Note: augmented triads repeat every 4 semitones and diminished every 3 —
 * duplicates are harmless for scoring and keep this dead-simple.
 */
export function enumerateCandidates(templates: ChordTemplate[] = TRIAD_TEMPLATES) {
  const out: { rootPc: number; template: ChordTemplate; pcs: Set<number> }[] = [];
  for (const template of templates) {
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      out.push({ rootPc, template, pcs: new Set(chordPcs(rootPc, template)) });
    }
  }
  return out;
}

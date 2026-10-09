/**
 * Scales & modes. v0.1 ships a practical set: the 7 diatonic modes plus a few
 * common jazz scales. Each scale exposes its pitch-class set, which feeds the
 * key/mode prior in the analyzer (README §6/§7).
 */

import { NOTE_NAMES_FLAT, NOTE_NAMES_SHARP, pitchClass } from './pitch.ts';

export interface Scale {
  id: string;
  name: string;
  /** Short label used in compact UI text (key badge, toolbar selects). */
  short: string;
  /** Interval steps from tonic in semitones. */
  intervals: number[];
}

export const SCALES: Scale[] = [
  { id: 'ionian',         name: 'Major (Ionian)',           short: 'major',   intervals: [0,2,4,5,7,9,11] },
  { id: 'aeolian',        name: 'Natural Minor (Aeolian)',  short: 'minor',   intervals: [0,2,3,5,7,8,10] },
  { id: 'dorian',         name: 'Dorian',                   short: 'dorian',  intervals: [0,2,3,5,7,9,10] },
  { id: 'phrygian',       name: 'Phrygian',                 short: 'phryg',   intervals: [0,1,3,5,7,8,10] },
  { id: 'lydian',         name: 'Lydian',                   short: 'lydian',  intervals: [0,2,4,6,7,9,11] },
  { id: 'mixolydian',     name: 'Mixolydian',               short: 'mixolyd', intervals: [0,2,4,5,7,9,10] },
  { id: 'locrian',        name: 'Locrian',                  short: 'locrian', intervals: [0,1,3,5,6,8,10] },
  { id: 'harmonic-minor', name: 'Harmonic Minor',           short: 'harm. minor', intervals: [0,2,3,5,7,8,11] },
  { id: 'melodic-minor',  name: 'Melodic Minor',            short: 'mel. minor',  intervals: [0,2,3,5,7,9,11] },
];

export function getScale(id: string): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0];
}

/**
 * Compact human label for a key/scale selection, e.g. `Ab dorian`. Used by the
 * analysis toolbar select and the topbar badge so it is always obvious which
 * root/scale the chord analysis is weighted toward.
 */
export function keyLabel(tonic: number, scaleId: string, prefer: 'sharp' | 'flat' = 'flat'): string {
  const table = prefer === 'sharp' ? NOTE_NAMES_SHARP : NOTE_NAMES_FLAT;
  return `${table[pitchClass(tonic)]} ${getScale(scaleId).short}`;
}

/** Pitch classes (0..11) contained in `tonic` + `scale`. */
export function scalePitchClasses(tonic: number, scale: Scale): Set<number> {
  return new Set(scale.intervals.map((i) => (tonic + i) % 12));
}

/**
 * Diatonic LETTER indices (C=0..B=6) consumed by this scale, computed the
 * traditional way: walk the seven letter positions starting at the tonic's
 * letter and take each scale degree's interval. Works for 7-note scales; for
 * shorter/longer sets it degrades to "letters implied by the degrees we have".
 * Used by pitch.spellPc() for key-aware enharmonic spelling (F major → Bb not A#).
 */
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B

export function scaleLetterIndices(tonic: number, scale: Scale): Set<number> {
  const out = new Set<number>();
  // Find the letter index of the tonic (prefer exact pc match on natural letters).
  let tonicLetter = -1;
  for (let i = 0; i < 7; i++) if (LETTER_PC[i] === ((tonic % 12) + 12) % 12) tonicLetter = i;
  if (tonicLetter < 0) {
    // Tonic is a black-key pc: pick the letter whose sharp/flat spelling matches
    // the common convention (flats): Db→D(1), Eb→E(2), Gb→G(4), Ab→A(5), Bb→B(6), C#→C(0).
    const map: Record<number, number> = { 1: 0, 3: 2, 6: 3, 8: 5, 10: 6 };
    tonicLetter = map[((tonic % 12) + 12) % 12] ?? 0;
  }
  // Degree k of the scale sits on letter (tonicLetter + k) mod 7.
  scale.intervals.forEach((_iv, k) => out.add((tonicLetter + k) % 7));
  return out;
}

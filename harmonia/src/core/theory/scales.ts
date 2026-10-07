/**
 * Scales & modes. v0.1 ships a practical set: the 7 diatonic modes plus a few
 * common jazz scales. Each scale exposes its pitch-class set, which feeds the
 * key/mode prior in the analyzer (README §6/§7).
 */

export interface Scale {
  id: string;
  name: string;
  /** Interval steps from tonic in semitones. */
  intervals: number[];
}

export const SCALES: Scale[] = [
  { id: 'ionian',      name: 'Major (Ionian)',        intervals: [0,2,4,5,7,9,11] },
  { id: 'aeolian',     name: 'Natural Minor (Aeolian)', intervals: [0,2,3,5,7,8,10] },
  { id: 'dorian',      name: 'Dorian',                intervals: [0,2,3,5,7,9,10] },
  { id: 'phrygian',    name: 'Phrygian',              intervals: [0,1,3,5,7,8,10] },
  { id: 'lydian',      name: 'Lydian',                intervals: [0,2,4,6,7,9,11] },
  { id: 'mixolydian',  name: 'Mixolydian',            intervals: [0,2,4,5,7,9,10] },
  { id: 'locrian',     name: 'Locrian',               intervals: [0,1,3,5,6,8,10] },
  { id: 'harmonic-minor', name: 'Harmonic Minor',     intervals: [0,2,3,5,7,8,11] },
  { id: 'melodic-minor',  name: 'Melodic Minor',      intervals: [0,2,3,5,7,9,11] },
];

export function getScale(id: string): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0];
}

/** Pitch classes (0..11) contained in `tonic` + `scale`. */
export function scalePitchClasses(tonic: number, scale: Scale): Set<number> {
  return new Set(scale.intervals.map((i) => (tonic + i) % 12));
}

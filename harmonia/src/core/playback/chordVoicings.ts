/**
 * Chord symbol parser + default voicings — used by the progression editor and
 * history playback (README §9). Intentionally simple: parse a leading root
 * (with accidental), an optional quality suffix, and an optional slash bass.
 * Unknown symbols degrade gracefully so nothing ever crashes.
 */

import type { ChordCandidate } from '../types.ts';
import { pitchClass } from '../theory/pitch.ts';

const PC_BY_LETTER: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

export interface ParsedChord {
  raw: string;
  rootPc: number | null;
  bassPc: number | null;      // explicit slash bass, if given
  intervals: number[];        // semitones above root (pitch classes)
  qualityLabel: string;       // normalized description, e.g. 'minor'
}

/** Quality suffixes we understand in typed input (superset of analyzer vocabulary). */
const QUALITY_TABLE: { suffix: string; intervals: number[]; label: string }[] = [
  { suffix: 'maj7',   intervals: [0, 4, 7, 11], label: 'major seventh' },
  { suffix: 'ma7',    intervals: [0, 4, 7, 11], label: 'major seventh' },
  { suffix: 'm7b5',   intervals: [0, 3, 6, 10], label: 'half-diminished' },
  { suffix: 'dim7',   intervals: [0, 3, 6, 9],  label: 'diminished seventh' },
  { suffix: 'aug7',   intervals: [0, 4, 8, 10], label: 'augmented seventh' },
  { suffix: '7b5',    intervals: [0, 4, 6, 10], label: 'dom7♭5' },
  { suffix: '7#5',    intervals: [0, 4, 8, 10], label: 'dom7♯5' },
  { suffix: '7sus4',  intervals: [0, 5, 7, 10], label: 'suspended seventh' },
  { suffix: 'add9',   intervals: [0, 2, 4, 7],  label: 'added ninth' },
  { suffix: 'min7',   intervals: [0, 3, 7, 10], label: 'minor seventh' },
  { suffix: 'm7',     intervals: [0, 3, 7, 10], label: 'minor seventh' },
  { suffix: 'sus4',   intervals: [0, 5, 7],     label: 'suspended fourth' },
  { suffix: 'sus2',   intervals: [0, 2, 7],     label: 'suspended second' },
  { suffix: 'min6',   intervals: [0, 3, 7, 9],  label: 'minor sixth' },
  { suffix: 'm6',     intervals: [0, 3, 7, 9],  label: 'minor sixth' },
  { suffix: 'dim',    intervals: [0, 3, 6],     label: 'diminished' },
  { suffix: 'aug',    intervals: [0, 4, 8],     label: 'augmented' },
  { suffix: 'min',    intervals: [0, 3, 7],     label: 'minor' },
  { suffix: 'maj',    intervals: [0, 4, 7],     label: 'major' },
  { suffix: '7',      intervals: [0, 4, 7, 10], label: 'dominant seventh' },
  { suffix: '6',      intervals: [0, 4, 7, 9],  label: 'major sixth' },
  { suffix: '+',      intervals: [0, 4, 8],     label: 'augmented' },
  { suffix: 'o',      intervals: [0, 3, 6],     label: 'diminished' },
  { suffix: 'm',      intervals: [0, 3, 7],     label: 'minor' },
  { suffix: '',       intervals: [0, 4, 7],     label: 'major' },
];

// Longest suffix first so "m7b5" beats "m7", "7sus4" beats "7", etc.
QUALITY_TABLE.sort((a, b) => b.suffix.length - a.suffix.length);

/** Parse "Ab+", "Cm6", "E+/Ab", "F#m7b5", "G7sus4" … Returns null root for garbage. */
export function parseChordSymbol(symbol: string): ParsedChord {
  const trimmed = symbol.trim().toLowerCase();
  let rest = trimmed;

  // Slash bass?
  let bassPc: number | null = null;
  const slash = rest.match(/^(.*?)\/([a-g][#b]?)$/);
  if (slash) {
    rest = slash[1];
    bassPc = letterToPc(slash[2]);
  }

  // Root letter + optional accidentals.
  let rootPc: number | null = null;
  const rootMatch = rest.match(/^([a-g])([#b♯♭]*)/);
  if (rootMatch) {
    rootPc = letterToPc(rootMatch[1] + normalizeAccidental(rootMatch[2]));
    rest = rest.slice(rootMatch[0].length);
  }

  // Longest matching quality suffix wins.
  let intervals = [0, 4, 7];
  let label = 'major';
  for (const q of QUALITY_TABLE) {
    if (rest === q.suffix || rest.startsWith(q.suffix)) {
      intervals = q.intervals;
      label = q.label;
      break;
    }
  }

  return { raw: symbol, rootPc, bassPc, intervals: [...intervals].sort((a, b) => a - b), qualityLabel: label };
}

function normalizeAccidental(a: string): string {
  return a.replace(/♯/g, '#').replace(/♭/g, 'b');
}

function letterToPc(letterWithAcc: string): number | null {
  const base = PC_BY_LETTER[letterWithAcc[0]];
  if (base === undefined) return null;
  let pc = base;
  for (const ch of letterWithAcc.slice(1)) {
    if (ch === '#') pc += 1;
    else if (ch === 'b') pc -= 1;
  }
  return ((pc % 12) + 12) % 12;
}

/** MIDI number of C in scientific octave `oct` (C4 = 60). */
export function midiC(oct: number): number {
  return 12 * (oct + 1);
}

/**
 * Build a playable MIDI voicing (low → high) for a parsed chord around `octaveBase`.
 * Close-position stack with the root near the base octave; explicit slash bass
 * is placed an octave lower when possible.
 */
export function voicingFor(parsed: ParsedChord, octaveBase = 4): number[] {
  if (parsed.rootPc === null) return [];
  const lo = midiC(octaveBase);
  const notes = new Set<number>();
  for (const iv of parsed.intervals) {
    let n = lo + parsed.rootPc + iv;
    while (n < lo) n += 12;
    while (n > lo + 24) n -= 12;
    notes.add(n);
  }

  if (parsed.bassPc !== null) {
    let bass = lo + parsed.bassPc;
    if (bass >= lo + 12) bass -= 12;
    notes.delete(bass); // avoid doubling the bass inside the stack
    return [bass, ...[...notes].filter((n) => n > bass)].sort((a, b) => a - b);
  }
  return [...notes].sort((a, b) => a - b);
}

/** Convenience: a simple voicing for a live ChordCandidate (uses its pcs). */
export function voicingForCandidate(cand: ChordCandidate, octaveBase = 4): number[] {
  const lo = midiC(octaveBase);
  const sorted = [...new Set(cand.pcs.map(pitchClass))].sort((a, b) => a - b);
  const out = [lo + cand.rootPc, ...sorted.filter((pc) => pc !== cand.rootPc).map((pc) => lo + pc)];
  return [...new Set(out)].sort((a, b) => a - b);
}

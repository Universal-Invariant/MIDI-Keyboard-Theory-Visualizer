/**
 * Basic music-theory helpers: pitch names, enharmonic spelling, MIDI number utils.
 * v0.1 keeps spelling simple (sharps for "black" keys by default); the proper
 * key-aware spelling engine lives here and will grow with the analyzer (README §6).
 */

export const NOTE_NAMES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] as const;
export const NOTE_NAMES_FLAT   = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'] as const;

/** Chord-symbol suffixes per quality (used in symbols, not staff spelling). */
export const QUALITY_SUFFIX: Record<string, string> = {
  major: '',
  minor: 'm',
  diminished: 'dim',
  augmented: '+',
  dom7: '7',
  maj7: 'maj7',
  min7: 'm7',
  dim7: 'dim7',
  m7b5: 'm7♭5',
  min6: 'm6',
  sus2: 'sus2',
  sus4: 'sus4',
  six: '6',
};

/**
 * Key-aware spelling of a pitch class. `letterIdxInScale` is the set of
 * diatonic LETTER indices (C=0, D=1, E=2, F=3, G=4, A=5, B=6) used by the
 * current key/scale — each scale degree occupies exactly one letter. A black-key
 * pc is spelled with its sharp-side name only when that side's letter is in the
 * set, and with its flat-side name only when the flat side's letter is; naturals
 * are identical either way. Both/neither falls back to `prefer`.
 * e.g. F major uses letters {C,D,E,F,G,A,B} via Bb → pc 10 spells "Bb", never "A#".
 */
export function spellPc(
  pc: number,
  letterIdxInScale?: Set<number> | null,
  prefer: 'sharp' | 'flat' = 'flat',
): string {
  pc = pitchClass(pc);
  if (letterIdxInScale && letterIdxInScale.size >= 5) {
    const sLetter = SHARP_LETTER_IDX[pc]; // -1 for natural pcs
    const fLetter = FLAT_LETTER_IDX[pc];
    if (sLetter < 0) return NOTE_NAMES_SHARP[pc]; // natural — same either way
    const sharpIn = letterIdxInScale.has(sLetter);
    const flatIn = letterIdxInScale.has(fLetter);
    if (sharpIn && !flatIn) return NOTE_NAMES_SHARP[pc];
    if (flatIn && !sharpIn) return NOTE_NAMES_FLAT[pc];
  }
  return prefer === 'flat' ? NOTE_NAMES_FLAT[pc] : NOTE_NAMES_SHARP[pc];
}

// Which diatonic letter (index) each enharmonic spelling belongs to.
// Letters: C=0 D=1 E=2 F=3 G=4 A=5 B=6
// pc 1: C# (letter C=0) vs Db (letter D=1);  pc 3: D#(1) vs Eb(2);
// pc 6: F#(3) vs Gb(4);                      pc 8: G#(4) vs Ab(5);
// pc 10: A#(5) vs Bb(6).
const SHARP_LETTER_IDX = [-1, 0, -1, 1, -1, -1, 3, -1, 4, -1, 5, -1];
const FLAT_LETTER_IDX  = [-1, 1, -1, 2, -1, -1, 4, -1, 5, -1, 6, -1];

export function pitchClass(pitch: number): number {
  return ((pitch % 12) + 12) % 12;
}

/** Scientific octave under C-based numbering: MIDI 60 → octave 4 ("C4"). */
export function octaveNumber(pitch: number): number {
  return Math.floor(pitch / 12) - 1;
}

export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitchClass(pitch));
}

/**
 * Name a pitch class. `prefer` lets callers bias spelling toward flats
 * (e.g. Ab-major context) or sharps. Later this becomes key-aware via
 * KeyModel.spellingForPc().
 */
export function pcName(pc: number, prefer: 'sharp' | 'flat' = 'flat'): string {
  const table = prefer === 'flat' ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return table[pitchClass(pc)];
}

export function noteName(pitch: number, prefer: 'sharp' | 'flat' = 'flat'): string {
  return pcName(pitchClass(pitch), prefer) + octaveNumber(pitch);
}

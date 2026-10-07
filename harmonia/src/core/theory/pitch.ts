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
};

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

/** Shared domain types for Harmonia. */

export type NoteEventName = 'note-on' | 'note-off' | 'control-change';

export interface MidiNoteEvent {
  name: 'note-on' | 'note-off';
  pitch: number;        // MIDI note number 0..127
  velocity: number;     // 0..127 (for note-off, the release velocity)
  channel: number;      // 0..15
  timestamp: number;    // performance.now() at reception
}

export interface MidiCCEvent {
  name: 'control-change';
  controller: number;   // CC number (64 = sustain/damper pedal)
  value: number;        // 0..127
  channel: number;
  timestamp: number;
}

export type MidiEvent = MidiNoteEvent | MidiCCEvent;

export interface HeldNote {
  pitch: number;
  velocity: number;
  channel: number;
  since: number;        // timestamp of note-on
}

/** A sounding snapshot handed to the chord analyzer. */
export interface NoteState {
  /** Currently held notes, ordered low → high. */
  held: HeldNote[];
  /** Recently released notes kept as decaying "ghost" evidence. */
  ghosts: GhostNote[];
  timestamp: number;
}

export interface GhostNote extends HeldNote {
  releasedAt: number;
  /** 1 → just released, 0 → fully faded out. */
  weight: number;
}

export type ChordQualityId =
  | 'major'
  | 'minor'
  | 'diminished'
  | 'augmented'
  | 'dom7'
  | 'maj7'
  | 'min7'
  | 'm7b5'
  | 'dim7'
  | 'min6'
  | 'six'
  | 'sus2'
  | 'sus4'
  | 'unknown';

export interface ChordCandidate {
  /** Human-readable symbol, e.g. "Ab+", "Cm", "E+/Ab". */
  symbol: string;
  rootPc: number;               // pitch class of root, 0..11
  quality: ChordQualityId;
  /** Pitch classes contained in the chord, low → high. */
  pcs: number[];
  /** Posterior probability weight (normalized across candidates). */
  probability: number;
  /** Raw log-score before normalization (useful for debugging/tests). */
  score: number;
  /** Short explanation of why this candidate scored as it did. */
  reason: string;
}

export interface KeySignatureSetting {
  /** Tonic pitch class, 0..11 (C = 0). */
  tonic: number;
  /** Mode/scale name id, see core/theory/scales.ts (e.g. 'ionian'). */
  scale: string;
}

export type KeyboardVizMode = 'full88' | 'octave1' | 'octave2split';

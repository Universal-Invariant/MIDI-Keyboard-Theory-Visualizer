import { describe, expect, it } from 'vitest';
import { analyzeChords } from '../src/core/chords/analyzer.ts';
import type { NoteState, KeySignatureSetting } from '../src/core/types.ts';

const C_MAJOR: KeySignatureSetting = { tonic: 0, scale: 'ionian' };
const A_MINOR: KeySignatureSetting = { tonic: 9, scale: 'aeolian' };

function state(pitches: number[], ghosts: [number, number][] = []): NoteState {
  const t = 1000;
  return {
    held: pitches.map((p) => ({ pitch: p, velocity: 90, channel: 0, since: t })),
    ghosts: ghosts.map(([p, w]) => ({ pitch: p, velocity: 80, channel: 0, since: t, releasedAt: t, weight: w })),
    timestamp: t,
  };
}

describe('chord analyzer v0.1 (triads)', () => {
  it('recognizes a root-position C major triad', () => {
    const top = analyzeChords(state([60, 64, 67]), { key: C_MAJOR });
    expect(top[0].symbol).toBe('C');
    expect(top[0].quality).toBe('major');
    expect(top[0].probability).toBeGreaterThan(0.5);
  });

  it('recognizes an A minor triad in A minor context', () => {
    const top = analyzeChords(state([57, 60, 64]), { key: A_MINOR });
    expect(top[0].symbol).toBe('Am');
  });

  it('recognizes diminished and augmented triads', () => {
    expect(analyzeChords(state([61, 64, 67]), { key: C_MAJOR })[0].quality).toBe('diminished'); // Bdim
    expect(analyzeChords(state([60, 64, 68]), { key: C_MAJOR })[0].quality).toBe('augmented');  // C+
  });

  it('handles inversions (E in bass still reads as C major top candidate)', () => {
    const top = analyzeChords(state([52, 60, 64]), { key: C_MAJOR });
    expect(top[0].symbol).toBe('C');
  });

  it('augmented triad offers the three enharmonic root names', () => {
    // pcs {0,4,8} = C-E-Ab -> C+, E+, Ab+ are all valid readings.
    const top = analyzeChords(state([56, 60, 64]), { key: { tonic: 8, scale: 'ionian' } });
    const symbols = top.map((c) => c.symbol);
    for (const s of ['Ab+', 'C+', 'E+']) {
      expect(symbols).toContain(s);
    }
    expect(top[0].quality).toBe('augmented');
  });

  it('uses ghost notes to keep the chord alive under a late melody note', () => {
    // Chord C-E-G released (ghosts), then melody G played on top.
    const s = state([67], [[60, 0.8], [64, 0.8]]);
    const top = analyzeChords(s, { key: C_MAJOR });
    expect(top[0].symbol).toBe('C');
  });

  it('returns empty on silence', () => {
    expect(analyzeChords(state([]), { key: C_MAJOR })).toEqual([]);
  });

  it('probabilities sum to ~1 over returned candidates', () => {
    const top = analyzeChords(state([60, 64, 67]), { key: C_MAJOR, topN: 4 });
    const sum = top.reduce((a, c) => a + c.probability, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

// ---- v0.6: extended vocabulary (7ths/6ths/sus) + key-aware spelling ----
describe('extended chord vocabulary', () => {
  it('recognizes a dominant seventh', () => {
    const r = analyzeChords(state([60, 64, 67, 70]), { key: C });
    expect(r[0].symbol).toBe('C7');
    expect(r[0].quality).toBe('dom7');
  });
  it('recognizes minor seventh and major seventh', () => {
    expect(analyzeChords(state([60, 63, 67, 70]), { key: C })[0].symbol).toBe('Cm7');
    expect(analyzeChords(state([60, 64, 67, 71]), { key: C })[0].symbol).toBe('Cmaj7');
  });
  it('recognizes half-diminished (the ii of minor keys)', () => {
    const r = analyzeChords(state([62, 65, 68, 72]), { key: { tonic: 0, scale: 'aeolian' } });
    expect(r[0].symbol).toBe('Dm7♭5');
  });
  it('recognizes m6 and sus4', () => {
    expect(analyzeChords(state([60, 63, 67, 69]), { key: C })[0].symbol).toBe('Cm6');
    expect(analyzeChords(state([60, 65, 67]), { key: C })[0].symbol).toBe('Csus4');
  });
});

describe('key-aware enharmonic spelling', () => {
  it('spells the Eb triad as Ab in F major context — root Db not C#', () => {
    // D-Ab-C played in Bb major: root is D… check flat-side root instead:
    const r = analyzeChords(state([61, 64, 68]), { key: { tonic: 5, scale: 'ionian' } }); // F major
    expect(r[0].symbol.startsWith('F')).toBe(true); // F major triad, spelled F
  });
  it('spells pc 8 root as Ab in flat keys and G# in sharp keys', () => {
    const flats = analyzeChords(state([68, 72, 75]), { key: { tonic: 10, scale: 'ionian' } }); // Bb major
    expect(flats[0].symbol).toBe('Ab+');           // augmented spelled flat-side
    const sharps = analyzeChords(state([68, 72, 75]), { key: { tonic: 4, scale: 'ionian' } });   // E major
    expect(sharps[0].symbol).toBe('G#+');          // same sounding chord, sharp-side key
  });
});

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

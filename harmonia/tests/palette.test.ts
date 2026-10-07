import { describe, expect, it } from 'vitest';
import {
  FUNCTION_COLORS,
  PC_COLORS,
  functionLabel,
  paletteColorFor,
  parseSymbolRoot,
  type PaletteContext,
} from '../src/core/palette.ts';
import type { KeySignatureSetting } from '../src/core/types.ts';

const C_MAJOR: KeySignatureSetting = { tonic: 0, scale: 'ionian' };
const F_MAJOR: KeySignatureSetting = { tonic: 5, scale: 'ionian' };

function ctx(partial: Partial<PaletteContext>): PaletteContext {
  return {
    mode: 'mono',
    key: C_MAJOR,
    currentSymbol: null,
    currentChordPcs: [],
    ...partial,
  };
}

describe('parseSymbolRoot', () => {
  it('handles flats and augmented suffix', () => {
    const p = parseSymbolRoot('Ab+');
    expect(p?.rootPc).toBe(8);
    expect(p?.suffix).toBe('aug'); // normalized from '+'
  });

  it('handles sharps and dim suffix', () => {
    const p = parseSymbolRoot('F#dim');
    expect(p?.rootPc).toBe(6);
    expect(p?.suffix.toLowerCase()).toContain('dim');
  });

  it('handles unicode sharps/flats', () => {
    expect(parseSymbolRoot('E♯m')?.rootPc).toBe(5);
    expect(parseSymbolRoot('B♭')?.rootPc).toBe(10);
    // 'b' as the note name B must not be eaten as a flat: Bm = pc 11.
    expect(parseSymbolRoot('Bm')?.rootPc).toBe(11);
    expect(parseSymbolRoot('Bbm')?.rootPc).toBe(10);
  });

  it('returns null for garbage', () => {
    expect(parseSymbolRoot('???')).toBeNull();
  });
});

describe('functionLabel', () => {
  it('labels diatonic triads in C major', () => {
    expect(functionLabel(0, [0, 4, 7], C_MAJOR)).toBe('I');
    expect(functionLabel(2, [2, 5, 9], C_MAJOR)).toBe('II');
    expect(functionLabel(7, [7, 11, 2], C_MAJOR)).toBe('V');
    expect(functionLabel(9, [9, 0, 4], C_MAJOR)).toBe('VI'); // Am — relative minor
  });

  it('labels IV correctly in F major (Bb chord)', () => {
    expect(functionLabel(10, [10, 2, 5], F_MAJOR)).toBe('IV');
  });

  it('marks chromatic roots NONDIATONIC', () => {
    // Root on F# is not a degree of the C major scale.
    expect(functionLabel(6, [6, 10, 1], C_MAJOR)).toBe('NONDIATONIC');
    // Root on Eb is not a degree of the F major scale (Bb IS — see IV test above).
    expect(functionLabel(3, [3, 7, 10], F_MAJOR)).toBe('NONDIATONIC');
  });

  it('works off the tonic pitch class, not just C', () => {
    // In F major, C is the V.
    expect(functionLabel(0, [0, 4, 7], F_MAJOR)).toBe('V');
  });
});

describe('paletteColorFor', () => {
  it('mono returns a single color regardless of pitch', () => {
    const c = ctx({ mode: 'mono' });
    expect(paletteColorFor(60, c)).toBe(paletteColorFor(72, c));
    expect(paletteColorFor(60, c)).not.toBeNull();
  });

  it('pc mode maps each pitch class to its own default color', () => {
    const c = ctx({ mode: 'pc' });
    expect(paletteColorFor(60, c)).toBe(PC_COLORS[0]); // C
    expect(paletteColorFor(63, c)).toBe(PC_COLORS[3]); // Eb
    expect(paletteColorFor(72, c)).toBe(PC_COLORS[0]); // octave-wrapped C
  });

  it('pc mode honors user overrides', () => {
    const colors: (string | null)[] = Array(12).fill(null);
    colors[0] = '#123456';
    const c = ctx({ mode: 'pc', pcColors: colors });
    expect(paletteColorFor(60, c)).toBe('#123456');
    expect(paletteColorFor(62, c)).toBe(PC_COLORS[2]); // untouched
  });

  it('chord mode colors by the current chord root, quality-shaded', () => {
    const major = ctx({ mode: 'chord', currentSymbol: 'C', currentChordPcs: [0, 4, 7] });
    const minor = ctx({ mode: 'chord', currentSymbol: 'Cm', currentChordPcs: [0, 3, 7] });
    const cmaj = paletteColorFor(60, major);
    const cmin = paletteColorFor(60, minor);
    expect(cmaj).toBe(PC_COLORS[0]);
    expect(cmin).not.toBe(cmaj); // darker variant for minor
    // No chord sounding → fall back to default styling.
    expect(paletteColorFor(60, ctx({ mode: 'chord' }))).toBeNull();
  });

  it('function mode uses function colors and user overrides', () => {
    const c = ctx({ mode: 'function', currentSymbol: 'G', currentChordPcs: [7, 11, 2], key: C_MAJOR });
    expect(paletteColorFor(60, c)).toBe(FUNCTION_COLORS.V);

    const custom = ctx({
      mode: 'function',
      currentSymbol: 'G',
      currentChordPcs: [7, 11, 2],
      key: C_MAJOR,
      functionColors: { V: '#abcdef' },
    });
    expect(paletteColorFor(60, custom)).toBe('#abcdef');
  });

  it('function mode flags out-of-key roots red', () => {
    // The analyzer spells chromatic roots with sharps (pc 6 → "F#").
    const c = ctx({ mode: 'function', currentSymbol: 'F#', currentChordPcs: [6, 10, 1], key: C_MAJOR });
    expect(paletteColorFor(60, c)).toBe(FUNCTION_COLORS.NONDIATONIC);
  });
});

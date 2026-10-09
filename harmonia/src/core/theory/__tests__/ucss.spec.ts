/**
 * UCSS chord-notation tests — parser round-trips, ambiguity rules, glyph HTML.
 */

import { describe, expect, it } from 'vitest';
import {
  parseUcss, intervalsOf, toLinear, toTraditional, toHtmlGlyph, spellDegreePc,
} from '../ucss.ts';

const C_MAJOR = { tonic: 0, scale: 'ionian' };

function pcs(input: string, key = null as NonNullable<Parameters<typeof parseUcss>[1]>['key']): number[] {
  const c = parseUcss(input, { key });
  return intervalsOf(c, key).map((s) => ((c.anchorPc ?? 0) + s) % 12);
}

describe('parseUcss — traditional subsumption', () => {
  it('plain triads', () => {
    expect(pcs('C')).toEqual([0, 4, 7]);
    expect(pcs('Cm')).toEqual([0, 3, 7]);
    expect(pcs('C+')).toEqual([0, 4, 8]);
    expect(pcs('Cdim')).toEqual([0, 3, 6]);
    expect(pcs('Caug')).toEqual([0, 4, 8]);
  });

  it('sevenths and sixths', () => {
    expect(pcs('C7')).toEqual([0, 4, 7, 10]);          // dominant default
    expect(pcs('Cmaj7')).toEqual([0, 4, 7, 11]);
    expect(pcs('CΔ7')).toEqual([0, 4, 7, 11]);
    expect(pcs('Cm7')).toEqual([0, 3, 7, 10]);
    expect(pcs('Cm7b5')).toEqual([0, 3, 6, 10]);
    expect(pcs('Cdim7')).toEqual([0, 3, 6, 9]);
    expect(pcs('C6')).toEqual([0, 4, 7, 9]);
    expect(pcs('Cm6')).toEqual([0, 3, 7, 8]);           // Minor 6th Rule → ♭6
  });

  it('extensions & suspensions', () => {
    expect(pcs('Csus4')).toEqual([0, 5, 7]);
    expect(pcs('Csus2')).toEqual([0, 2, 7]);
    expect(pcs('C7sus4')).toEqual([0, 5, 7, 10]);
    expect(pcs('C9')).toEqual([0, 4, 7, 10, 14]);       // dom9 via extension default
    expect(pcs('G7b9')).toEqual([7, 11, 14, 17, 20].map((x) => x % 12));
  });

  it('add/remove fraction syntax', () => {
    expect(pcs('C7 /3')).toEqual([0, 7, 10]);                        // no third
    expect(pcs('C7 ♯11/3')).toEqual([0, 4, 7, 10, 6]);                // add ♯11 (pc 6), remove 3rd
    expect(pcs('C /9')).toEqual([0, 4, 7, 14]);                       // added ninth over triad
  });

  it('slash bass and figured prefix', () => {
    const d = parseUcss('D/F#');
    expect(d.bassPc).toBe(6);
    expect(toTraditional(d)).toBe('D/F♯');
    const f = parseUcss('^{D}_{F♯}D');
    expect(f.rootPc).toBe(2);
    expect(f.bassPc).toBe(6);
  });

  it('roman numeral anchors infer quality', () => {
    const ii = parseUcss('ii');
    expect(ii.anchorKind).toBe('function');
    expect(ii.quality).toBe('m');
    expect(intervalsOf(ii)).toEqual([0, 3, 7]);
    const V7 = parseUcss('V7');
    expect(V7.quality).toBeNull();
    expect(intervalsOf(V7)).toEqual([0, 4, 7, 10]);
  });

  it('latex \\\\chord form parses', () => {
    const c = parseUcss('\\chord{C}{}{7}{\\sharp11}{3}{}{}{}{}');
    expect(c.extension).toBe(7);
    expect(c.rem).toEqual([3]);
  });
});

describe('UCSS ambiguity rules', () => {
  it('Minor 6th Rule is key-aware', () => {
    // In C major, a minor chord on D (ii) has the Dorian ♮6 (B in scale).
    const ii6 = parseUcss('Dm6');
    expect(intervalsOf(ii6, C_MAJOR)).toEqual([0, 3, 7, 9]);
    // Without key context, m6 defaults to Aeolian ♭6.
    expect(intervalsOf(parseUcss('Dm6'))).toEqual([0, 3, 7, 8]);
    // Mode tag forces the reading regardless of key.
    expect(intervalsOf(parseUcss('Am6 Aeolian'))).toEqual([0, 3, 7, 8]);
    expect(intervalsOf(parseUcss('Am6 Ionian'))).toEqual([0, 3, 7, 9]);
  });

  it('quality overrides contextual defaults (mM7 stays minor)', () => {
    const c = parseUcss('C 7 /m'); // quality subscript wins over dominant default
    expect(c.quality).toBe('m');
    expect(intervalsOf(c)).toEqual([0, 3, 7, 10]);
  });

  it('enharmonic spelling follows the analysis key', () => {
    expect(spellDegreePc(6, new Set([0, 2, 4, 5, 7, 9, 11]))).toBe('F♯');
    expect(spellDegreePc(10, new Set([5, 7, 9, 10, 0, 2, 4]))).toBe('B♭');
    expect(toLinear(parseUcss('F#'), { key: C_MAJOR })).toBe('F♯');
    expect(toLinear(parseUcss('Gb'), { key: { tonic: 5, scale: 'ionian' } })).toBe('B♭');
  });

  it('triad substitutions', () => {
    expect(intervalsOf(parseUcss('C 5'))).toEqual([0, 7]);        // power chord
    expect(intervalsOf(parseUcss('C 3'))).toEqual([0, 4]);        // bare third
    expect(intervalsOf(parseUcss('C 2'))).toEqual([0, 2, 7]);     // sus2
    expect(intervalsOf(parseUcss('C 4'))).toEqual([0, 5, 7]);     // sus4
  });
});

describe('glyph output', () => {
  it('toLinear renders the canonical 1D form', () => {
    const c = parseUcss('C7(#11, no 3)');
    expect(toLinear(c)).toContain('♯11/3');
    expect(toLinear(parseUcss('Cmaj7'))).toContain('7');
  });

  it('toHtmlGlyph places satellites around the anchor', () => {
    const html = toHtmlGlyph(parseUcss('C7♯11/3'));
    expect(html).toContain('u-anchor');
    expect(html).toContain('u-extension">7<');
    expect(html).toContain('u-num">♯11<');
    expect(html).toContain('u-den">3<');
  });

  it('empty slots collapse without stray markup content', () => {
    const html = toHtmlGlyph(parseUcss('C'));
    expect(html).toContain('<span class="u-cell u-quality"></span>');
  });
});

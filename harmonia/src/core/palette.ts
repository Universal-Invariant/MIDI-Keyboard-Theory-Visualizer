/**
 * Chord palette — color schemes for the keyboard (README §12 "colors").
 *
 * Modes:
 *  - mono:        every active key shares one highlight color.
 *  - pc:          each of the 12 pitch classes gets its own color
 *                 (Cherney-style rainbow: C red, D orange, E yellow … B pink).
 *  - chord:       each recognized chord symbol gets a stable color from a
 *                 rotating qualitative palette; diatonic chords in the selected
 *                 key get an extra-saturated variant so they visually stand out.
 *  - function:    colored by harmonic role relative to the selected key
 *                 (tonic / supertonic / … / dominant / non-diatonic), using the
 *                 classic Roman-numeral color conventions.
 *
 * The palette is pure data + lookup helpers; UI components call
 * `paletteColorFor(...)` and receive either a CSS color string or null
 * (null → fall back to the default accent styling).
 */

import { pitchClass } from './theory/pitch.ts';
import { scalePitchClasses, getScale } from './theory/scales.ts';
import type { KeySignatureSetting } from './types.ts';

export type PaletteMode = 'mono' | 'pc' | 'chord' | 'function';

export const PALETTE_MODES: { id: PaletteMode; name: string }[] = [
  { id: 'mono', name: 'Mono — single highlight color' },
  { id: 'pc', name: 'Per note — 12 pitch-class colors' },
  { id: 'chord', name: 'Per chord — color by recognized chord' },
  { id: 'function', name: 'By function — Roman-numeral roles in key' },
];

/** One highlight color per pitch class (C…B), rainbow layout. */
export const PC_COLORS = [
  '#e5484d', // C  red
  '#f26430', // C# orange-red
  '#f76b15', // D  orange
  '#ffb547', // Eb amber
  '#ffe669', // E  yellow
  '#95c93d', // F  lime
  '#46a758', // Gb green
  '#12a594', // G  teal
  '#0090ff', // Ab blue
  '#6ea8fe', // A  light blue (kept distinct from Ab)
  '#8e4ec6', // Bb purple
  '#d6409f', // B  pink
] as const;

export const MONO_COLOR = '#ffb547';

/** Harmonic-function colors (major-ish warm for dominants, cool for subdominants). */
export const FUNCTION_COLORS: Record<string, string> = {
  I: '#12a594',   // tonic — teal
  II: '#95c93d',  // supertonic — lime
  III: '#ffe669', // mediant — yellow
  IV: '#6ea8fe',  // subdominant — light blue
  V: '#f76b15',   // dominant — orange
  VI: '#8e4ec6',  // submediant — purple
  VII: '#d6409f', // leading tone — pink
  NONDIATONIC: '#e5484d', // chromatic / out-of-key — strong red
};

/** Common chord aliases so user-custom overrides can match many spellings. */
const SYMBOL_ALIASES: [string, string[]][] = [
  ['dim', ['dim', 'o', 'ø']],   // canonicalize first (longest)
  ['aug', ['aug', '+', '^+']],
  ['min', ['min', 'mi', 'm']],
];

function normalizeSymbol(sym: string): string {
  let s = sym.trim();
  for (const [canon, alts] of SYMBOL_ALIASES) {
    for (const a of alts) {
      if (a !== canon && s.endsWith(a)) { s = s.slice(0, -a.length) + canon; break; }
    }
  }
  return s.replace(/\s+/g, '');
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
void hashString; // reserved for future per-symbol stable overrides

/** Root pc + quality suffix extracted from a chord symbol like "Ab+", "Cm7", "F#dim". */
export function parseSymbolRoot(symbol: string): { rootPc: number; suffix: string } | null {
  const m = /^([A-Ga-g])([#b♯♭]?)(.*)$/.exec(normalizeSymbol(symbol));
  if (!m) return null;
  const letterPc: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let pc = letterPc[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  // Treat 'b' as a flat when there is more text after it ("Bbm" → Bb root + m)
  // or when the letter isn't B ("Ab", "F#b"…); a bare trailing 'b' on a B is
  // just the note name B.
  const hasSuffix = m[3] !== '';
  if (m[2] === '♭' || (m[2] === 'b' && (hasSuffix || !/^[Bb]$/.test(m[1])))) pc -= 1;
  return { rootPc: ((pc % 12) + 12) % 12, suffix: m[3] };
}

/**
 * Roman-numeral-ish function label for a chord given the key. Uses the chord's
 * root pitch class relative to the tonic and whether all chord tones are in
 * the scale. Returns keys of FUNCTION_COLORS or 'NONDIATONIC'.
 */
export function functionLabel(rootPc: number, _chordPcs: number[], key: KeySignatureSetting): string {
  const scale = scalePitchClasses(key.tonic, getScale(key.scale));
  const rel = ((rootPc - key.tonic) % 12 + 12) % 12;
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  // Map semitone offsets of scale degrees to numerals (assumes 7-note scales).
  const degreeOffsets = [...scale]
    .map((pc) => ((pc - key.tonic) % 12 + 12) % 12)
    .sort((a, b) => a - b);
  const idx = degreeOffsets.indexOf(rel);
  return idx >= 0 ? numerals[idx] : 'NONDIATONIC';
}

export interface PaletteContext {
  mode: PaletteMode;
  key: KeySignatureSetting;
  /** Best current chord symbol (top candidate), null/'' when silence. */
  currentSymbol: string | null;
  /** Pitch classes of the current chord (for function coloring). */
  currentChordPcs: number[];
  /** Per-note palettes: explicit color for each pitch class 0..11 (null = default). */
  pcColors?: (string | null)[];
  /** Function mode: user-overridden colors per Roman-numeral label. */
  functionColors?: Record<string, string>;
  /** Chord-mode palette: explicit color per quality id (null = auto by root hue). */
  qualityColors?: Partial<Record<string, string | null>>;
}

/** Auto color for a chord in "chord" mode when no quality override is set:
 *  root pitch-class hue + brightness shift by quality so e.g. C major and C minor
 *  share a family but remain distinguishable. */
function autoChordColor(rootPc: number, suffix: string): string {
  const base = PC_COLORS[rootPc];
  const q = suffix.toLowerCase();
  if (q.startsWith('m') && !q.includes('maj')) return shade(base, -28);   // minor darker
  if (q.includes('dim') || q === 'o' || q === 'ø') return shade(base, -55); // dim darkest
  if (q.includes('+') || q.includes('aug')) return shade(base, 45);       // aug brighter
  return base;                                                            // major = pure hue
}

/** Lighten/darken a #rrggbb color by `amt` (-100..100). */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt), g = clamp(((n >> 8) & 0xff) + amt), b = clamp((n & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Color for a key that is currently lit with pitch `pitch`. Null = use default. */
export function paletteColorFor(pitch: number, ctx: PaletteContext): string | null {
  switch (ctx.mode) {
    case 'mono':
      return MONO_COLOR;
    case 'pc': {
      const custom = ctx.pcColors?.[pitchClass(pitch)];
      return custom ?? PC_COLORS[pitchClass(pitch)];
    }
    case 'chord': {
      if (!ctx.currentSymbol) return null;
      const parsed = parseSymbolRoot(ctx.currentSymbol);
      if (!parsed) return null;
      const key = parsed.suffix.toLowerCase() || 'major';
      const override = ctx.qualityColors?.[key] ?? ctx.qualityColors?.['major'] ;
      if (override) return override;
      return autoChordColor(parsed.rootPc, parsed.suffix);
    }
    case 'function': {
      if (!ctx.currentSymbol) return null;
      const parsed = parseSymbolRoot(ctx.currentSymbol);
      if (!parsed) return null;
      const label = functionLabel(parsed.rootPc, ctx.currentChordPcs, ctx.key);
      return ctx.functionColors?.[label] ?? FUNCTION_COLORS[label] ?? FUNCTION_COLORS.NONDIATONIC;
    }
  }
}

/** Whether this palette mode needs the current-chord context to work. */
export function paletteNeedsChord(mode: PaletteMode): boolean {
  return mode === 'chord' || mode === 'function';
}

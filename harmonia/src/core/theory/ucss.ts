/**
 * UCSS — Unified Chord Symbol Specification.
 *
 * A spatially organized 9-parameter chord glyph that subsumes traditional
 * chord symbols while eliminating their structural ambiguities:
 *
 *              [R/B]⁻¹⁻ᵗⁱ  ⁽ⁱⁿᵛ⁾   ᴱ  ᵃᵈᵈ/ʳᵉᵐ
 *                    \      |      /
 *                 [mode]  ( F )  q        ← F = anchor (pitch letter or function)
 *                          \ /
 *      bottom-left = mode     bottom-right = quality
 *
 *  #1 Center Anchor    F     Function or absolute pitch (C, F♯, B♭ …)
 *  #2 Top Center       i     Inversion: none / one line (1st) / two lines (2nd) / three (3rd+)
 *  #3 Top Right        E     Extension: highest stacked third (7,9,11,13) or a
 *                            triad substitution (2=sus2, 3=bare third, 4=sus4, 5=power)
 *  #4/#5 Far Top Right add/rem  Degrees added/altered (numerator) and removed (denominator)
 *  #6 Bottom Right     q     Quality of the base triad: M m + o (dim) ø (half-dim)
 *  #7/#8 Top Left      R/B   Explicit root over explicit bass (slash chords / inversions)
 *  #9 Bottom Left      mode  Modal context (Ionian, Mixo, Lyd ♯7 …)
 *
 * This module implements the full grammar in both directions:
 *   • parseUcss()  — 1D linear text → UcssChord (also accepts traditional input:
 *                     "Cmaj7", "G7b9", "C7(no3)", "Csus4", "D/F#", "C add 9" …)
 *   • toLinear()   — UcssChord → canonical 1D string (what the UI displays)
 *   • toHtmlGlyph()— UcssChord → 2D HTML/CSS rendering of the canonical glyph
 *   • intervalsOf()— UcssChord → concrete semitone set, resolving every UCSS
 *                     ambiguity rule (dominant default, minor-♭6 rule, Δ-prefix
 *                     major extensions, mode-derived natural/flat sixths …)
 */

import type { KeySignatureSetting } from '../types.ts';
import { getScale, scalePitchClasses } from './scales.ts';
import { NOTE_NAMES_FLAT, NOTE_NAMES_SHARP, pitchClass } from './pitch.ts';

// ---- The 9-argument structure ----------------------------------------------

export interface UcssAlteration {
  /** Diatonic degree relative to the chord root: 1..13 (9 = 2 an octave up). */
  degree: number;
  /** -2 .. +2 semitone alteration (♭♭ ♭ natural(0) ♯ ♯♯). */
  alter: number;
}

export interface UcssInversion {
  kind: 'line' | 'figure';
  /** 1 = 1st inversion (third in bass), 2 = 2nd, 3 = 3rd (for extended stacks). */
  level: number;
}

export interface UcssChord {
  // #1 — anchor
  anchor: string;            // display spelling, e.g. "F♯"
  anchorPc: number | null;   // pitch class of the anchor (null for unknown/garbage)
  anchorKind: 'pitch' | 'function';
  // #7/#8 — root/bass prefix
  rootPc: number | null;     // true root when explicitly given via R/B
  rootDisplay: string | null;
  bassPc: number | null;     // explicit bass note (slash chord / figured bass)
  bassDisplay: string | null;
  /** Spelling bias the musician typed with ("B♭7" stays a flat, never "A♯7"). */
  anchorPrefer: 'sharp' | 'flat' | null;
  // #2 — inversion
  inversion: UcssInversion | null;
  // #3 — extension
  extension: number | null;  // 2 3 4 5 6 7 9 11 13 (or 15…21 as odd numbers)
  extensionIsMajor: boolean; // Δ-prefix forces major-quality extensions
  /** True when the extension came from a traditional "sus2/sus4" word rather
   *  than a bare UCSS substitution digit — decides whether the 3rd is replaced. */
  susMarker: boolean;
  /** Which suspension the "sus" word denoted (2 or 4); defaults to 4. */
  susDigit?: number | null;
  // #4/#5 — add/remove fraction
  add: UcssAlteration[];
  rem: number[];             // degrees removed
  /** True when `quality` came from a traditional word (m/maj/dim/ø/aug…) or an
   *  explicit subscript, rather than being inferred. Guards quality-driven
   *  defaults like rendering 'M' as "/M" in the linear form. */
  qualityFromWord?: boolean;
  // #6 — quality
  quality: string | null;    // 'M' 'm' '+' 'o' 'ø' (null = inferred by defaults)
  // #9 — modal context
  mode: string | null;       // free-text label, e.g. 'Lyd', 'mixolydian'
  modeRotation: number;      // rotation applied after chord generation
  raw: string;               // original source text
}

// ---- Spelling helpers --------------------------------------------------------

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PC_LETTER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];          // natural pc per letter
const LETTER_OF_PC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];      // white-key letter index per pc

function preferAccidentalName(pc: number, prefer: 'sharp' | 'flat'): string {
  const table = prefer === 'sharp' ? NOTE_NAMES_SHARP : NOTE_NAMES_FLAT;
  return table[pitchClass(pc)];
}

/**
 * Spell a pitch class as `letter + accidentals`, preferring letters whose
 * natural pitch class is diatonic to `diatonic` (the analysis scale). This is
 * what makes UCSS enharmonic disambiguation work: in C major, pc 6 → "F♯";
 * in F major (B♭ in scale), pc 10 → "B♭", never "A♯".
 *
 * Two spelling conventions coexist here:
 *  • **Diatonic** (default): every chromatic pc gets exactly one accidental on
 *    a scale letter — the classical staff rule. In C major, pc 10 → "A♯"
 *    (B would need a double flat) and pc 6 → "F♯".
 *  • **Chord-symbol**: popular jazz notation names upper structures after the
 *    parallel major scale of the root, so alterations read literally — a ♭9 of
 *    C is the lowered 2nd degree, spelled "D♭" rather than "C♯".
 * `mode` selects between them; `typedSign` always wins over both.
 */
export function spellDegreePc(
  pc: number,
  diatonic?: Set<number> | null,
  prefer: 'sharp' | 'flat' = 'flat',
  typedSign?: string | null,
  mode: 'diatonic' | 'chord-symbol' = 'diatonic',
): string {
  pc = pitchClass(pc);
  const forced = typedSign === '♯' || typedSign === '#' ? 1 : typedSign === '♭' || typedSign === 'b' ? -1 : 0;
  if (forced !== 0) {
    // Honor the enharmonic spelling the musician actually wrote — but never at
    // the cost of a *double* accidental. "Gb" inside F major: G♭ is foreign to
    // the key, and its single-flat alternative is A𝄫; the scale-consistent
    // reading is the scale tone B♭ instead. Only fall through to the forced
    // spelling when it needs at most one accidental on some letter.
    let fallback: string | null = null;
    for (let letter = 0; letter < 7; letter++) {
      const diff = (((pc - LETTER_PC[PC_LETTER[letter]]) % 12) + 12) % 12;
      const d = diff > 6 ? diff - 12 : diff;
      if (d === forced) return PC_LETTER[letter] + accStr(d);
      if (Math.abs(d) === 1 && !fallback) fallback = PC_LETTER[letter] + accStr(d);
    }
    if (!diatonic || !diatonic.has(pc)) {
      // No single-accidental spelling exists for this pc with the forced sign
      // (e.g. pc 6 typed ♭ → 𝄫 side); use whatever single-accidental name fits.
      if (fallback) return fallback;
    }
    // Otherwise: pc is in the scale and the forced sign would need bb/## —
    // continue into the scale-driven logic below, which yields the correct
    // member spelling (B♭ for pc 10 in F major).
  }
  if (!diatonic || diatonic.size < 5) return preferAccidentalName(pc, prefer);
  // NOTE: a typed accidental on the anchor is honored through `typedSign`/
  // `anchorPrefer` above; we must NOT short-circuit here on the flat/sharp
  // *bias* alone — that would re-spell chromatic pcs by bias instead of by the
  // scale ("C7 ♯11": pc 6 must resolve to F♯, the raised 4th of C major, not
  // G♭ merely because the default bias is 'flat').
  if (diatonic.has(pc)) {
    // The pc is a member of the analysis scale. Its white-key letter may be
    // *natural* in this scale ("G" in F major → plain G), in which case that
    // plain letter is the only correct spelling. Otherwise the scale forces an
    // accidental on some letter: in F major (B♭ in the set), pc 10 → "B♭",
    // never "A" — A-natural is foreign to the key. Collect every single-
    // accidental candidate whose spelled form actually sits inside the scale
    // and choose by the musician's typing bias; when nothing else pins it
    // down, prefer the letter that precedes the next scale tone (the classic
    // flat-side resolution: B before C).
    const whiteKeyLetter = PC_LETTER[LETTER_OF_PC[pc]];
    if (diatonic.has(LETTER_PC[whiteKeyLetter])) return whiteKeyLetter;
    const cands: { name: string; d: number }[] = [];
    for (let letter = 0; letter < 7; letter++) {
      const L = PC_LETTER[letter];
      const diff = (((pc - LETTER_PC[L]) % 12) + 12) % 12;
      const d = diff > 6 ? diff - 12 : diff;
      if (d === 0 || Math.abs(d) > 1) continue;                 // naturals handled above
      if (!diatonic.has(pitchClass(LETTER_PC[L] + d))) continue; // must sit in the scale
      cands.push({ name: L + accStr(d), d });
    }
    const biased = cands.find((x) => (prefer === 'flat' ? x.d === -1 : x.d === 1));
    if (biased) return biased.name;
    if (cands.length) {
      const nextPc = pitchClass(pc + 1);
      const best = cands.reduce((a, b) => {
        const la = 'ABCDEFG'.indexOf(a.name[0]);
        const lb = 'ABCDEFG'.indexOf(b.name[0]);
        const na = 'ABCDEFG'.indexOf(PC_LETTER[LETTER_OF_PC[nextPc]]);
        // Flat-side candidate whose letter immediately precedes the next scale
        // degree wins (B♭ before C in F major).
        const da = (la - na + 7) % 7 === 1 ? 1 : 0;
        const db = (lb - na + 7) % 7 === 1 ? 1 : 0;
        return db > da ? b : a;
      });
      return best.name;
    }
    return whiteKeyLetter;
  }
  let best: string | null = null;
  let bestScore = -Infinity;
  for (let letter = 0; letter < 7; letter++) {
    const diff = (((pc - LETTER_PC[PC_LETTER[letter]]) % 12) + 12) % 12;
    const d = diff > 6 ? diff - 12 : diff; // -5..+6 accidental count
    if (Math.abs(d) > 3) continue;
    // Letters whose naturals belong to the scale are strongly preferred, so
    // chromatic tones receive exactly one accidental (F♯, not G♭) in C major.
    // The tie-breaker mirrors the classical rule: sharp-side chromatics rise
    // from the lower diatonic letter (C→C♯→D), flat-side chromatics descend
    // from the higher one (A→A♭→G).
    const score = (diatonic.has(LETTER_PC[PC_LETTER[letter]]) ? 10 : 0) - Math.abs(d) * 3
      + (d > 0 ? 0.5 : d < 0 ? -0.5 : 0);
    const name = PC_LETTER[letter] + accStr(d);
    if (score > bestScore) { bestScore = score; best = name; }
  }
  if (mode === 'chord-symbol') {
    // Jazz chord-symbol convention: alterations are named against the root's
    // parallel major scale, so ♭9/♯11/♭13 land on the letter of degrees 2/4/6.
    const alt = spellAlterationFromMajorScale(pc, prefer);
    if (alt) return alt;
  }
  return best ?? preferAccidentalName(pc, prefer);
}

/**
 * Name a chromatic pc using the C-major reference frame: pc 1 → "D♭" (♭2),
 * pc 6 → "F♯" (♯4), pc 8 → "G♯"/"A♭" (♯5/♭6) depending on `prefer`.
 * Returns null for pcs that are already naturals of that frame.
 */
function spellAlterationFromMajorScale(pc: number, prefer: 'sharp' | 'flat'): string | null {
  const table = prefer === 'sharp' ? NOTE_NAMES_SHARP : NOTE_NAMES_FLAT;
  const natural = table[pitchClass(pc)];
  if (!/[♯#b]/.test(natural)) return null;
  return natural.replace('b', '♭').replace('#', '♯');
}

function accStr(alter: number): string {
  if (alter === 0) return '';
  if (alter === 1) return '♯';
  if (alter === 2) return '𝄪';
  if (alter === -1) return '♭';
  if (alter === -2) return '𝄫';
  return alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter);
}

// ---- Degree → semitone tables ------------------------------------------------

/** Natural (major-scale) semitone value of diatonic degrees 1..13. */
const NATURAL_DEGREE = [0, 0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21];

/** Semitone above root of each stacked-third extension within a MAJOR frame. */
const EXT_MAJOR: Record<number, number> = { 3: 4, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21, 15: 24, 17: 26, 19: 28, 21: 31 };
/** …within a MINOR frame (minor key's own upper extensions). */
const EXT_MINOR: Record<number, number> = { 3: 3, 5: 7, 6: 9, 7: 10, 9: 14, 11: 17, 13: 20, 15: 24, 17: 26, 19: 29, 21: 32 };
/** …within a DOMINANT frame (mixolydian family — the UCSS no-quality default).
 *  A dominant chord is a MAJOR triad with a minor seventh, so its third and
 *  fifth keep major-frame sizes (4 / 7); only the seventh (and 13) flatten. */
const EXT_DOM: Record<number, number> = { 3: 4, 5: 7, 6: 9, 7: 10, 9: 14, 11: 17, 13: 21, 15: 24, 17: 26, 19: 28, 21: 31 };

type Frame = 'M' | 'm' | 'D' | 'aug' | 'o';

/** Sizes of the triad itself per frame (the stack tables start at degree 6). */
const TRIAD: Record<Frame, [number, number]> = {
  M: [4, 7], m: [3, 7], D: [4, 7], aug: [4, 8], o: [3, 6],
};

/**
 * UCSS stacking rule for extensions: the highest stacked third is E, but every
 * intermediate third of the stack is present too — each degree takes its size
 * from the chord's quality frame (diminished chords stack minor thirds, etc.).
 * So `C9` = D-frame stack {4,7,10,14}; `Cm9` = m-frame stack {3,7,10,14}.
 * The table covers degrees ≥ 6; degrees 3/5 come from `TRIAD`.
 */
function frameStack(frame: Frame): Record<number, number> {
  if (frame === 'o') return { 6: 9, 7: 9, 9: 12, 11: 15, 13: 18 };
  if (frame === 'm') return EXT_MINOR;
  if (frame === 'D') return EXT_DOM;
  return EXT_MAJOR; // 'M' and 'aug' share the major extension sizes
}

function extSemitone(frame: Frame, deg: number, forceMajor: boolean): number | undefined {
  if (deg === 3 || deg === 5) return TRIAD[frame][deg === 3 ? 0 : 1];
  if (forceMajor && deg >= 7) return EXT_MAJOR[deg] ?? EXT_MAJOR[((deg - 1) % 12) + 1];
  if (frame === 'aug' && deg === 7) return 11; // aug chord keeps its own 7th color
  return frameStack(frame)[deg];
}

// ---- Core model ---------------------------------------------------------------

/** Effective root pc (explicit R wins over the anchor when anchor is functional). */
export function effectiveRoot(c: UcssChord): number | null {
  return c.rootPc ?? c.anchorPc;
}

/** Effective bass pc (explicit B / inversion figure wins over lowest chord tone). */
export function effectiveBassPc(c: UcssChord): number | null {
  if (c.bassPc !== null) return pitchClass(c.bassPc);
  if (c.inversion?.kind === 'figure') {
    const iv = intervalsOf(c);
    const idx = c.inversion.level; // 1 = third, 2 = fifth, 3 = seventh …
    const pick = iv[idx];
    if (pick !== undefined) return pitchClass((effectiveRoot(c) ?? 0) + pick);
  }
  return null;
}

/**
 * Resolve a UCSS chord into concrete semitone intervals above the root,
 * applying every disambiguation rule from the spec:
 *  • quality inference (triad default M, extension default dominant, Roman case),
 *  • triad substitutions (2/3/4/5),
 *  • major-frame vs minor/dominant-frame extensions (Δ prefix overrides),
 *  • the Minor 6th Rule (m6 → ♭6 unless the mode/key supplies a natural 6),
 *  • add/remove fractions with per-degree alterations.
 *
 * `key` (optional) lets the analysis key/scale resolve naturals — e.g. a `vi`
 * chord in C Ionian gets Aeolian ♭6, while a `ii` gets Dorian ♮6 automatically.
 */
export function intervalsOf(c: UcssChord, key?: KeySignatureSetting | null): number[] {
  const root = effectiveRoot(c);
  if (root === null) return [];

  const frame = inferFrame(c, key);
  const out = new Set<number>([0]);
  const stack = frameStack(frame);

  // Base triad third & fifth according to quality frame.
  out.add(TRIAD[frame][0]); out.add(TRIAD[frame][1]);

  // Seventh color for the diminished family: 'o'+7 = fully diminished (9),
  // 'ø'+7 = half-diminished (♭7→10). The ø frame is a minor triad, so its
  // stack already supplies the correct ♭7; only 'o' needs an override.
  const dimSeventh = c.quality === 'o' && c.extension === 7;
  if (dimSeventh) { out.delete(10); out.add(9); }

  // Triad substitutions (UCSS digits 2/3/4/5): these REPLACE part of the base
  // triad instead of stacking thirds on top of it.
  //   2 → sus2: the 3rd is replaced by the 2nd
  //   3 → bare third: the 5th is omitted
  //   4 → sus4: the 3rd is replaced by the 4th
  //   5 → power chord: the 3rd is omitted, leaving an isolated 5th
  const substitute = c.extension !== null && (c.extension <= 5);
  const removeSet = new Set<number>();
  if (substitute && c.extension !== null) {
    if (c.extension === 2) { out.add(2); removeSet.add(TRIAD[frame][0]); }
    else if (c.extension === 4) { out.add(5); removeSet.add(TRIAD[frame][0]); }
    else if (c.extension === 3) { removeSet.add(TRIAD[frame][1]); }
    else if (c.extension === 5) { removeSet.add(TRIAD[frame][0]); }
  }

  // Extension (stacked thirds) — every intermediate third of the stack sounds,
  // sized by the frame. Skip when the dim-family seventh was set explicitly
  // and when a triad substitution stands in for the stack.
  const ext = c.extension;
  if (ext !== null && ext >= 6 && !dimSeventh) {
    // Stacked-thirds rule: every third up to the extension sounds — but only
    // actual thirds (3,5,7,9,…), never the sixth, which is its own chord type.
    for (const deg of [3, 5, 7, 9, 11, 13, 15, 17, 19, 21]) {
      if (deg > ext) break;
      const s = extSemitone(frame, deg, c.extensionIsMajor);
      if (s !== undefined) out.add(s);
    }
    // A sus color layered on an extended stack (`C7sus4`) keeps its native
    // seventh/ninths but still replaces the third.
    if (c.susMarker) {
      removeSet.add(TRIAD[frame][0]);
      out.add(c.susDigit === 2 ? 2 : 5);
    }
  } else if (ext !== null && ext >= 6 && dimSeventh && c.susMarker) {
    removeSet.add(TRIAD[frame][0]);
    out.add(c.susDigit === 2 ? 2 : 5);
  }

  // Minor 6th Rule: an unaltered 6 on a minor chord is ♭6 (Aeolian) unless the
  // mode or key context supplies a natural 6 (e.g. ii in a major key = Dorian).
  // The default applies only when nothing else already dictates the sixth's size
  // — an explicit alteration (`Cm6♮6`), a Δ-prefixed major extension, or a
  // diminished stack all win over the rule.
  const sixAltered = c.add.some((a) => a.degree === 6 && a.alter !== 0);
  if (ext === 6 && frame === 'm' && !sixAltered && !(c.extensionIsMajor && frameStack(frame)[6] === 9)) {
    const naturalSix = modeSuppliesNaturalSix(c, key, root);
    out.delete(9);
    out.delete(8);
    out.add(naturalSix ? 9 : 8);
  }

  // Removals: map degrees to their current semitone in this frame. Degrees are
  // spelled against the major-scale reference (NATURAL_DEGREE) — except that a
  // ♯5 on an augmented chord is its native fifth, and a bare degree inside a
  // MINOR or DOMINANT frame takes that frame's own size for degrees whose
  // natural differs from the stack (7 → ♭7, 6 → ♮6/♭6, 3 → minor 3rd). So
  // "Cm7 /3" removes the minor third and "C7 /3" the major third alike.
  const removalBase = (deg: number): number | null => {
    if (deg === 1) return 0;
    if (frame === 'aug' && deg === 5) return 8;
    if ((frame === 'm' || frame === 'D') && deg >= 2 && deg <= 13) {
      const fs = extSemitone(frame, deg, false);
      if (fs !== undefined) return fs;
    }
    return NATURAL_DEGREE[deg] ?? null;
  };
  for (const deg of c.rem) {
    const s = removalBase(deg);
    if (s !== null) removeSet.add(s);
    // A removed degree also removes its octave-displaced duplicate elsewhere in
    // the stack: `/3` drops both the third and any tenth; `no5` clears 5 & 12.
    // Only tones that are actually part of *this* chord's stacked-thirds frame
    // may be removed — a bare added tone (`C /9` keeps its native major 6th,
    // which merely shares pc 9 with the ♮9) must not be collateral damage.
    const degMod7 = ((deg - 1) % 7) + 1;
    // Only frame tones that this chord actually sounds may be removed: the
    // stack up to `ext`, plus degree 7 when a seventh is implied by the
    // quality alone (e.g. "C♯° /7" — fully-diminished with an explicit
    // removal list but no stacked extension digit). Never evict the sixth
    // from a triad whose pc merely collides with a higher degree (the added
    // ♮9 of "C /9" shares pc 9 with the major sixth).
    const maxStacked = ext !== null ? ext : dimSeventh || frame === 'ø' ? 7 : 5;
    for (const [d, v] of Object.entries(stack)) {
      const dn = Number(d);
      if ((((dn - 1) % 7) + 1) === degMod7 && dn <= maxStacked) removeSet.add(v);
    }
    if (deg === 1) removeSet.add(0);
  }

  // Additions / alterations. An altered token always wins over whatever the
  // stack already contains at the same pitch class (`CmM7`: the Δ-prefixed
  // major 7 replaces the minor frame's ♭7). Unaltered additions never evict
  // an existing stack tone — they only add missing pitch classes.
  for (const a of c.add) {
    const base = degreeToSemitone(c, frame, a.degree);
    if (base === null) continue;
    const pc = pitchClass(root + base + a.alter);
    if (a.alter !== 0) {
      // An ALTERED addition is a true alteration: it evicts the plain diatonic
      // tone it modifies ("♯11" replaces the 4th; "b9" replaces the 9th), and
      // nothing else. It must NOT evict unrelated stack members that merely
      // share a pitch class — "C7 ♯11/3" keeps its major 3rd (pc 4 ≡ ♭11).
      for (const s of [...out]) if (pitchClass(root + s) === pc && s !== base + a.alter) out.delete(s);
      for (const d of [2, 4, 5, 6, 7, 9, 11, 13]) {
        if ((((d - 1) % 7) + 1) === ((a.degree - 1) % 7) + 1 && d !== a.degree) removeSet.add(d);
      }
    }
    out.add(base + a.alter);
  }

  let list = [...out].filter((s) => !removeSet.has(s));
  // Keep octave-wrapped pitch classes unique but preserve low-numbered order —
  // except when two surviving tones are DIFFERENT degrees (an added 9 vs. the
  // native 6th): then the higher-numbered (more compound) degree is the one
  // actually voiced, so keep it ("C /9" → 14, not 9).
  list.sort((a, b) => a - b);
  const bestForPc = new Map<number, number>();
  for (const s of list) {
    const pc = pitchClass(root + s);
    bestForPc.set(pc, s); // ascending order → last write keeps the highest
  }
  list = list.filter((s) => bestForPc.get(pitchClass(root + s)) === s);
  return list.length ? list : [0];
}

function degreeToSemitone(c: UcssChord, frame: Frame, deg: number): number | null {
  if (deg === 1) return 0;
  if (deg <= 13) {
    // Degrees are spelled against the major scale (NATURAL_DEGREE); alterations
    // must be written explicitly per the UCSS "never ambiguous" rule — except
    // that a ♯5 on an augmented chord is its native fifth.
    const natural = NATURAL_DEGREE[deg];
    return frame === 'aug' && deg === 5 ? 8 : natural;
  }
  // Extensions above 13: reuse the frame's stacked-thirds table.
  return extSemitone(frame, deg, c.extensionIsMajor) ?? null;
}

function modeSuppliesNaturalSix(c: UcssChord, key: KeySignatureSetting | null | undefined, rootPc: number): boolean {
  // 1) Explicit mode tag on the chord itself.
  if (c.mode) {
    const m = c.mode.toLowerCase();
    if (/ion|lyd|major|melodic/.test(m)) return true;
    if (/aeol|locrian|phryg|min|harmonic/.test(m)) return false;
    if (/dor|mixo/.test(m)) return true; // dorian & mixolydian both carry a ♮6
  }
  // 2) Analysis-key context: does the scale contain the ♮6 above this root?
  if (key) {
    const scale = scalePitchClasses(key.tonic, getScale(key.scale));
    if (scale.has(pitchClass(rootPc + 9))) return true;
    if (scale.has(pitchClass(rootPc + 8))) return false;
  }
  return false; // Aeolian default
}

/** Determine the harmonic frame (quality) using UCSS's inference rules. */
export function inferFrame(c: UcssChord, key?: KeySignatureSetting | null): Frame {
  void key;
  if (c.quality === 'o') return 'o';
  if (c.quality === 'ø') return 'm'; // half-diminished = minor triad + ♭7 (handled below)
  if (c.quality) {
    if (c.quality === 'M') return 'M';
    if (c.quality === 'm') return 'm';
    if (c.quality === '+') return 'aug';
  }
  if (c.anchorKind === 'function') {
    // Roman numeral case infers quality: lowercase → minor.
    const firstLetter = /[IVX]/.exec(c.anchor)?.[0] ?? 'I';
    return firstLetter === firstLetter.toLowerCase() ? 'm' : 'D';
  }
  // Absolute pitch anchors: extension without quality ⇒ dominant; otherwise major.
  return c.extension !== null && c.extension >= 6 ? 'D' : 'M';
}

/**
 * The degree a suspension replaces. UCSS defines 2/4 as substitutions of the
 * third — but only when the third is actually part of the chord's own stack.
 * A sus color layered on an extended chord (`C9sus4` keeps its native 7th and
 * 9th) leaves the intermediate tones alone.
 */
function suspendedThird(frame: Frame, ext: number): number | null {
  if (ext !== 2 && ext !== 4) return null;
  const stack = frameStack(frame);
  const third = stack[3];
  const seventh = stack[7];
  if (seventh !== undefined && seventh < ext) return null; // e.g. sus over a 9th/13th stack
  return third ?? null;
}

// ---- 1D linear output ----------------------------------------------------------

export interface LinearOpts {
  key?: KeySignatureSetting | null;
  prefer?: 'sharp' | 'flat';
}

/** The accidental sign the musician typed on a token ("F♯" → ♯, "Bb" → ♭). */
function typedSignOf(text: string): string | null {
  return /[♯#]/.test(text) ? '♯' : /[♭](?![♭b])|(?<=\s|^)[bB](?=[1-9\s]|$)|bb$/.test(text) ? '♭' : null;
}

/** Spelling bias implied by what the musician typed (never re-spell a flat as a sharp). */
function typedPrefer(c: UcssChord, opts: LinearOpts): 'sharp' | 'flat' {
  const sign = c.anchorPrefer ?? typedSignOf(c.anchor);
  if (sign === 'sharp' || sign === '♯') return 'sharp';
  if (sign === 'flat' || sign === '♭') return 'flat';
  return opts.prefer ?? 'flat';
}

/** Canonical 1D rendering: `anchor [R/B] ⁽ᴱ⁾ add/rem /q mode`, single spaces. */
export function toLinear(c: UcssChord, opts: LinearOpts = {}): string {
  const prefer = typedPrefer(c, opts);
  const diatonic = opts.key ? scalePitchClasses(opts.key.tonic, getScale(opts.key.scale)) : null;

  const typedSign = typedSignOf(c.anchor);
  let out = c.anchorKind === 'pitch' && c.anchorPc !== null
    ? spellDegreePc(c.anchorPc, diatonic, prefer, typedSign)
    : c.anchor;

  // Root/bass fraction prefix ^{R}_{B}.
  if (c.rootPc !== null || c.bassPc !== null) {
    const r = c.rootPc !== null ? spellDegreePc(c.rootPc, diatonic, prefer, typedSignOf(c.rootDisplay ?? '')) : '';
    const b = c.bassPc !== null ? spellDegreePc(c.bassPc, diatonic, prefer, typedSignOf(c.bassDisplay ?? '')) : '';
    out = `^{${r}}_{${b}}${out}`;
  }

  // Extension superscript (with Δ when major extensions forced). A traditional
  // "sus" word renders as the substitution digit of its suspension (4 for sus4,
  // 2 for sus2) alongside the underlying extension (`7 4` for C7sus4).
  // The Δ glyph itself carries the "major seventh" meaning, so a quality-'M'
  // chord with a forced-major 7th renders as "Δ7" without a duplicate 'M';
  // likewise a traditional "maj"/"M" word on a plain triad needs no subscript —
  // only an *explicit* UCSS /M subscript is echoed back.
  const dupM = c.quality === 'M' && (c.extensionIsMajor || !c.qualityFromWord);
  if (!dupM && c.quality === 'M') out += '/M';
  else if (c.quality && c.quality !== 'M') out += `/${c.quality}`;
  if (c.extension !== null) out += ` ${c.extensionIsMajor ? 'Δ' : ''}${c.extension}`;
  if (c.susMarker && c.extension !== 2 && c.extension !== 4) out += ` ${c.susDigit ?? 4}`;

  // Add/remove fraction — always written `add/rem` so a remove-only numerator
  // keeps its slash visible (`♯11/3`, `/3`). When there is no numerator the
  // leading space is suppressed so the slash reads as part of the token.
  if (c.add.length || c.rem.length) {
    const addStr = c.add.map((a) => `${accStr(a.alter)}${a.degree}`).join(' ');
    const remStr = c.rem.join(' ');
    out += `${addStr ? ' ' : ''}${addStr}/${remStr}`;
  }



  // Inversion marker.
  if (c.inversion) {
    out += c.inversion.kind === 'line' ? ` ${'≡'.repeat(Math.min(3, c.inversion.level)).replace(/≡≡/g, '‖').replace(/‖≡/, '≡≡')}` : ` i${c.inversion.level}`;
  }

  // Mode suffix.
  if (c.mode) out += ` ${c.mode}${c.modeRotation ? String(c.modeRotation) : ''}`;

  return out.replace(/\s+/g, ' ').trim();
}

/** Traditional-style fallback symbol (best-effort), e.g. "Cmaj7", "D/F♯", "C7♯11(no3)". */
export function toTraditional(c: UcssChord, opts: LinearOpts = {}): string {
  const prefer = typedPrefer(c, opts);
  const diatonic = opts.key ? scalePitchClasses(opts.key.tonic, getScale(opts.key.scale)) : null;
  const root = effectiveRoot(c);
  const typedSign = typedSignOf(c.anchor);
  let base = root !== null ? spellDegreePc(root, diatonic, prefer, typedSign) : c.anchor;
  const frame = inferFrame(c);

  if (c.quality === 'o') base += 'dim';
  else if (c.quality === 'ø') base += 'm7♭5';
  else if (c.quality === '+') base += 'aug';
  else if (frame === 'm' && c.quality !== 'M') base += 'm';

  if (c.extension !== null) {
    if (c.extension === 2) base += 'sus2';
    else if (c.extension === 4) base += 'sus4';
    else if (c.extension === 5) base += '5';
    else if (c.extension === 3) base += '';
    else if (c.extension === 7 && (frame === 'M' || c.extensionIsMajor)) base += 'maj7';
    else base += String(c.extension);
  }
  if (c.susMarker && c.extension !== null && c.extension !== 2 && c.extension !== 4) {
    base += c.extension === 2 ? 'sus2' : 'sus4';
  }
  // Alterations render against the root's parallel major scale (♭9 = D♭ over C).
  for (const a of c.add) base += `${accStr(a.alter)}${a.degree}`;
  if (c.rem.length) base += `(${c.rem.map((d) => `no${d}`).join(', ')})`;
  if (c.bassPc !== null) base += '/' + spellDegreePc(c.bassPc, diatonic, prefer, typedSignOf(c.bassDisplay ?? ''), 'chord-symbol');
  return base;
}

// ---- 2D HTML glyph -------------------------------------------------------------

export interface GlyphOpts extends LinearOpts {
  /** Render at hero size (current chord) vs compact (history chips). */
  large?: boolean;
}

/**
 * Build the canonical 2D glyph as HTML. Mirrors the TikZ topology: center anchor
 * with eight satellites placed by CSS grid areas. Empty slots collapse cleanly.
 */
export function toHtmlGlyph(c: UcssChord, opts: GlyphOpts = {}): string {
  const prefer = typedPrefer(c, opts);
  const diatonic = opts.key ? scalePitchClasses(opts.key.tonic, getScale(opts.key.scale)) : null;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const typedSign = typedSignOf(c.anchor);
  const anchorText = c.anchorKind === 'pitch' && c.anchorPc !== null
    ? spellDegreePc(c.anchorPc, diatonic, prefer, typedSign)
    : c.anchor;

  const invLines = c.inversion?.kind === 'line'
    ? `<span class="u-inversion-lines" data-level="${c.inversion.level}"></span>`
    : c.inversion
      ? `<span class="u-inversion">i${c.inversion.level}</span>`
      : '';

  // Extension slot: the highest stacked third, or a triad substitution digit.
  // A traditional "sus" word layered on another extension shows both (`7` + `4`).
  const extDigits: number[] = [];
  if (c.extension !== null) extDigits.push(c.extension);
  if (c.susMarker && c.extension !== 2 && c.extension !== 4) extDigits.push(c.susDigit ?? 4);
  const ext = extDigits.length
    ? `<span class="u-extension">${c.extensionIsMajor ? 'Δ' : ''}${extDigits.join(' ')}</span>`
    : '';

  const frac = (top: string, bot: string) =>
    `<span class="u-frac"><span class="u-num">${top}</span><span class="u-den">${bot}</span></span>`;

  const addRem = (c.add.length || c.rem.length)
    ? frac(c.add.map((a) => esc(`${accStr(a.alter)}${a.degree}`)).join(' '), c.rem.join(' '))
    : '';

  const qual = c.quality ? `<span class="u-quality">${esc(c.quality)}</span>` : '';

  const rootBass = (c.rootPc !== null || c.bassPc !== null)
    ? frac(
        c.rootPc !== null ? esc(spellDegreePc(c.rootPc, diatonic, prefer, typedSignOf(c.rootDisplay ?? ''))) : '',
        c.bassPc !== null ? esc(spellDegreePc(c.bassPc, diatonic, prefer, typedSignOf(c.bassDisplay ?? ''))) : '',
      )
    : '';

  const mode = c.mode
    ? `<span class="u-mode">${esc(c.mode)}${c.modeRotation ? esc(String(c.modeRotation)) : ''}</span>`
    : '';

  return [
    '<span class="ucss-glyph' + (opts.large ? ' ucs--large' : '') + '" role="img" aria-label="' + esc(toLinear(c, opts)) + '">',
    `<span class="u-cell u-rootbass">${rootBass}</span>`,
    `<span class="u-cell u-inv">${invLines}</span>`,
    `<span class="u-cell u-ext">${ext}</span>`,
    `<span class="u-cell u-addrem">${addRem}</span>`,
    `<span class="u-cell u-anchor">${esc(anchorText)}</span>`,
    `<span class="u-cell u-mode">${mode}</span>`,
    `<span class="u-cell u-quality">${qual}</span>`,
    '</span>',
  ].join('');
}

// ---- Parser ---------------------------------------------------------------------

export interface ParseOpts {
  key?: KeySignatureSetting | null;
  prefer?: 'sharp' | 'flat';
}

const ACC_MAP: Record<string, number> = { '♭': -1, 'b': -1, '♯': 1, '#': 1, '𝄪': 2, '##': 2, '♮': 0 };

interface Tok { letter: string; acc: number; pc: number }

/** Match "C", "F#", "B♭", "Bb" (=B♭), "bb7"… at the start of `text`. */
function parseNoteToken(text: string): Tok | null {
  const mm = /^([A-Ga-g])/.exec(text);
  if (!mm) return null;
  const letter = mm[1].toUpperCase();
  let pc = LETTER_PC[letter];
  let acc = 0;
  let i = mm[0].length;
  while (i < text.length) {
    const ch = text[i];
    let d: number | undefined;
    if (ch === '♭' || ch === '♯' || ch === '#' || ch === '♮') d = ACC_MAP[ch];
    // ASCII 'b' is only an accidental when chained with another accidental ("bb")
    // or quantified ("b9"); otherwise it is the note name B ("Bm7" = B minor).
    else if (ch === 'b' && acc !== 0 && text[i + 1] === 'b') d = -1;
    if (d === undefined) break;
    acc += d;
    pc += d;
    i++;
  }
  return { letter, acc, pc: pitchClass(pc) };
}

/** Recognize roman numerals incl. V/V, bII, ♭VII, Ger, It, Fr (relative to C). */
function parseFunctionAnchor(text: string): { anchor: string; pc: number | null; acc: number } | null {
  const t = text.trim();
  const primaryMap: Record<string, { pc: number; acc: number }> = {
    Ger: { pc: 8, acc: 0 }, It: { pc: 1, acc: 0 }, Fr: { pc: 6, acc: 0 },
    'V/V': { pc: 7, acc: 0 }, 'vii°/V': { pc: 11, acc: 0 },
  };
  const primary = primaryMap[t];
  if (primary) return { anchor: t, pc: primary.pc, acc: primary.acc };

  const m = /^([♭♯]?)([ivxIVX]+)([♯]?)(°?)(\/([ivxIVX]+))?$/.exec(t);
  if (!m) return null;
  const numerals = m[2];
  const romanValue = (s: string): number | null => {
    const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
    return map[s.toUpperCase()] ?? null;
  };
  const val = romanValue(numerals);
  if (val === null) return null;
  let acc = m[1] === '♭' ? -1 : m[1] === '♯' ? 1 : 0;
  if (m[3]) acc += 1;
  // Relative semitone offset of each scale degree in a major frame.
  const DEG_SEMI = [0, 2, 4, 5, 7, 9, 11];
  let pc = DEG_SEMI[val - 1] + acc;
  if (m[6]) pc += 7; // secondary dominant: transpose up a fifth
  return { anchor: t, pc: pitchClass(pc), acc };
}

/**
 * Split one leading chord token — an absolute pitch ("F#m7" → "F#" + "m7") or a
 * function ("bII", "V/V", "Ger", "vii°/V"). Returns null when neither matches.
 */
function matchHeadToken(text: string): { token: string; rest: string } | null {
  const fn = /^(?:Ger|It|Fr|[♭♯]?(?:vii|vi|v|iv|iii|ii|i)°?(?:\/(?:vii|vi|v|iv|iii|ii|i))?)/i.exec(text)?.[0];
  if (fn && /^[ivxIVX♭♯]/.test(fn)) return { token: fn, rest: text.slice(fn.length) };
  if (/^(Ger|It|Fr)/.test(text)) return { token: /^(Ger|It|Fr)/.exec(text)![0], rest: text.slice(3) };

  const tok = parseNoteToken(text);
  if (!tok) return null;
  // Consume the letter plus any accidentals that belong to it.
  let len = 1;
  while (len < text.length && /[♭♯#♮]/.test(text[len])) len++;
  // A doubled ASCII 'b' after a unicode accidental is a second flat ("B♭b").
  if (len > 1 && /[♭]/.test(text[len - 1]) && text[len] === 'b' && text[len + 1] === undefined) len++;
  return { token: text.slice(0, len), rest: text.slice(len) };
}

/**
 * Parse any UCSS 1D string — canonical linear form OR traditional chord symbol —
 * into the full 9-argument structure. Never throws; garbage degrades to an
 * unknown anchor with null pcs.
 */
export function parseUcss(input: string, opts: ParseOpts = {}): UcssChord {
  const raw = input.trim();
  const chord: UcssChord = {
    anchor: raw, anchorPc: null, anchorKind: 'pitch',
    rootPc: null, rootDisplay: null, bassPc: null, bassDisplay: null,
    anchorPrefer: null,
    inversion: null, extension: null, extensionIsMajor: false, susMarker: false,
    add: [], rem: [], quality: null,
    mode: null, modeRotation: 0, raw,
  };
  if (!raw) { chord.anchor = ''; return chord; }

  // LaTeX \chord{F}{i}{E}{add}{rem}{q}{R}{B}{mode} form (pasted from the spec doc).
  const latex = /^\\chordx?\{((?:[^{}]|\{[^{}]*\})*)\}((?:\{(?:[^{}]|\{[^{}]*\})*\}){8})$/.exec(raw);
  if (latex) {
    const args = [latex[1], ...Array.from(latex[2].matchAll(/\{((?:[^{}]|\{[^{}]*\})*)\}/g)).map((m) => m[1])];
    fillFromLatex(chord, args, opts);
    finalizeAnchor(chord);
    return chord;
  }

  // Canonical 1D prefix form ^{R}_{B}anchor ("^{D}_{F♯}D"): strip it first so the
  // remaining text parses as an ordinary symbol.
  {
    const rb = /^\^\{([^}]*)\}_\{([^}]*)\}\s*/.exec(raw);
    if (rb) {
      const r = parseNoteToken(rb[1]);
      const b = parseNoteToken(rb[2]);
      if (r) { chord.rootPc = r.pc; chord.rootDisplay = rb[1]; }
      if (b) { chord.bassPc = b.pc; chord.bassDisplay = rb[2]; }
    }
  }

  let rest = raw.replace(/^\^\{[^}]*\}_\{[^}]*\}\s*/, '');

  // 9) Trailing modal-context token ("C7 ♯11/3 Lyd", "… mixolydian", "… Ion. Aug.").
  const MODE_WORDS = /(ion(?:ian)?(?:\.?\s?aug(?:mented?)?)?|lyd(?:ian)?(?:\s?(?:aug(?:mented)?|♭7|♭2))?|mixo(?:lydian)?(?:\s?♭6)?|dor(?:ian)?|phryg(?:ian)?(?:\s?(?:dom(?:inant)?|major))?|aeol(?:ian)?|locrian|ultralocrian|harmonic\s?minor|melodic\s?minor|whole\s?tone|alt(?:erated)?|bebob)/i;
  {
    const mModeTail = new RegExp(`^(.*?)\\s+((?:[A-G][♭♯#]?\\s+)?${MODE_WORDS.source})(\\d?)$`, 'i');
    const mm = mModeTail.exec(rest);
    if (mm) {
      chord.mode = mm[2].trim();
      chord.modeRotation = mm[3] ? Number(mm[3]) - 1 : 0;
      rest = mm[1];
    }
  }

  // 8) Trailing fraction tail `add/rem` and the quality subscript `/q`.
  //    UCSS reserves the final slash for these roles, so we peel the LAST
  //    slash of the string and classify what follows it:
  //      • a single quality char (M m + o ø), alone or fused to the remove
  //        list ("C7/m3" ⇒ quality m + rem 3; "C 7 /m" ⇒ quality m);
  //      • a degree list — the denominator ("C7/3", "C7 ♯11/3");
  //      • anything else → not our slash; handled by the bass stage below.
  //    The numerator is everything before that last slash. Only one fraction
  //    tail may be consumed here: if the numerator itself still contains a
  //    slash, the whole construct is something else entirely (a traditional
  //    bass like "C/G" or a nested rewrite) and is left to the bass stage.
  //    Within a valid numerator, the EXTENSION is a bare digit that either
  //    (a) is the first numerator token and separated from the anchor by
  //    whitespace ("C 7 /3" ⇒ ext 7, rem 3), or (b) trails only accidentals
  //    after the anchor letter ("G7♭9/5" ⇒ ext 7, add ♭9, rem 5 — the ♭9
  //    starts with '♭', so it can never be mistaken for an extension). Every
  //    other numerator token is an addition ("C /9" ⇒ add 9; "C 7 ♯11/3" keeps
  //    ext 7 because ♯11 sits AFTER it). The whole fraction grammar lives in
  //    tryFractionTail() so the legacy-paren rewrite can re-run it.
  const tryFractionTail = (): boolean => {
    const idx = rest.lastIndexOf('/');
    if (idx < 0 || rest.slice(0, idx).includes('/')) return false;
    {
      const preT = rest.slice(0, idx);
      const postT = rest.slice(idx + 1).trim();
      const qm = /^([Mm+o\u00f8])((?:\s*[\u266F\u266D#\u266E]?\d+)*)$/.exec(postT);
      const denOk = /^[♯♭#bB♮]?\d(?:\s*[♯♭#bB♮]?\d+)*$/.test(postT);
      // Slash-bass guard: UCSS reserves the final slash for /q and add/rem, so
      // a denominator that is a NOTE SPELLING ("D/F#", "C/G", "Am7/B♭") must be
      // routed to the bass stage instead. The tell is the character glued to
      // the slash: removal lists always begin with a digit or an accidental
      // sign (♯ ♭ #), never a letter. ASCII 'b' doubles as the note B, so it
      // only counts as a flat when followed by a digit ("b3" ⇒ remove 3;
      // "bb" ⇒ B♭ bass). A leading space before the slash also means bass —
      // canonical fractions write "/rem" tight ("C 7 /3" notwithstanding: its
      // numerator ends in the extension digit, which we accept because the
      // denominator itself is digit-initial).
      const firstPost = rest[idx + 1] ?? '';
      const postIsNoteSpelling =
        /^[A-Ga-g](?:bb?|[♯♭#♮])?$/.test(postT) && !/\d/.test(postT);
      const slashGluedToLetterBass = /[A-Ga-g♯♭♮]$/.test(preT.trimEnd()) && !/^\d/.test(postT);
      if (postIsNoteSpelling || slashGluedToLetterBass) return false;
      void firstPost;
      if (qm && !/^(?:maj|mi|min|m|M)$/i.test(preT.trim())) {
        chord.quality = qm[1];
        chord.qualityFromWord = true; // explicit UCSS subscript — render it back
        for (const d of qm[2].matchAll(/\d+/g)) chord.rem.push(Number(d));
        rest = preT.trimEnd();
        return true;
      }
      if (postT === '' || denOk) {
        // UCSS reserves the slash for the add/remove fraction and the quality
        // subscript, so a traditional slash-bass ("D/F♯", "C/G") must be routed
        // to the bass stage instead of being mis-read as a removal. The tell:
        // the numerator's LAST token is a note spelling — a letter (optionally
        // with accidentals) directly adjacent to the slash. Denominators are
        // bare degree lists ("3", "♯11/3" ⇒ numerator ends in ♯11), never letters.
        const preTrim = preT.trimEnd();
        if (/^[A-Ga-g](?:[♯♭#♮]{1,2})?$/.test(preTrim)) return false;

        const numPart = preT;
        interface Tok { s: string; i: number }
        const toks: Tok[] = [];
        for (const m of numPart.matchAll(/(?:[♯♭♮]\d{1,2}|[#](?=\d)\d{1,2}|\bb(?=\d)\d{1,2}|\(\s*[♯#b♭]\s*\)\s*\d{1,2}|\d{1,2})/g)) {
          toks.push({ s: m[0], i: m.index! });
        }
        // Extension detection per the header comment above. A bare digit is
        // the extension only when it is the FIRST numerator token (either
        // fused to the anchor — "C7/3" — or whitespace-separated from it —
        // "C 7 /3"). Digits at any other position are additions ("C /9" ⇒ add
        // 9; "C 7 ♯11/3" keeps ext 7 because ♯11 sits AFTER it).
        let extK = -1;
        if (toks.length && /^\d+$/.test(toks[0].s)) {
          const t0 = toks[0];
          const prevCh = numPart[t0.i - 1] ?? '';
          // Glued to the anchor head ("C7/3", "C7♯11/3") — always the extension.
          // Whitespace-separated ("C7 /3", "C 7 /3", "C /9"): the digit IS the
          // extension whenever no further tokens follow it in the numerator;
          // if signed addition tokens trail it ("C 7 ♯11/3") it stays the
          // extension too, and those signs keep their own tokens as additions.
          // The one non-extension case is a leading slash with nothing before
          // the digit except the anchor itself ("C /9" ⇒ add 9 over a triad).
          const gluedToAnchor = /[A-Ga-g♯♭♮]/.test(prevCh);
          const aloneInNumerator = toks.length === 1;
          const hasSignedAddsAfter = toks.slice(1).some((t) => /^[♯♭#b♮]/.test(t.s));
          if (gluedToAnchor || aloneInNumerator || hasSignedAddsAfter) extK = 0;
        }
        const end2 = extK >= 0 ? extK : toks.length;
        for (let k = 0; k < end2; k++) {
          const sm = /^([#b\u266F\u266D\u266E])?\s*(?:\(\s*([\u266F#b\u266D])\s*\))?\s*(\d{1,2})/.exec(toks[k].s)!;
          const sign = sm[1] || sm[2];
          chord.add.push({ degree: Number(sm[3]), alter: sign ? (ACC_MAP[sign] ?? 0) : 0 });
        }
        // Keep everything from the surviving extension token onward in `rest` —
        // including any quality word that trails it ("C7sus4/3" ⇒ rest "7sus4").
        if (end2 < toks.length) rest = numPart.slice(toks[end2].i);
        else if (toks.length) rest = numPart.slice(0, toks[0].i).trimEnd();
        else rest = preT.trimEnd();
        for (const d of postT.matchAll(/([\u266F\u266D#b\u266E]?)(\d+)/g)) chord.rem.push(Number(d[2]));
        return true;
      }
      // else: the slash belongs to the bass stage ("/F♯") — leave `rest` intact.
    }
    return false;
  };
  tryFractionTail();

  // 7) Inversion figures "i1/i2/i3".
  {
    const im = /^(.*?)\s+i([123])$/.exec(rest);
    if (im) {
      chord.inversion = { kind: 'figure', level: Number(im[2]) };
      rest = im[1];
    }
  }

  // 5) Legacy parenthesized additions "(add 9)" "(no 3rd)" "(b9)" → fraction syntax.
  rest = rest.replace(/\(([^)]*)\)/g, (_all, inner: string) => {
    let s = inner.trim().toLowerCase();
    const adds: string[] = [];
    const rems: string[] = [];
    // "sus2/sus4/sus" inside parens is a suspension word, not a degree list —
    // hand it back to the traditional-suffix parser untouched.
    if (/^\s*sus/.test(s)) return ` ${s}`;
    s = s.replace(/add/g, ' ').replace(/no\s*(\d+)/g, (_x, d) => { rems.push(d); return ' '; });
    for (const tk of s.match(/[♭♯#b]?\d+(?:\s*\(\s*[♭♯#b]\s*\))?/g) ?? []) {
      let alter = tk[0] === '♭' || tk[0] === 'b' ? '♭' : tk[0] === '♯' || tk[0] === '#' ? '♯' : '';
      // "(#11)" style: the sign lives inside parentheses after the number.
      if (!alter) {
        const pm = /\(\s*([♭♯#b])\s*\)/.exec(tk);
        if (pm) alter = pm[1] === '♭' || pm[1] === 'b' ? '♭' : '♯';
      }
      const deg = tk.replace(/[^0-9]/g, '');
      if (deg) adds.push(alter + deg);
    }
    const num = adds.join('');
    const den = rems.join('');
    if (!num && !den) return ' ';
    return ` ${num}/${den}`;
  });
  // The rewrite above may have minted a brand-new fraction tail ("C7(#11, no 3)"
  // → "C7 ♯11/3") after stage 8 already ran — retry the same grammar.
  tryFractionTail();

  // Add/remove fraction fallback — stage 8 above already consumed any valid
  // single-slash fraction tail. Anything still containing a slash here is
  // either a nested construct left by the legacy-paren rewrite or a slash
  // that was rejected upstream; retry the same grammar once more, but only
  // when the numerator contains no further slash. Traditional parenthesized
  // bass notes ("C7/G", "Dm7/A♭") were normalized back into slash-bass form
  // by PAREN_BASS before this point.
  {
    const PAREN_BASS = /\((?:b|♭)?\s*([A-Ga-g](?:[♯#]|bb?)(?:\s*[♯#])?)\s*\)$/;
    rest = rest.replace(PAREN_BASS, '/$1');
    tryFractionTail();
  }

  // 4) Slash bass "D/F#" (traditional) — only when not consumed as /q or /rem.
  {
    const sb = /^(.*?)\/([A-Ga-g](?:[♭♯#]|b(?=[1-9]))*)$/.exec(rest);
    if (sb) {
      const tok = parseNoteToken(sb[2]);
      if (tok) {
        chord.bassPc = tok.pc;
        chord.bassDisplay = sb[2];
        rest = sb[1];
      }
    }
  }

  // 1) Remaining head: anchor + traditional quality words + extension + alterations.
  rest = rest.trim();
  const head = matchHeadToken(rest);
  if (head) {
    const anchorTok = head.token;
    let tail = head.rest.trim();

    // Glued quality+digit forms ("m7", "maj7", "min7") can be split by the
    // letter tokenizer ("C" + "m7…"); peel a leading quality word when it is
    // immediately quantified by a stacked-third digit so the digit binds to
    // the quality, not to a bare UCSS extension. The digit may be followed by
    // more text ("m7b5", "maj13") — normalizeTraditionalQuality handles those
    // compound forms internally; here we only need to detect that a quality
    // word is glued to a digit at the start of the tail.
    const preQ = /^(maj|ma|M|min|mi|m)\d/i.exec(tail)
      || /^(maj|ma|min|mi|m)(?=[♭♯]\d)/i.exec(tail);
    if (preQ) {
      tail = normalizeTraditionalQuality(chord, tail);
    } else {
      tail = head.rest.trim();
    }

    // Peel loop: traditional quality words and extension digits may interleave
    // in any order ("m7", "maj7", "7sus4", "ø7", "dim7") — always consume a
    // leading quality word *before* reading a digit, so the digit belongs to
    // the quality word ("Cm7" → m + 7), not to a bare UCSS extension.
    for (;;) {
      const before = tail;
      tail = normalizeTraditionalQuality(chord, tail);
      const em = /^(Δ|△)?\s*(\d+)\s*(.*)$/.exec(tail);
      if (em) {
        const d = Number(em[2]);
        const alreadySet = chord.extension !== null;
        // A triad-substitution digit (2/3/4/5) only counts as an extension when
        // nothing has claimed the stack yet; once a real stacked-third extension
        // exists it is just another degree (handled by the leftover-addition
        // pass below). Higher degrees (6+) always extend the stack upward.
        const isSubstitution = d <= 5;
        const takesStack = !alreadySet || d > (chord.extension ?? 0);
        if (!isSubstitution || takesStack) {
          chord.extensionIsMajor ||= !!em[1];
          chord.extension = d;
          tail = em[3].trim();
          continue;
        }
      }
      if (tail === before) break;
    }

    // Quality-bearing traditional forms whose highest stacked third is implied
    // by the quality word itself: `ø`/half-diminished and `o`/diminished carry
    // a seventh only when the word was written in its 7-form ("Cø7", "Co7",
    // "Cdim7"); the bare triad words ("Cdim", "Caug") stay triads. The famous
    // shorthand "Cm7b5" ≡ "Cø7" is handled explicitly below.
    const headWord = /(?:^|[\s/])(maj7|ma7|M7|dim7|ø7|o7)/.exec(` ${chord.raw}`)?.[1] ?? '';
    const impliedSeventh = /^(?:dim7|ø7|o7)$/i.test(headWord)
      || /^min7\s*[\u266db]5/i.test(head.rest.trim());
    if (impliedSeventh && (chord.quality === '\u00f8' || chord.quality === 'o') && chord.extension === null) {
      chord.extension = 7;
    }

    const fn = parseFunctionAnchor(anchorTok);
    if (fn) {
      chord.anchorKind = 'function';
      chord.anchor = fn.anchor;
      chord.anchorPc = fn.pc;
      // Roman-numeral case infers quality (lowercase → minor) unless already set.
      if (!chord.quality) {
        const bare = /[ivxIVX]+/.exec(anchorTok)?.[0] ?? '';
        if (bare && bare === bare.toLowerCase()) chord.quality = 'm';
      }
    } else {
      const tok = parseNoteToken(anchorTok);
      if (tok) {
        chord.anchorKind = 'pitch';
        chord.anchorPc = tok.pc;
        // Re-spell from the token actually typed: matchHeadToken consumes every
        // trailing ♯/♭/#/♮, so "F#" must not be re-read through parseNoteToken's
        // ASCII-'b' guard — rebuild the display directly from what was matched.
        const accText = anchorTok.slice(1);
        let acc = 0;
        for (const ch of accText) {
          if (ch === '♯' || ch === '#') acc += 1;
          else if (ch === '♭' || ch === 'b') acc -= 1;
          else if (ch === '♮') acc += 0;
        }
        chord.anchorKind = 'pitch';
        chord.anchorPc = pitchClass(LETTER_PC[tok.letter] + acc);
        chord.anchor = tok.letter + accStr(acc);
        if (acc > 0) chord.anchorPrefer = 'sharp';
        else if (acc < 0) chord.anchorPrefer = 'flat';
      }
    }

    // Leftover alteration tokens with explicit accidentals ("G7 b9", "C7 \u266f11").
    // ASCII 'b'/'#' count as alteration signs only when quantifying a degree at
    // a token boundary — never inside a bass spelling ("Bb" stays B\u266d).
    for (const a of tail.matchAll(/(?:^|(?<=\s))([\u266f\u266d#b])(\d+)/g)) {
      chord.add.push({ degree: Number(a[2]), alter: ACC_MAP[a[1]] ?? 0 });
    }
    tail = tail.replace(/(?:^|(?<=\s))[\u266f\u266d#b]\d+/g, ' ');
    // Bare numbers left over are plain added degrees ("C 9" after ext parse, "C 7 9").
    for (const a of tail.matchAll(/(?:^|\s)(\d{1,2})(?=\s|$)/g)) {
      const d = Number(a[1]);
      if (d >= 2 && d <= 13 && d !== chord.extension) chord.add.push({ degree: d, alter: 0 });
    }
  } else if (rest) {
    // Unknown text: keep it as the anchor display, pc stays null.
    chord.anchor = rest;
    chord.anchorPc = null;
  }

  finalizeAnchor(chord);
  return chord;
}

/** Map traditional suffix words onto UCSS fields. Returns the leftover tail. */
function normalizeTraditionalQuality(chord: UcssChord, tail: string): string {
  let s = tail.trim();
  let matched = true;
  while (matched && s) {
    matched = false;
    const patterns: [RegExp, (m: RegExpMatchArray) => void][] = [
      [/^maj7(?![0-9])/i, () => { chord.quality = 'M'; chord.qualityFromWord = true; setExt(chord, 7); chord.extensionIsMajor = true; }],
      [/^ma7(?![0-9])/i, () => { chord.quality = 'M'; chord.qualityFromWord = true; setExt(chord, 7); chord.extensionIsMajor = true; }],
      [/^M7(?!\d)/, () => { chord.quality = 'M'; chord.qualityFromWord = true; setExt(chord, 7); chord.extensionIsMajor = true; }],
      [/^maj(?![0-9a-z])/i, () => { chord.quality = 'M'; chord.qualityFromWord = true; }],
      [/^(?:min|m)7\s*(?:b5|♭5)(?![0-9])/i, () => { chord.quality = 'ø'; chord.qualityFromWord = true; setExt(chord, 7); chord.add.push({ degree: 5, alter: -1 }); }],
      [/^min7b5(?![0-9])/i, () => { chord.quality = 'ø'; chord.qualityFromWord = true; setExt(chord, 7); }],
      [/^m7b5(?![0-9])/i, () => { chord.quality = 'ø'; chord.qualityFromWord = true; setExt(chord, 7); }],
      [/^m7♭5(?![0-9])/i, () => { chord.quality = 'ø'; chord.qualityFromWord = true; setExt(chord, 7); }],
      [/^ø(?![0-9])/, () => { chord.quality = 'ø'; chord.qualityFromWord = true; setExt(chord, 7); }],
      [/^dim7(?![0-9])/i, () => { chord.quality = 'o'; chord.qualityFromWord = true; setExt(chord, 7); }],
      [/^o7(?!\d)/, () => { chord.quality = 'o'; chord.qualityFromWord = true; setExt(chord, 7); }],
      [/^dim(?![0-9a-z])/i, () => { chord.quality = 'o'; chord.qualityFromWord = true; }],
      [/^aug7(?![0-9])/i, () => { chord.quality = '+'; chord.qualityFromWord = true; setExt(chord, 7); }],
      [/^aug(?![0-9a-z])/i, () => { chord.quality = '+'; chord.qualityFromWord = true; }],
      [/^\+(?!\d)/, () => { chord.quality = '+'; chord.qualityFromWord = true; }],
      [/^min6(?![0-9])/i, () => { chord.quality = 'm'; chord.qualityFromWord = true; setExt(chord, 6); }],
      [/^m6(?!\d)/i, () => { chord.quality = 'm'; chord.qualityFromWord = true; setExt(chord, 6); }],
      [/^min(?![0-9a-z])/i, () => { chord.quality = 'm'; chord.qualityFromWord = true; }],
      [/^mi(?![0-9a-z])/i, () => { chord.quality = 'm'; chord.qualityFromWord = true; }],
      [/^m(?![0-9a-z])/i, () => { chord.quality = 'm'; chord.qualityFromWord = true; }],
      [/^sus4(?![0-9])/i, () => { chord.susMarker = true; chord.susDigit = 4; setExt(chord, 4); }],
      [/^sus2(?![0-9])/i, () => { chord.susMarker = true; chord.susDigit = 2; setExt(chord, 2); }],
      [/^sus(?![0-9a-z])/i, () => { chord.susMarker = true; chord.susDigit = 4; setExt(chord, 4); }],
      [/^add\s*(\d+)/i, (m) => { chord.add.push({ degree: Number(m[1]), alter: 0 }); }],
    ];
    for (const [re, apply] of patterns) {
      const m = re.exec(s);
      if (m) {
        apply(m);
        s = s.slice(m[0].length);
        matched = true;
        break;
      }
    }
  }
  // Glued traditional forms where the quality word fused with digits ("m7b5" tail
  // already consumed above; handle leftovers like "#11", "b9", "sus4" remnants).
  return s;
}

/** Set the extension unless one was already established. The highest stacked
 *  third always wins: "7sus4" keeps its seventh (the sus word only colors it),
 *  while a bare "sus4" on a triad records the substitution digit 4. */
function setExt(c: UcssChord, e: number): void {
  if (c.extension === null || e > c.extension) c.extension = e;
}

function fillFromLatex(chord: UcssChord, args: string[], opts: ParseOpts): void {
  void opts;
  const [f, inv, ext, add, rem, q, r, b, mode] = args.map((a) => (a ?? '').trim());
  chord.anchor = f;
  const fn = parseFunctionAnchor(f);
  const tok = parseNoteToken(f);
  if (fn) { chord.anchorKind = 'function'; chord.anchorPc = fn.pc; }
  else if (tok) { chord.anchorPc = tok.pc; chord.anchor = tok.letter + accStr(tok.acc); }
  if (/^[-–]$|^ilt|≡/.test(inv)) chord.inversion = { kind: 'line', level: inv.includes('≡') || inv === '-' ? 1 : 2 };
  else if (/^[123]$/.test(inv)) chord.inversion = { kind: 'figure', level: Number(inv) };
  const dm = /^(Δ|△)?(\d+)$/.exec(ext);
  if (dm) { chord.extensionIsMajor = !!dm[1]; chord.extension = Number(dm[2]); }
  for (const a of add.matchAll(/([♭♯#b♮]?)(\d+)/g)) chord.add.push({ degree: Number(a[2]), alter: a[1] ? (ACC_MAP[a[1]] ?? 0) : 0 });
  for (const d of rem.matchAll(/\d+/g)) chord.rem.push(Number(d));
  if (/[Mm+oø]/.test(q)) chord.quality = q;
  const rtok = parseNoteToken(r); if (rtok) { chord.rootPc = rtok.pc; chord.rootDisplay = r; }
  const btok = parseNoteToken(b); if (btok) { chord.bassPc = btok.pc; chord.bassDisplay = b; }
  if (mode) chord.mode = mode;
}

function finalizeAnchor(chord: UcssChord): void {
  if (chord.anchorKind === 'pitch' && chord.anchorPc === null && chord.rootPc !== null) {
    chord.anchorPc = chord.rootPc;
  }
}

// ---- Key-aware helpers used by the analyzer ------------------------------------

/** All candidate UCSS structures the analyzer enumerates for one root pc. */
export interface UcssTemplate {
  /** Partial chord fed to parse/build (fields other than anchor/root). */
  build: Pick<UcssChord, 'extension' | 'extensionIsMajor' | 'quality' | 'add' | 'rem' | 'susMarker'>;
  /** Short human description shown in tooltips/reasons. */
  label: string;
}

const T = (extension: number | null, quality: string | null, extra: Partial<UcssTemplate['build']> = {}, label = ''): UcssTemplate => ({
  build: { extension, extensionIsMajor: false, quality, add: [], rem: [], susMarker: false, ...extra },
  label,
});

/**
 * Analyzer vocabulary expressed in UCSS terms — triads, sevenths, sixths,
 * suspensions/power, added-note chords, common alterations and ninths.
 * Kept deliberately curated (~dozens) so Bayesian scoring stays fast.
 * Sus templates carry `susMarker` because a traditional "sus" word replaces the
 * third even when stacked on an extension (`C9sus4`).
 */
export const UCSS_TEMPLATES: UcssTemplate[] = [
  // Triads
  T(null, 'M', {}, 'major triad'),
  T(null, 'm', {}, 'minor triad'),
  T(null, 'o', {}, 'diminished triad'),
  T(null, '+', {}, 'augmented triad'),
  // Sevenths & sixths
  T(7, null, {}, 'dominant seventh'),
  T(7, 'M', { extensionIsMajor: true }, 'major seventh'),
  T(7, 'm', {}, 'minor seventh'),
  T(7, 'ø', {}, 'half-diminished seventh'),
  T(7, 'o', {}, 'diminished seventh'),
  T(6, 'M', {}, 'major sixth'),
  T(6, 'm', {}, 'minor sixth'),
  // Suspensions / partial triads
  T(4, null, { susMarker: true }, 'suspended fourth'),
  T(2, null, { susMarker: true }, 'suspended second'),
  T(5, null, {}, 'power chord'),
  T(7, null, { susMarker: true }, 'dominant seventh suspended fourth'),
  // Added notes & common alterations
  T(null, 'M', { add: [{ degree: 9, alter: 0 }] }, 'added ninth'),
  T(null, 'm', { add: [{ degree: 9, alter: 0 }] }, 'minor added ninth'),
  T(7, null, { add: [{ degree: 9, alter: 0 }] }, 'dominant ninth'),
  T(9, null, { susMarker: true }, 'ninth suspended fourth'),
  T(7, 'm', { add: [{ degree: 9, alter: 0 }] }, 'minor ninth'),
  T(7, 'M', { extensionIsMajor: true, add: [{ degree: 9, alter: 0 }] }, 'major ninth'),
  T(7, null, { add: [{ degree: 9, alter: -1 }] }, 'dom7 ♭9'),
  T(7, null, { add: [{ degree: 9, alter: 1 }] }, 'dom7 ♯9'),
  T(7, null, { add: [{ degree: 11, alter: 1 }] }, 'dom7 ♯11'),
  T(7, null, { add: [{ degree: 13, alter: 0 }] }, 'dominant thirteenth'),
  T(7, null, { add: [{ degree: 5, alter: -1 }] }, 'dom7 ♭5'),
  T(7, null, { add: [{ degree: 5, alter: 1 }] }, 'dom7 ♯5'),
  T(7, null, { rem: [5] }, 'dom7 no fifth'),
  T(7, null, { rem: [3] }, 'dom7 no third'),
];

/** Build a full UcssChord anchored at `anchorPc` from a template. */
export function fromTemplate(t: UcssTemplate, anchorPc: number, anchorDisplay: string): UcssChord {
  return {
    anchor: anchorDisplay, anchorPc, anchorKind: 'pitch',
    rootPc: null, rootDisplay: null, bassPc: null, bassDisplay: null,
    anchorPrefer: null,
    inversion: null,
    extension: t.build.extension, extensionIsMajor: t.build.extensionIsMajor,
    susMarker: t.build.susMarker,
    add: t.build.add.map((a) => ({ ...a })), rem: [...t.build.rem],
    quality: t.build.quality,
    mode: null, modeRotation: 0,
    raw: '',
  };
}

/** Convenience: parse + resolve in one step. */
export function chordIntervals(input: string, opts: ParseOpts = {}): number[] {
  return intervalsOf(parseUcss(input, opts), opts.key ?? null);
}

/**
 * Keyboard geometry + rendering for the three viz modes (README §5).
 *
 *  - full88:      A0(21) … C8(108), classic white/black layout.
 *  - octave1:     one octave of keys; every pitch maps via pitch % 12 and the
 *                 octave number floor(pitch/12) is shown as a badge on the key
 *                 (e.g. pitches 66 and 78 both light "F#" with badges 5 / 6).
 *  - octave2split: two octaves stacked; incoming notes are assigned to the lower
 *                 or upper octave band by proximity to each band's centroid, so
 *                 registers stay distinguishable while remaining playable.
 */

import type { KeyboardVizMode, NoteState } from '../core/types.ts';
import { pitchClass, octaveNumber, isBlackKey, pcName } from '../core/theory/pitch.ts';

const WHITE_PATTERN = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_AFTER_WHITE: Record<number, number | null> = { 0: 1, 2: 3, 4: null, 5: 6, 7: 8, 9: 10, 11: null };

export interface KeyGeom {
  /** Absolute MIDI pitch (full88) or representative pitch in base octave (octave modes). */
  pitch: number;
  black: boolean;
  left: number;   // percent within octave strip
  width: number;  // percent
}

/** Geometry of one octave expressed in percent widths (white keys sum to 100). */
export function octaveGeometry(): KeyGeom[] {
  const whiteWidth = 100 / 7;
  const keys: KeyGeom[] = [];
  let wi = 0;
  for (const pc of WHITE_PATTERN) {
    keys.push({ pitch: pc, black: false, left: wi * whiteWidth, width: whiteWidth });
    wi++;
  }
  for (const pc of WHITE_PATTERN) {
    const bpc = BLACK_AFTER_WHITE[pc];
    if (bpc === null) continue;
    const idx = WHITE_PATTERN.indexOf(pc);
    keys.push({ pitch: bpc, black: true, left: (idx + 1) * whiteWidth - whiteWidth * 0.3, width: whiteWidth * 0.6 });
  }
  return keys;
}

interface HeldInfo { note: { pitch: number; velocity: number }; octaves: Set<number>; ghostWeight: number }

/** Aggregate currently-sounding state per pitch class (for wrapped modes) or per pitch (full88). */
function activeMap(state: NoteState, byPitchClass: boolean): Map<number, HeldInfo> {
  const m = new Map<number, HeldInfo>();
  const add = (pitch: number, vel: number, ghost: number) => {
    const key = byPitchClass ? pitchClass(pitch) : pitch;
    const e = m.get(key) ?? { note: { pitch, velocity: vel }, octaves: new Set(), ghostWeight: 0 };
    e.octaves.add(octaveNumber(pitch));
    if (ghost > e.ghostWeight && !(byPitchClass ? false : true)) e.note = { pitch, velocity: vel };
    e.ghostWeight = Math.max(e.ghostWeight, ghost);
    m.set(key, e);
  };
  for (const n of state.held) add(n.pitch, n.velocity, 0);
  for (const g of state.ghosts) add(g.pitch, g.velocity, g.weight);
  return m;
}

/**
 * octave2split assignment heuristic (v0.1 simple version): pick the octave band
 * whose center is closest to the note's octave; ties go lower. Will evolve into
 * the hysteresis/centroid optimizer described in README §5.
 */
function splitBandForPitch(pitch: number, baseOctave: number): 0 | 1 {
  const oct = octaveNumber(pitch);
  return oct >= baseOctave + 1 ? 1 : 0;
}

export class KeyboardView {
  private root: HTMLElement;
  private mode: KeyboardVizMode = 'full88';
  private baseOctave = 4; // reference octave for wrapped/split modes (C `baseOctave`)

  constructor(root: HTMLElement) {
    this.root = root;
  }

  setMode(mode: KeyboardVizMode, baseOctave?: number): void {
    this.mode = mode;
    if (baseOctave !== undefined) this.baseOctave = baseOctave;
    this.build();
  }

  get currentMode(): KeyboardVizMode { return this.mode; }

  /** Change reference octave without rebuilding the DOM. */
  setBaseOctave(oct: number): void { this.baseOctave = oct; }

  /** Rebuild DOM skeleton when mode changes. */
  build(): void {
    this.root.innerHTML = '';
    if (this.mode === 'full88') this.buildFull88();
    else if (this.mode === 'octave1') this.buildWrapped(1);
    else this.buildWrapped(2);
  }

  update(state: NoteState): void {
    if (this.mode === 'full88') this.updateFull88(state);
    else this.updateWrapped(state);
  }

  // ---- full 88 ----------------------------------------------------------------

  private buildFull88(): void {
    const LOW = 21, HIGH = 108;
    const wrap = el('div', 'kb kb-88');
    const whites = el('div', 'kb-whites');
    const blacks = el('div', 'kb-blacks');
    const geo = octaveGeometry();
    const whitePcs = WHITE_PATTERN;
    const numWhites = whitePcs.filter((pc) => pc + 12 * 0 >= 0).length; // 7 per octave
    void numWhites;
    const whiteCount = [...Array(HIGH - LOW + 1).keys()].map((i) => LOW + i).filter((p) => !isBlackKey(p)).length;
    const w = 100 / whiteCount;
    let wi = 0;
    for (let p = LOW; p <= HIGH; p++) {
      if (!isBlackKey(p)) {
        const k = el('div', 'key white');
        k.dataset.pitch = String(p);
        k.style.left = `${wi * w}%`;
        k.style.width = `${w}%`;
        if (pitchClass(p) === 0) {
          const label = document.createElement('span');
          label.className = 'key-label';
          label.textContent = `C${octaveNumber(p)}`;
          k.appendChild(label);
        }
        whites.appendChild(k);
        wi++;
      }
    }
    // Black keys positioned relative to total width using same scale.
    let prevWhiteIdx = -1;
    for (let p = LOW; p <= HIGH; p++) {
      if (isBlackKey(p)) {
        // find index of preceding white key
        const before = p - 1;
        const whiteIdxBefore = [...Array(before - LOW + 1).keys()].map((i) => LOW + i).filter((x) => !isBlackKey(x)).length - 1;
        if (whiteIdxBefore !== prevWhiteIdx) {
          prevWhiteIdx = whiteIdxBefore;
          const k = el('div', 'key black');
          k.dataset.pitch = String(p);
          k.style.left = `${(whiteIdxBefore + 1) * w - w * 0.3}%`;
          k.style.width = `${w * 0.6}%`;
          blacks.appendChild(k);
        }
      }
    }
    void geo;
    wrap.append(whites, blacks);
    this.root.appendChild(wrap);
  }

  private updateFull88(state: NoteState): void {
    const active = activeMap(state, false);
    this.root.querySelectorAll<HTMLElement>('.kb-88 .key').forEach((k) => {
      const pitch = Number(k.dataset.pitch);
      const info = active.get(pitch);
      applyKeyStyle(k, info);
      setBadge(k, info ? String(octaveNumber(pitch)) : '');
    });
  }

  // ---- wrapped 1 & 2 octave ---------------------------------------------------

  private buildWrapped(numOctaves: number): void {
    const geo = octaveGeometry();
    for (let band = 0; band < numOctaves; band++) {
      const strip = el('div', 'kb kb-octave');
      strip.dataset.band = String(band);
      const whites = el('div', 'kb-whites');
      const blacks = el('div', 'kb-blacks');
      for (const g of geo.filter((k) => !k.black)) {
        const k = el('div', 'key white');
        k.dataset.pc = String(g.pitch);
        k.style.left = `${g.left}%`;
        k.style.width = `${g.width}%`;
        const label = document.createElement('span');
        label.className = 'key-label';
        label.textContent = pcName(g.pitch);
        const badge = document.createElement('span');
        badge.className = 'oct-badge';
        k.append(label, badge);
        whites.appendChild(k);
      }
      for (const g of geo.filter((k) => k.black)) {
        const k = el('div', 'key black');
        k.dataset.pc = String(g.pitch);
        k.style.left = `${g.left}%`;
        k.style.width = `${g.width}%`;
        const badge = document.createElement('span');
        badge.className = 'oct-badge';
        k.appendChild(badge);
        blacks.appendChild(k);
      }
      strip.append(whites, blacks);
      this.root.appendChild(strip);
    }
  }

  private updateWrapped(state: NoteState): void {
    const bands = this.mode === 'octave1' ? 1 : 2;
    const base = this.baseOctave;
    // bucket: band -> pc -> info (with octave list)
    const bucket: Map<number, Map<number, HeldInfo>> = new Map();
    const put = (band: number, pc: number, pitch: number, vel: number, ghost: number) => {
      const m = bucket.get(band) ?? new Map();
      const e = m.get(pc) ?? { note: { pitch, velocity: vel }, octaves: new Set<number>(), ghostWeight: 0 };
      e.octaves.add(octaveNumber(pitch));
      e.ghostWeight = Math.max(e.ghostWeight, ghost);
      m.set(pc, e);
      bucket.set(band, m);
    };
    const assign = (pitch: number, vel: number, ghost: number) => {
      if (bands === 1) {
        put(0, pitchClass(pitch), pitch, vel, ghost);
      } else {
        const band = splitBandForPitch(pitch, base);
        put(band, pitchClass(pitch), pitch, vel, ghost);
      }
    };
    for (const n of state.held) assign(n.pitch, n.velocity, 0);
    for (const g of state.ghosts) assign(g.pitch, g.velocity, g.weight);

    this.root.querySelectorAll<HTMLElement>('.kb-octave').forEach((strip) => {
      const band = Number(strip.dataset.band);
      const m = bucket.get(band) ?? new Map();
      strip.querySelectorAll<HTMLElement>('.key').forEach((k) => {
        const pc = Number(k.dataset.pc);
        const info = m.get(pc);
        applyKeyStyle(k, info);
        setBadge(k, info ? [...info.octaves].sort((a, b) => a - b).join('·') : '');
      });
    });
  }
}

function applyKeyStyle(k: HTMLElement, info: HeldInfo | undefined): void {
  k.classList.toggle('active', !!info && info.ghostWeight === 0);
  k.classList.toggle('ghost', !!info && info.ghostWeight > 0);
  if (info) {
    const v = Math.max(info.note.velocity / 127, 0.15);
    k.style.setProperty('--vel', v.toFixed(2));
  }
}

function setBadge(k: HTMLElement, text: string): void {
  const badge = k.querySelector('.oct-badge');
  if (badge) badge.textContent = text;
}

function el(cls: string, extra = ''): HTMLElement {
  const d = document.createElement('div');
  d.className = extra ? `${cls} ${extra}` : cls;
  return d;
}

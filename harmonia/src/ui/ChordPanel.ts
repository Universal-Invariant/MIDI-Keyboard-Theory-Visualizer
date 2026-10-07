/**
 * ChordPanel — the app's centerpiece (README §2/§3): current chord with top-N
 * weighted interpretations, plus a last-4 chord history strip. History cards
 * show a lightweight SVG staff rendering of the notes actually played and are
 * clickable to replay them (wired via onReplay callback).
 */

import type { ChordCandidate } from '../core/types.ts';
import { pcName, pitchClass, octaveNumber } from '../core/theory/pitch.ts';
import type { ChordQualityId } from '../core/types.ts';

export interface HistoryEntry {
  symbol: string;
  candidates: ChordCandidate[];
  quality: ChordQualityId;
  pcs: number[];        // pitch classes captured at commit time
  pitches: number[];    // actual MIDI pitches (for staff drawing + replay)
  timestamp: number;
}

const MAX_HISTORY = 4;

export class ChordPanel {
  private currentEl: HTMLElement;
  private alternativesEl: HTMLElement;
  private historyEl: HTMLElement;
  private history: HistoryEntry[] = [];
  private liveStaff: HTMLElement | null = null;
  private lastPitches: number[] = [];
  onReplay: ((pitches: number[]) => void) | null = null;

  constructor(currentEl: HTMLElement, alternativesEl: HTMLElement, historyEl: HTMLElement) {
    this.currentEl = currentEl;
    this.alternativesEl = alternativesEl;
    this.historyEl = historyEl;
  }

  /** Called on every analysis tick with fresh ranked candidates ([] when silence). */
  update(candidates: ChordCandidate[]): void {
    if (candidates.length === 0) {
      this.currentEl.textContent = '—';
      this.currentEl.classList.remove('has-chord');
      this.alternativesEl.innerHTML = '';
      this.liveStaff?.replaceChildren();
      return;
    }
    const [best] = candidates;
    this.currentEl.textContent = best.symbol;
    this.currentEl.classList.add('has-chord');
    this.currentEl.title = best.reason;

    // Live staff: show the notes currently sounding (held first, then ghosts),
    // so notation updates in real time as you play.
    if (this.liveStaff) {
      const pitches = [...new Set(this.lastPitches)].sort((a, b) => a - b);
      this.liveStaff.replaceChildren(pitches.length ? renderStaffSvg(pitches) : document.createTextNode(''));
    }

    this.alternativesEl.innerHTML = '';
    for (const c of candidates.slice(1)) {
      const row = document.createElement('div');
      row.className = 'alt';
      const bar = document.createElement('span');
      bar.className = 'prob-bar';
      bar.style.setProperty('--p', Math.round(c.probability * 100) + '%');
      row.append(document.createTextNode(c.symbol), bar, pctLabel(c.probability));
      row.title = c.reason;
      this.alternativesEl.appendChild(row);
    }
  }

  /** Feed the panel the raw pitches behind the current state (for live notation). */
  setLivePitches(held: number[], ghosts: number[]): void {
    this.lastPitches = [...held, ...ghosts];
  }

  /** Attach a container element that will hold the live SVG staff. */
  attachLiveStaff(container: HTMLElement): void {
    this.liveStaff = container;
  }

  /** Commit the currently-held chord to history (call on note-off group / chord change). */
  commitHistory(candidates: ChordCandidate[], pcs: number[], timestamp: number, pitches: number[] = []): void {
    if (candidates.length === 0) return;
    const entry: HistoryEntry = { symbol: candidates[0].symbol, quality: candidates[0].quality, candidates, pcs, pitches, timestamp };
    // Collapse repeats of the same top symbol.
    const last = this.history[this.history.length - 1];
    if (last && last.symbol === entry.symbol) return;
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.renderHistory();
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
    this.renderHistory();
  }

  private renderHistory(): void {
    this.historyEl.innerHTML = '';
    for (const h of this.history) {
      const card = document.createElement('div');
      card.className = 'hist-card';
      card.title = 'Click to replay this chord';
      card.addEventListener('click', () => {
        const pitches = h.pitches.length ? h.pitches : h.pcs.map((pc) => pc + 60);
        this.onReplay?.(pitches);
      });
      const sym = document.createElement('div');
      sym.className = 'hist-symbol';
      sym.dataset.quality = h.quality;
      sym.textContent = h.symbol;
      const staff = renderStaffSvg(h.pitches.length ? h.pitches : h.pcs.map((pc) => pc + 60));
      staff.classList.add('hist-staff');
      const notes = document.createElement('div');
      notes.className = 'hist-notes';
      notes.textContent = (h.pitches.length ? h.pitches : h.pcs.map((pc) => pc + 60)).map((p) => pcName(pitchClass(p)) + octaveNumber(p)).join(' ');
      card.append(sym, staff, notes);
      this.historyEl.appendChild(card);
    }
  }
}

/**
 * Minimal SVG "music notation": treble staff with noteheads placed by diatonic
 * step, correct sharp/flat glyph per accidental (key-aware spelling is a later
 * upgrade), plus a middle-C ledger line. Good enough at a glance for chord
 * shapes; full VexFlow engraving (stems, beams) remains TODO.
 */
export function renderStaffSvg(pitches: number[]): SVGSVGElement {
  const W = 120, H = 64;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));

  const ACCIDENTAL_PC = new Set([1, 3, 6, 8, 10]);
  // Diatonic step index where each pitch class lands within its octave
  // (sharps take the step of the white key below — standard notation).
  const STEP_IN_OCTAVE: Record<number, number> = { 0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 6 };
  const topLineStep = 3 + 7 * 5;   // F5 → staff top line (step % 7 == 3, octave 5)
  const lineGap = 8;
  const yOf = (stepIdx: number) => 14 + (topLineStep - stepIdx) * (lineGap / 2);

  // Draw staff lines.
  for (let i = 0; i < 5; i++) {
    const line = document.createElementNS(svg.namespaceURI, 'line');
    line.setAttribute('x1', '6'); line.setAttribute('x2', String(W - 6));
    line.setAttribute('y1', String(14 + i * lineGap)); line.setAttribute('y2', String(14 + i * lineGap));
    line.setAttribute('stroke', '#5b637e'); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
  }

  const sorted = [...new Set(pitches)].sort((a, b) => a - b).slice(0, 6);
  let x = 30;
  for (const p of sorted) {
    const oct = Math.floor(p / 12) - 1;           // C-based scientific octave
    const stepIdx = STEP_IN_OCTAVE[pitchClass(p)] + 7 * oct;
    const y = Math.max(4, Math.min(H - 4, yOf(stepIdx)));
    // Ledger lines between the staff and the notehead.
    for (let ly = 14 + 4 * lineGap + lineGap; ly <= y; ly += lineGap) ledger(svg, x, ly);
    for (let ly = 14 - lineGap; ly >= y; ly -= lineGap) ledger(svg, x, ly);
    if (Math.abs(y - 54) < 2.5) ledger(svg, x, 54); // middle C line
    const acc = ACCIDENTAL_PC.has(pitchClass(p));
    if (acc) {
      const t = document.createElementNS(svg.namespaceURI, 'text');
      t.setAttribute('x', String(x - 15)); t.setAttribute('y', String(y + 4));
      t.setAttribute('font-size', '11'); t.setAttribute('fill', '#cdd3e6');
      t.textContent = '#';
      svg.appendChild(t);
    }
    const head = document.createElementNS(svg.namespaceURI, 'ellipse');
    head.setAttribute('cx', String(x)); head.setAttribute('cy', String(y));
    head.setAttribute('rx', '5'); head.setAttribute('ry', '3.6');
    head.setAttribute('transform', `rotate(-20 ${x} ${y})`);
    head.setAttribute('fill', acc ? '#cdd3e6' : '#1d2029');
    head.setAttribute('stroke', '#cdd3e6');
    svg.appendChild(head);
    x += 16;
  }
  return svg;
}

function ledger(svg: SVGSVGElement, cx: number, y: number): void {
  if (y < 2 || y > 62) return;
  const l = document.createElementNS(svg.namespaceURI, 'line');
  l.setAttribute('x1', String(cx - 8)); l.setAttribute('x2', String(cx + 8));
  l.setAttribute('y1', String(y)); l.setAttribute('y2', String(y));
  l.setAttribute('stroke', '#5b637e'); l.setAttribute('stroke-width', '1');
  svg.appendChild(l);
}

function pctLabel(p: number): HTMLElement {
  const s = document.createElement('span');
  s.className = 'prob-num';
  s.textContent = `${Math.round(p * 100)}%`;
  return s;
}

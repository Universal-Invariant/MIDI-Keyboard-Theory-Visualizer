/**
 * ChordPanel — the app's centerpiece (README §2/§3): current chord with top-N
 * weighted interpretations, plus a last-4 chord history strip. History cards
 * show a lightweight SVG staff rendering of the notes actually played and are
 * clickable to replay them (wired via onReplay callback).
 */

import type { ChordCandidate } from '../core/types.ts';
import { pcName, pitchClass, octaveNumber } from '../core/theory/pitch.ts';

export interface HistoryEntry {
  symbol: string;
  candidates: ChordCandidate[];
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
      return;
    }
    const [best] = candidates;
    this.currentEl.textContent = best.symbol;
    this.currentEl.classList.add('has-chord');
    this.currentEl.title = best.reason;

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

  /** Commit the currently-held chord to history (call on note-off group / chord change). */
  commitHistory(candidates: ChordCandidate[], pcs: number[], timestamp: number, pitches: number[] = []): void {
    if (candidates.length === 0) return;
    const entry: HistoryEntry = { symbol: candidates[0].symbol, candidates, pcs, pitches, timestamp };
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
 * Minimal SVG "music notation": treble+staff lines with noteheads placed by
 * diatonic step. Good enough at a glance for chord shapes; full VexFlow engraving
 * (accidentals, stems, beams) remains TODO(v0.4b).
 */
export function renderStaffSvg(pitches: number[]): SVGSVGElement {
  const W = 120, H = 64;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));

  // Staff: 5 lines; top line = F5 (MIDI 77). Diatonic step index per MIDI pitch.
  const STEP_OF_PC: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 }; // C D E F G A B
  const ACCIDENTAL_PC = new Set([1, 3, 6, 8, 10]);
  const topLineStep = 3 + 7 * 5;   // F5 → stepIndex where step % 7 == 3 (F), octave 5
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
  let x = 26;
  for (const p of sorted) {
    const stepIdx = diatonicStep(p);
    const y = Math.max(4, Math.min(H - 4, yOf(stepIdx)));
    // Ledger lines for far-out notes.
    for (let ly = 14 + 5 * lineGap + lineGap; ly <= y; ly += lineGap) ledger(svg, x, ly, W);
    for (let ly = 14 - lineGap; ly >= y; ly -= lineGap) ledger(svg, x, ly, W);
    const head = document.createElementNS(svg.namespaceURI, 'ellipse');
    head.setAttribute('cx', String(x)); head.setAttribute('cy', String(y));
    head.setAttribute('rx', '5'); head.setAttribute('ry', '3.6');
    head.setAttribute('transform', `rotate(-20 ${x} ${y})`);
    const acc = ACCIDENTAL_PC.has(pitchClass(p));
    head.setAttribute('fill', acc ? '#cdd3e6' : '#1d2029');
    head.setAttribute('stroke', '#cdd3e6');
    svg.appendChild(head);
    x += 16;
  }
  return svg;
}

function diatonicStep(pitch: number): number {
  const pc = pitchClass(pitch);
  const oct = octaveNumber(pitch);
  const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11]; // pcs C..B
  let stepInOctave = WHITE_STEPS.indexOf(pc);
  let offset = 0;
  if (stepInOctave === -1) {
    // Black key: use the step of the white key below it.
    for (let d = 1; d <= 2; d++) {
      const idx = WHITE_STEPS.indexOf(((pc - d) % 12 + 12) % 12);
      if (idx !== -1) { stepInOctave = idx; offset = d === 1 ? 0 : 0; break; }
    }
  }
  return stepInOctave + 7 * oct + offset;
}

function ledger(svg: SVGSVGElement, cx: number, y: number, W: number): void {
  if (y < 2 || y > 62) return;
  const l = document.createElementNS(svg.namespaceURI, 'line');
  l.setAttribute('x1', String(cx - 8)); l.setAttribute('x2', String(cx + 8));
  l.setAttribute('y1', String(y)); l.setAttribute('y2', String(y));
  l.setAttribute('stroke', '#5b637e'); l.setAttribute('stroke-width', '1');
  svg.appendChild(l);
  void W;
}

function pctLabel(p: number): HTMLElement {
  const s = document.createElement('span');
  s.className = 'prob-num';
  s.textContent = `${Math.round(p * 100)}%`;
  return s;
}

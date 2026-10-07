/**
 * ChordPanel — the app's centerpiece (README §2/§3): current chord with top-N
 * weighted interpretations, plus a last-4 chord history strip.
 * Staff notation rendering (VexFlow) is TODO(v0.4); for now each history card
 * shows the symbol and its spelled notes.
 */

import type { ChordCandidate } from '../core/types.ts';
import { pcName } from '../core/theory/pitch.ts';

export interface HistoryEntry {
  symbol: string;
  candidates: ChordCandidate[];
  pcs: number[];        // pitch classes captured at commit time
  timestamp: number;
}

const MAX_HISTORY = 4;

export class ChordPanel {
  private currentEl: HTMLElement;
  private alternativesEl: HTMLElement;
  private historyEl: HTMLElement;
  private history: HistoryEntry[] = [];

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
  commitHistory(candidates: ChordCandidate[], pcs: number[], timestamp: number): void {
    if (candidates.length === 0) return;
    const entry: HistoryEntry = { symbol: candidates[0].symbol, candidates, pcs, timestamp };
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
      const sym = document.createElement('div');
      sym.className = 'hist-symbol';
      sym.textContent = h.symbol;
      const notes = document.createElement('div');
      notes.className = 'hist-notes';
      notes.textContent = h.pcs.map((pc) => pcName(pc)).join(' ');
      // TODO(v0.4): staff glyph via VexFlow instead of plain text.
      card.append(sym, notes);
      this.historyEl.appendChild(card);
    }
  }
}

function pctLabel(p: number): HTMLElement {
  const s = document.createElement('span');
  s.className = 'prob-num';
  s.textContent = `${Math.round(p * 100)}%`;
  return s;
}
